import { autoFillAll } from './lineup.js';
import dns from 'node:dns';
import { db, tx, getMeta, setMeta } from './db.js';
import { NHL_API, NHL_TEAMS, PRICE, RULES } from './config.js';
import { statsToPoints, nextPrice, summarize, seasonPoints } from './scoring.js';
import { rolloverReached } from './util.js';
import { refreshMarket } from './market.js';
import { syncInjuries, injurySyncDue } from './injuries.js';

// Some hosts (e.g. Codespaces) hang on IPv6; try IPv4 first.
dns.setDefaultResultOrder('ipv4first');

/* ---------- HTTP ---------- */

// The NHL site may ignore requests with an unknown User-Agent, so we send a normal browser one.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
};

export async function fetchJson(path) {
  let res;
  try {
    res = await fetch(`${NHL_API}${path}`, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    const why = e.cause?.code || e.cause?.message || e.message;
    throw new Error(`NHL API ${path}: ${why}`);
  }
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
/** gamecenter/{id}/play-by-play -> ids of the players in the lineup (rosterSpots). Empty until the lineup is published. */
export function parseRosterSpots(json) {
  return (json.rosterSpots ?? []).map((r) => r.playerId).filter((id) => Number.isInteger(id));
}

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

/** club-stats/{TEAM}/{season}/2 -> season totals per player. */
export function parseClubStats(json) {
  const out = [];
  for (const s of json.skaters ?? []) {
    out.push({ id: s.playerId, games: s.gamesPlayed ?? 0, goals: s.goals ?? 0, assists: s.assists ?? 0,
      plus_minus: s.plusMinus ?? 0, shots: s.shots ?? 0, pim: s.penaltyMinutes ?? 0, wins: 0, saves: 0, goals_against: 0, shutouts: 0 });
  }
  for (const g of json.goalies ?? []) {
    out.push({ id: g.playerId, games: g.gamesPlayed ?? 0, goals: 0, assists: 0, plus_minus: 0, shots: 0, pim: 0,
      wins: g.wins ?? 0, saves: g.saves ?? 0, goals_against: g.goalsAgainst ?? 0, shutouts: g.shutouts ?? 0 });
  }
  return out;
}

/** player/{id}/game-log/now -> the games of the season in plain form, newest first. */
export function parseGameLog(json, limit = 100) {
  return (json.gameLog ?? []).slice(0, limit).map((g) => {
    const goalie = g.decision != null || g.shotsAgainst != null;
    let text, pts;
    if (goalie) {
      const saves = Math.max(0, (g.shotsAgainst ?? 0) - (g.goalsAgainst ?? 0));
      const win = g.decision === 'W' ? 1 : 0;
      const shutout = (g.goalsAgainst ?? 0) === 0 && (g.shotsAgainst ?? 0) > 0 && toiSeconds(g.toi) >= 3540 ? 1 : 0;
      pts = statsToPoints({ saves, goals_against: g.goalsAgainst ?? 0, win, shutout });
      text = `${saves} Paraden, ${g.goalsAgainst ?? 0} Gegentore${win ? ', Sieg' : ''}`;
    } else {
      pts = statsToPoints({ goals: g.goals, assists: g.assists, shots: g.shots, pim: g.pim, plus_minus: g.plusMinus });
      const bits = [];
      if (g.goals) bits.push(`${g.goals} ${g.goals === 1 ? 'Tor' : 'Tore'}`);
      if (g.assists) bits.push(`${g.assists} ${g.assists === 1 ? 'Assist' : 'Assists'}`);
      if (!bits.length) bits.push('kein Punkt');
      bits.push(`${g.plusMinus > 0 ? '+' : ''}${g.plusMinus ?? 0}`, `${g.shots ?? 0} Schüsse`);
      text = bits.join(', ');
    }
    return { gameId: g.gameId ?? null, team: g.teamAbbrev ?? null, date: g.gameDate, opp: g.opponentAbbrev, home: g.homeRoadFlag === 'H', text, pts, result: null };
  });
}

const GERMAN_PENALTY = {
  tripping: 'Beinstellen', hooking: 'Haken', slashing: 'Stockschlag', holding: 'Halten', interference: 'Behinderung',
  'cross-checking': 'Check mit dem Stock', 'high-sticking': 'Hoher Stock', roughing: 'Übertriebene Härte', fighting: 'Schlägerei',
  boarding: 'Check gegen die Bande', 'delaying-game': 'Spielverzögerung', 'too-many-men-on-the-ice': 'Zu viele Spieler',
  elbowing: 'Ellbogen', charging: 'Rempeln', 'unsportsmanlike-conduct': 'Unsportliches Verhalten', 'holding-the-stick': 'Stock halten',
  'illegal-check-to-head': 'Kopfcheck', 'checking-from-behind': 'Check von hinten', kneeing: 'Knie', 'game-misconduct': 'Spieldauer-Disziplinarstrafe',
};
const penaltyText = (k) => GERMAN_PENALTY[k] ?? String(k || 'Strafe').replace(/-/g, ' ');

/** gamecenter/{id}/play-by-play -> goals (with assists) and penalties in plain form. */
export function parseGameEvents(json) {
  const names = new Map();
  for (const r of json.rosterSpots ?? []) names.set(r.playerId, `${r.firstName?.default ?? ''} ${r.lastName?.default ?? ''}`.trim());
  const teams = new Map([[json.homeTeam?.id, json.homeTeam?.abbrev], [json.awayTeam?.id, json.awayTeam?.abbrev]]);
  const nm = (id) => names.get(id) ?? '?';
  const goals = [];
  const penalties = [];
  for (const p of json.plays ?? []) {
    const d = p.details ?? {};
    const base = { period: p.periodDescriptor?.number ?? null, periodType: p.periodDescriptor?.periodType ?? 'REG', time: p.timeInPeriod ?? '', team: teams.get(d.eventOwnerTeamId) ?? '' };
    if (p.typeDescKey === 'goal') {
      goals.push({ ...base, scorer: nm(d.scoringPlayerId), assists: [d.assist1PlayerId, d.assist2PlayerId].filter(Boolean).map(nm), home: d.homeScore ?? null, away: d.awayScore ?? null });
    } else if (p.typeDescKey === 'penalty') {
      penalties.push({ ...base, player: d.committedByPlayerId ? nm(d.committedByPlayerId) : 'Bank', minutes: d.duration ?? 2, text: penaltyText(d.descKey) });
    }
  }
  return { goals, penalties };
}

const eventCache = new Map();
/** Goals, assists and penalties of one game. Cached 30 s while running, 6 h when finished. Throws if the NHL does not answer. */
export async function getGameEvents(gameId) {
  const hit = eventCache.get(gameId);
  const g = db.prepare('SELECT state FROM games WHERE id = ?').get(gameId);
  if (!g) return null;
  const ttl = g.state === 'FINAL' || g.state === 'OFF' ? 6 * 3_600_000 : 30_000;
  if (hit && Date.now() - hit.t < ttl) return hit.data;
  const data = parseGameEvents(await fetchJson(`/gamecenter/${gameId}/play-by-play`));
  eventCache.set(gameId, { t: Date.now(), data });
  return data;
}

/** club-schedule-season -> {gameId: {home, away}} scores of finished games. */
export function parseSeasonResults(json) {
  const out = new Map();
  for (const g of json.games ?? []) {
    if ((g.gameState === 'FINAL' || g.gameState === 'OFF') && g.homeTeam?.score != null && g.awayTeam?.score != null) {
      out.set(g.id, { home: g.homeTeam.score, away: g.awayTeam.score, ot: g.gameOutcome?.lastPeriodType === 'OT' || g.gameOutcome?.lastPeriodType === 'SO' });
    }
  }
  return out;
}

/** Put the final score from the player's point of view on each game: { own, opp, win, ot } or null. */
export function addResults(log, resultsByTeam) {
  for (const g of log) {
    const r = resultsByTeam.get(g.team)?.get(g.gameId) ?? (() => {
      const row = db.prepare('SELECT home_score, away_score FROM games WHERE id = ? AND state IN (\'FINAL\',\'OFF\')').get(g.gameId);
      return row && row.home_score != null ? { home: row.home_score, away: row.away_score, ot: false } : null;
    })();
    if (!r) continue;
    const own = g.home ? r.home : r.away;
    const opp = g.home ? r.away : r.home;
    g.result = { own, opp, win: own > opp, ot: !!r.ot };
  }
  return log;
}

const seasonCache = new Map();
async function seasonResults(team) {
  const hit = seasonCache.get(team);
  if (hit && Date.now() - hit.t < 30 * 60_000) return hit.data;
  const data = parseSeasonResults(await fetchJson(`/club-schedule-season/${team}/now`));
  seasonCache.set(team, { t: Date.now(), data });
  return data;
}

const logCache = new Map();
/** Last games of one player from the NHL, cached for 30 minutes. Returns null if the NHL does not answer. */
export async function getGameLog(playerId) {
  const hit = logCache.get(playerId);
  if (hit && Date.now() - hit.t < 30 * 60_000) return hit.data;
  try {
    const data = parseGameLog(await fetchJson(`/player/${playerId}/game-log/now`));
    const byTeam = new Map();
    for (const team of new Set(data.map((g) => g.team).filter(Boolean))) {
      try { byTeam.set(team, await seasonResults(team)); } catch { /* the result is optional */ }
    }
    addResults(data, byTeam);
    logCache.set(playerId, { t: Date.now(), data });
    return data;
  } catch {
    return hit?.data ?? null;
  }
}

/** Write season totals into the players table. Fantasy points are calculated from the totals. */
export function applySeasonStats(list) {
  const upd = db.prepare(`UPDATE players SET games=?, goals=?, assists=?, plus_minus=?, shots=?, pim=?, wins=?, fantasy_pts=? WHERE id=?`);
  tx(() => {
    for (const t of list) upd.run(t.games, t.goals, t.assists, t.plus_minus, t.shots, t.pim, t.wins, seasonPoints(t), t.id);
  });
  return list.length;
}

/** Real season statistics for all players from the NHL (current season, regular season). */
export async function syncSeasonStats({ log = console.log } = {}) {
  const { cur } = seasonStrings();
  let n = 0;
  for (const team of NHL_TEAMS) {
    try {
      n += applySeasonStats(parseClubStats(await fetchJson(`/club-stats/${team}/${cur}/2`)));
    } catch (e) {
      log(`  ${team}: Saisonstatistik nicht geladen (${e.message})`);
    }
  }
  setMeta('last_stats_sync', Date.now());
  log(`Saisonstatistik geladen: ${n} Spieler`);
  return n;
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
  // Also look 1 and 2 weeks ahead so the next games (for example after a break) show up early. Optional: errors are ignored.
  const extrasDue = Date.now() - Number(getMeta('last_schedule_extra') || 0) > 3_600_000;
  if (extrasDue) setMeta('last_schedule_extra', Date.now());
  for (const days of extrasDue ? [-21, -14, -7, 7, 14] : []) {
    try {
      const d = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      games.push(...parseSchedule(await fetchJson(`/schedule/${d}`)));
    } catch { /* the main schedule is enough */ }
  }
  // Old games are only shown (results, goals). Their days count as closed, so they never move any price.
  const historyBefore = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  tx(() => {
    for (const g of games) {
      if (g.day < historyBefore) db.prepare('INSERT OR IGNORE INTO days (day) VALUES (?)').run(g.day);
      upsertGame.run(g);
    }
  });
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
/** Games that start within 90 minutes: read the published lineup (if the NHL has it yet). Never fails the update. */
export async function pollLineups({ log = console.log } = {}) {
  const soon = db.prepare(`SELECT id FROM games WHERE state IN ('FUT','PRE') AND start_utc IS NOT NULL
    AND (julianday(start_utc) - julianday('now')) * 1440 BETWEEN -5 AND 90`).all();
  for (const g of soon) {
    try {
      const ids = parseRosterSpots(await fetchJson(`/gamecenter/${g.id}/play-by-play`));
      if (!ids.length) continue; // not published yet
      tx(() => {
        db.prepare('DELETE FROM game_lineup WHERE game_id = ?').run(g.id);
        for (const id of ids) db.prepare('INSERT OR IGNORE INTO game_lineup (game_id, player_id) VALUES (?,?)').run(g.id, id);
      });
    } catch (e) {
      log(`Line-Up ${g.id} nicht geladen: ${e.cause?.code || e.message}`);
    }
  }
}

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

    }
    autoFillAll();
    db.prepare(`INSERT INTO user_day_points (user_id, day, pts)
                SELECT r.user_id, ?, COALESCE(SUM(ds.pts),0) FROM roster r
                JOIN day_stats ds ON ds.player_id=r.player_id AND ds.day=? WHERE r.lineup > 0 GROUP BY r.user_id`).run(day, day);
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
    await pollLineups({ log });
    if (injurySyncDue(RULES.injurySyncMs)) {
      try { await syncInjuries({ log }); } catch (e) { log(`Verletzungen nicht geladen: ${e.cause?.code || e.message}`); setMeta('last_injury_sync', Date.now() - RULES.injurySyncMs + 10 * 60_000); }
    }
    refreshMarket();
    const done = finalizeDueDays();
    if (done.length) log(`Tag abgeschlossen, Preise aktualisiert: ${done.join(', ')}`);
    if (done.length || Date.now() - Number(getMeta('last_stats_sync') || 0) > 3 * 3600 * 1000) await syncSeasonStats({ log });
  } catch (e) {
    log(`Update fehlgeschlagen: ${e.message}`);
  }
  const running = db.prepare(`SELECT COUNT(*) AS n FROM games WHERE state IN ('LIVE','CRIT')`).get().n;
  const soon = db.prepare(`SELECT COUNT(*) AS n FROM games WHERE state IN ('FUT','PRE') AND start_utc IS NOT NULL
                           AND (julianday(start_utc) - julianday('now')) * 1440 < 90`).get().n;
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
  else if (cmd === 'stats') { await syncSeasonStats(); }
  else if (cmd === 'injuries') { await syncInjuries(); }
  else if (cmd === 'process') { await syncSchedule(); await pollGames(); console.log('Abgeschlossen:', finalizeDueDays()); }
  else console.log('Nutzung: node nhl.js sync | process | injuries | stats');
}
