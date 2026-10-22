import { db, tx, getMeta, setMeta } from './db.js';
import { NHL_API, NHL_TEAMS, PRICE, RULES } from './config.js';
import { statsToPoints, nextPrice, summarize } from './scoring.js';
import { rolloverReached } from './util.js';

/* ---------- HTTP ---------- */

export async function fetchJson(path) {
  const res = await fetch(`${NHL_API}${path}`, {
    headers: { 'User-Agent': 'nhl-topscorer-private/0.1' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`NHL API ${path}: HTTP ${res.status}`);
  return res.json();
}

/* ---------- Parsers (pure, tested with fixtures) ---------- */

const ACTIVE = new Set(['LIVE', 'CRIT', 'FINAL', 'OFF']);
export const isFinal = (state) => state === 'FINAL' || state === 'OFF';
export const isRunning = (state) => state === 'LIVE' || state === 'CRIT';

/** schedule/now -> flat list of games with their NHL game day. */
export function parseSchedule(json) {
  const out = [];
  for (const d of json.gameWeek ?? []) {
    for (const g of d.games ?? []) {
      out.push({
        id: g.id,
        day: d.date,
        start: g.startTimeUTC ?? null,
        state: g.gameState,
        home: g.homeTeam?.abbrev,
        away: g.awayTeam?.abbrev,
        homeScore: g.homeTeam?.score ?? null,
        awayScore: g.awayTeam?.score ?? null,
      });
    }
  }
  return out;
}

/** roster/{TEAM}/current -> players. */
export function parseRoster(json, team) {
  const out = [];
  const add = (list, pos) => {
    for (const p of list ?? []) {
      out.push({
        id: p.id, team, pos,
        first: p.firstName?.default ?? '',
        last: p.lastName?.default ?? '',
        number: p.sweaterNumber ?? null,
        headshot: p.headshot ?? null,
      });
    }
  };
  add(json.forwards, 'F');
  add(json.defensemen, 'D');
  add(json.goalies, 'G');
  return out;
}

const toiSeconds = (toi) => {
  if (!toi || typeof toi !== 'string') return 0;
  const [m, s] = toi.split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};

/** gamecenter/{id}/boxscore -> per-player stats of that game so far. */
export function parseBoxscore(json) {
  const players = [];
  const sides = [['homeTeam', json.homeTeam?.abbrev], ['awayTeam', json.awayTeam?.abbrev]];
  const byGame = json.playerByGameStats ?? {};
  for (const [key, team] of sides) {
    const t = byGame[key] ?? {};
    for (const [list, pos] of [[t.forwards, 'F'], [t.defense, 'D']]) {
      for (const p of list ?? []) {
        if (toiSeconds(p.toi) === 0) continue; // did not play
        players.push({
          id: p.playerId, team, pos, name: p.name?.default ?? '',
          goals: p.goals ?? 0, assists: p.assists ?? 0, shots: p.sog ?? 0,
          blocked: p.blockedShots ?? 0, pim: p.pim ?? 0, plus_minus: p.plusMinus ?? 0,
          saves: 0, goals_against: 0, win: 0, shutout: 0,
        });
      }
    }
    for (const p of t.goalies ?? []) {
      const secs = toiSeconds(p.toi);
      if (secs === 0) continue;
      let saves = p.saves;
      if (saves == null && typeof p.saveShotsAgainst === 'string') saves = Number(p.saveShotsAgainst.split('/')[0]);
      const ga = p.goalsAgainst ?? 0;
      players.push({
        id: p.playerId, team, pos: 'G', name: p.name?.default ?? '',
        goals: p.goals ?? 0, assists: p.assists ?? 0, shots: 0, blocked: 0, pim: p.pim ?? 0, plus_minus: 0,
        saves: saves ?? 0, goals_against: ga,
        win: p.decision === 'W' ? 1 : 0,
        shutout: ga === 0 && secs >= 3540 && isFinal(json.gameState) ? 1 : 0,
      });
    }
  }
  return {
    state: json.gameState,
    homeScore: json.homeTeam?.score ?? null,
    awayScore: json.awayTeam?.score ?? null,
    players,
  };
}

/* ---------- Start price ---------- */

export function seasonStrings(now = new Date()) {
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 8 ? y : y - 1; // season starts in autumn
  const cur = `${startYear}${startYear + 1}`;
  const prev = `${startYear - 1}${startYear}`;
  return { cur, prev };
}

export function startPrice(pos, prior) {
  let p = PRICE.priceFloorStart;
  if (prior) {
    if (pos === 'G') p = 150_000 + (prior.wins || 0) * 18_000;
    else p = 120_000 + (prior.points || 0) * (pos === 'D' ? 12_000 : 9_000);
  }
  return Math.max(PRICE.priceFloorStart, Math.min(PRICE.priceCeilStart, Math.round(p / 10) * 10));
}

/* ---------- Sync jobs ---------- */

const upsertPlayer = db.prepare(`
  INSERT INTO players (id, team, first, last, pos, number, headshot, price, prev_price)
  VALUES (@id, @team, @first, @last, @pos, @number, @headshot, @price, @price)
  ON CONFLICT(id) DO UPDATE SET team=excluded.team, first=excluded.first, last=excluded.last,
    pos=excluded.pos, number=excluded.number, headshot=COALESCE(excluded.headshot, players.headshot)
`);

/** Load all 32 rosters. New players get a start price from last season's numbers. */
export async function syncRosters({ log = console.log } = {}) {
  const { prev } = seasonStrings();
  let count = 0;
  for (const team of NHL_TEAMS) {
    try {
      const roster = parseRoster(await fetchJson(`/roster/${team}/current`), team);
      let prior = new Map();
      try {
        const st = await fetchJson(`/club-stats/${team}/${prev}/2`);
        for (const s of st.skaters ?? []) prior.set(s.playerId, { points: s.points ?? 0 });
        for (const g of st.goalies ?? []) prior.set(g.playerId, { wins: g.wins ?? 0 });
      } catch (e) {
        log(`  ${team}: keine Vorjahresstatistik (${e.message})`);
      }
      tx(() => {
        for (const p of roster) upsertPlayer.run({ ...p, price: startPrice(p.pos, prior.get(p.id)) });
      });
      count += roster.length;
    } catch (e) {
      log(`  ${team}: Kader nicht geladen (${e.message})`);
    }
  }
  setMeta('last_roster_sync', Date.now());
  log(`Kader geladen: ${count} Spieler`);
  return count;
}

const upsertGame = db.prepare(`
  INSERT INTO games (id, day, start_utc, state, home, away, home_score, away_score)
  VALUES (@id, @day, @start, @state, @home, @away, @homeScore, @awayScore)
  ON CONFLICT(id) DO UPDATE SET day=excluded.day, start_utc=excluded.start_utc, state=excluded.state,
    home_score=excluded.home_score, away_score=excluded.away_score
`);

export async function syncSchedule() {
  const games = parseSchedule(await fetchJson('/schedule/now'));
  tx(() => { for (const g of games) upsertGame.run(g); });
  return games.length;
}

const upsertDayStat = db.prepare(`
  INSERT INTO day_stats (player_id, day, game_id, goals, assists, shots, blocked, pim, plus_minus, saves, goals_against, win, shutout, pts)
  VALUES (@id, @day, @gameId, @goals, @assists, @shots, @blocked, @pim, @plus_minus, @saves, @goals_against, @win, @shutout, @pts)
  ON CONFLICT(player_id, day) DO UPDATE SET game_id=excluded.game_id, goals=excluded.goals, assists=excluded.assists,
    shots=excluded.shots, blocked=excluded.blocked, pim=excluded.pim, plus_minus=excluded.plus_minus, saves=excluded.saves,
    goals_against=excluded.goals_against, win=excluded.win, shutout=excluded.shutout, pts=excluded.pts
`);

/** Store the boxscore of one game as live day stats. Safe to call again and again. */
export function applyBoxscore(game, box) {
  tx(() => {
    db.prepare('UPDATE games SET state=?, home_score=?, away_score=? WHERE id=?').run(
      box.state ?? game.state, box.homeScore, box.awayScore, game.id);
    for (const p of box.players) {
      if (!db.prepare('SELECT 1 FROM players WHERE id=?').get(p.id)) {
        // Player not on a roster we synced (call-up, trade): add with floor price.
        const [first, ...rest] = (p.name || '?').split(' ');
        upsertPlayer.run({ id: p.id, team: p.team, first: rest.length ? first : '', last: rest.length ? rest.join(' ') : first,
          pos: p.pos, number: null, headshot: null, price: PRICE.priceFloorStart });
      }
      upsertDayStat.run({
        id: p.id, day: game.day, gameId: game.id, goals: p.goals, assists: p.assists, shots: p.shots, blocked: p.blocked,
        pim: p.pim, plus_minus: p.plus_minus, saves: p.saves, goals_against: p.goals_against, win: p.win, shutout: p.shutout,
        pts: statsToPoints(p),
      });
    }
  });
}

/** Poll boxscores of running games, and of finished games once after they ended. */
export async function pollGames({ log = console.log } = {}) {
  const open = db.prepare(`SELECT * FROM games WHERE state IN ('LIVE','CRIT','FINAL','OFF') AND day NOT IN (SELECT day FROM days)`).all();
  for (const g of open) {
    if (isFinal(g.state) && getMeta(`boxfinal:${g.id}`)) continue;
    try {
      const box = parseBoxscore(await fetchJson(`/gamecenter/${g.id}/boxscore`));
      applyBoxscore(g, box);
      if (isFinal(box.state)) setMeta(`boxfinal:${g.id}`, 1);
    } catch (e) {
      log(`Boxscore ${g.id} nicht geladen: ${e.message}`);
    }
  }
}

/**
 * Close a game day: move prices from the day's points, refresh season stats,
 * and book the points of every manager who owns the players. Runs once per day.
 */
export function finalizeDay(day) {
  tx(() => {
    if (db.prepare('SELECT 1 FROM days WHERE day=?').get(day)) return;
    const rows = db.prepare('SELECT * FROM day_stats WHERE day=?').all(day);
    // Players without a game: no change.
    db.prepare('UPDATE players SET prev_price = price WHERE id NOT IN (SELECT player_id FROM day_stats WHERE day=?)').run(day);
    for (const r of rows) {
      const p = db.prepare('SELECT price FROM players WHERE id=?').get(r.player_id);
      const price = nextPrice(p.price, r.pts);
      db.prepare('UPDATE players SET prev_price=?, price=? WHERE id=?').run(p.price, price, r.player_id);
      db.prepare(`INSERT INTO price_history (player_id, day, price, pts, summary) VALUES (?,?,?,?,?)
                  ON CONFLICT(player_id, day) DO UPDATE SET price=excluded.price, pts=excluded.pts, summary=excluded.summary`)
        .run(r.player_id, day, price, r.pts, summarize(r));
      db.prepare(`UPDATE players SET
          games = (SELECT COUNT(*) FROM day_stats WHERE player_id=players.id),
          goals = (SELECT COALESCE(SUM(goals),0) FROM day_stats WHERE player_id=players.id),
          assists = (SELECT COALESCE(SUM(assists),0) FROM day_stats WHERE player_id=players.id),
          plus_minus = (SELECT COALESCE(SUM(plus_minus),0) FROM day_stats WHERE player_id=players.id),
          shots = (SELECT COALESCE(SUM(shots),0) FROM day_stats WHERE player_id=players.id),
          blocked = (SELECT COALESCE(SUM(blocked),0) FROM day_stats WHERE player_id=players.id),
          pim = (SELECT COALESCE(SUM(pim),0) FROM day_stats WHERE player_id=players.id),
          wins = (SELECT COALESCE(SUM(win),0) FROM day_stats WHERE player_id=players.id),
          fantasy_pts = (SELECT COALESCE(SUM(pts),0) FROM day_stats WHERE player_id=players.id)
        WHERE id=?`).run(r.player_id);
    }
    db.prepare(`INSERT INTO user_day_points (user_id, day, pts)
                SELECT r.user_id, ?, COALESCE(SUM(ds.pts),0) FROM roster r
                JOIN day_stats ds ON ds.player_id=r.player_id AND ds.day=? GROUP BY r.user_id`).run(day, day);
    db.prepare('UPDATE users SET points = (SELECT COALESCE(SUM(pts),0) FROM user_day_points WHERE user_id=users.id)').run();
    db.prepare('INSERT INTO days (day) VALUES (?)').run(day);
  });
}

/** Finalize every day whose games are all over and whose rollover time has passed. */
export function finalizeDueDays(now = new Date()) {
  const days = db.prepare('SELECT DISTINCT day FROM games WHERE day NOT IN (SELECT day FROM days) ORDER BY day').all();
  const done = [];
  for (const { day } of days) {
    const left = db.prepare(`SELECT COUNT(*) AS n FROM games WHERE day=? AND state NOT IN ('FINAL','OFF')`).get(day).n;
    if (left === 0 && rolloverReached(day, now)) { finalizeDay(day); done.push(day); }
  }
  return done;
}

/* ---------- Scheduler ---------- */

export async function tick({ log = console.log } = {}) {
  try {
    const nPlayers = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
    const last = Number(getMeta('last_roster_sync') || 0);
    if (nPlayers === 0 || Date.now() - last > 7 * 24 * 3600 * 1000) await syncRosters({ log });
    await syncSchedule();
    await pollGames({ log });
    const done = finalizeDueDays();
    if (done.length) log(`Tag abgeschlossen, Preise aktualisiert: ${done.join(', ')}`);
  } catch (e) {
    log(`Update fehlgeschlagen: ${e.message}`);
  }
  const running = db.prepare(`SELECT COUNT(*) AS n FROM games WHERE state IN ('LIVE','CRIT')`).get().n;
  const soon = db.prepare(`SELECT COUNT(*) AS n FROM games WHERE state IN ('FUT','PRE') AND start_utc IS NOT NULL
                           AND (julianday(start_utc) - julianday('now')) * 1440 < 15`).get().n;
  return running || soon ? RULES.liveIntervalMs : RULES.idleIntervalMs;
}

export function startScheduler(log = console.log) {
  const loop = async () => {
    const wait = await tick({ log });
    setTimeout(loop, wait).unref?.();
  };
  loop();
}

/* ---------- CLI ---------- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'sync') { await syncRosters(); console.log(`${await syncSchedule()} Spiele im Spielplan`); }
  else if (cmd === 'process') { await syncSchedule(); await pollGames(); console.log('Abgeschlossen:', finalizeDueDays()); }
  else console.log('Nutzung: node nhl.js sync | process');
}
