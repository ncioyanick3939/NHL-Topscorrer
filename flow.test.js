import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated database and no network: these tests use fixed NHL-format sample data, never the live API.
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'nhl-')), 'test.db');
process.env.NO_SCHEDULER = '1';
process.env.PORT = '0';
process.env.INVITE_CODE = 'testcode';
process.env.NO_STARTER = '1'; // most tests want an empty team; the starter-team test switches it on

const { db } = await import('./db.js');
const { statsToPoints, nextPrice } = await import('./scoring.js');
const nhl = await import('./nhl.js');
const game = await import('./game.js');
const market = await import('./market.js');
const injuries = await import('./injuries.js');
const { server } = await import('./server.js');

/* Boxscore in the shape of api-web.nhle.com/v1/gamecenter/{id}/boxscore */
const box = (state, hischierGoals) => ({
  gameState: state,
  homeTeam: { abbrev: 'NJD', score: hischierGoals },
  awayTeam: { abbrev: 'EDM', score: 0 },
  playerByGameStats: {
    homeTeam: {
      forwards: [
        { playerId: 8480002, name: { default: 'N. Hischier' }, goals: hischierGoals, assists: 0, sog: 3, blockedShots: 0, pim: 0, plusMinus: 1, toi: '19:10' },
        { playerId: 8480003, name: { default: 'J. Bench' }, goals: 0, assists: 0, sog: 0, blockedShots: 0, pim: 0, plusMinus: 0, toi: '00:00' },
      ],
      defense: [],
      goalies: [{ playerId: 8480010, name: { default: 'J. Markstrom' }, saveShotsAgainst: '25/25', goalsAgainst: 0, decision: 'W', toi: '60:00' }],
    },
    awayTeam: { forwards: [], defense: [], goalies: [] },
  },
});

test('scoring: a goal is 50 points and moves the price by 4.5 percent', () => {
  assert.equal(statsToPoints({ goals: 1 }), 50);
  assert.equal(nextPrice(1_000_000, 50), 1_045_000);
  assert.equal(nextPrice(1_000_000, -50), 955_000);
  assert.equal(nextPrice(1_000_000, 1000), 1_150_000); // capped at +15 %
});

test('parseBoxscore skips players who did not play and detects goalie results', () => {
  const live = nhl.parseBoxscore(box('LIVE', 1));
  assert.equal(live.players.length, 2); // bench player (00:00) skipped
  const g = live.players.find((p) => p.pos === 'G');
  assert.equal(g.saves, 25);
  assert.equal(g.shutout, 0); // not final yet
  assert.equal(nhl.parseBoxscore(box('FINAL', 1)).players.find((p) => p.pos === 'G').shutout, 1);
});

test('live points, trade lock, and next-day price move from real-format data', async () => {
  db.prepare(`INSERT INTO players (id, team, first, last, pos, number, price, prev_price) VALUES
    (8480002,'NJD','Nico','Hischier','F',13,1000000,1000000), (8480010,'NJD','Jacob','Markstrom','G',25,700000,700000)`).run();
  const uid = game.register('Tester', 'passwort123', 'testcode', 'testcode');
  game.buy(uid, 8480002);
  assert.equal(game.myTeam(uid).balance, 1_000_000);

  // Game starts and Hischier scores: points appear live, price does not move yet.
  const g = { id: 1, day: '2026-10-22', state: 'LIVE' };
  db.prepare(`INSERT INTO games (id, day, state, home, away, start_utc) VALUES (1,'2026-10-22','LIVE','NJD','EDM', ?)`).run(new Date(Date.now() + 3_600_000).toISOString()); // starts after the manager joined
  nhl.applyBoxscore(g, nhl.parseBoxscore(box('LIVE', 1)));
  const live = game.liveView(uid);
  assert.equal(live.mine[0].pts, 50 + 3 * 2 + 5); // goal + 3 shots + plus/minus
  assert.equal(db.prepare('SELECT price FROM players WHERE id=8480002').get().price, 1_000_000);
  assert.throws(() => game.sell(uid, 8480002), /Gesperrt/);
  assert.throws(() => game.buy(uid, 8480010), /Gesperrt/);

  // Game ends. Before the next morning nothing is booked.
  nhl.applyBoxscore(g, nhl.parseBoxscore(box('FINAL', 1)));
  assert.deepEqual(nhl.finalizeDueDays(new Date('2026-10-23T02:00:00Z')), []);
  assert.equal(db.prepare('SELECT price FROM players WHERE id=8480002').get().price, 1_000_000);

  // Next day, 10:00 Zurich passed: price moves, points booked, lock released.
  assert.deepEqual(nhl.finalizeDueDays(new Date('2026-10-23T09:00:00Z')), ['2026-10-22']);
  const p = db.prepare('SELECT price, prev_price FROM players WHERE id=8480002').get();
  assert.equal(p.prev_price, 1_000_000);
  assert.equal(p.price, nextPrice(1_000_000, 61)); // 61 points
  assert.equal(game.myTeam(uid).points, 61);
  assert.equal(game.sell(uid, 8480002).price, p.price);

  // Finalizing twice changes nothing.
  nhl.finalizeDay('2026-10-22');
  assert.equal(db.prepare('SELECT price FROM players WHERE id=8480002').get().price, p.price);
});

test('HTTP: login required, register with invite code, cookie session', async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://localhost:${server.address().port}`;
  const post = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

  assert.equal((await fetch(`${base}/api/players`)).status, 401);
  assert.equal((await post('/api/register', { name: 'Anna', password: 'passwort123', invite: 'falsch' })).status, 403);
  const reg = await post('/api/register', { name: 'Anna', password: 'passwort123', invite: 'testcode' });
  assert.equal(reg.status, 200);
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  assert.match(reg.headers.get('set-cookie'), /HttpOnly/);

  const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  assert.equal(me.name, 'Anna');
  assert.equal(me.balance, 2_000_000);
  const { db: tdb } = await import('./db.js');
  const hid = tdb.prepare("SELECT id FROM players WHERE last = 'Hischier'").get().id;
  tdb.prepare('INSERT OR REPLACE INTO market_listings (player_id, listed_at, expires_at) VALUES (?,?,?)').run(hid, new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString());
  const list = await (await fetch(`${base}/api/players`, { headers: { cookie } })).json();
  assert.ok(list.some((p) => p.last === 'Hischier'));
  assert.equal((await post('/api/login', { name: 'Anna', password: 'falsch-falsch' })).status, 401);
  assert.equal((await fetch(`${base}/`)).status, 200);
  const traversal = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.ok([403, 404].includes(traversal.status), 'path traversal must not serve files outside the public ones');
  for (const secret of ['/server.js', '/db.js', '/data/app.db', '/data/invite-code.txt', '/package.json']) {
    assert.equal((await fetch(base + secret)).status, 404, `${secret} must not be public`);
  }
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  server.close();
});

/* ---------- Market, starter team, injuries ---------- */

function addFakePlayers() {
  const ins = db.prepare(`INSERT INTO players (id, team, first, last, pos, price, prev_price) VALUES (?,?,?,?,?,?,?)`);
  let id = 1000;
  for (const [pos, n] of [['F', 60], ['D', 30], ['G', 10]]) {
    for (let i = 0; i < n; i++, id++) ins.run(id, 'TST', `Vorname${id}`, `Spieler${id}`, pos, 100_000 + (i % 20) * 10_000, 100_000 + (i % 20) * 10_000);
  }
}
test('market: 48 offers, one leaves and one arrives every hour, each player stays 48 hours', () => {
  addFakePlayers();
  const HOUR = 3_600_000;
  const t0 = new Date('2026-10-22T10:00:00Z');
  db.prepare('DELETE FROM market_listings').run();
  market.refreshMarket(t0);
  const rows = () => db.prepare('SELECT player_id, expires_at FROM market_listings ORDER BY expires_at').all();
  assert.equal(rows().length, 48);
  assert.equal(new Date(rows()[0].expires_at) - t0, 1 * HOUR);
  assert.equal(new Date(rows()[47].expires_at) - t0, 48 * HOUR);

  // 1 hour and 1 minute later: the first offer is gone, a new one arrived, still 48.
  const first = rows()[0].player_id;
  market.refreshMarket(new Date(t0.getTime() + HOUR + 60_000));
  assert.equal(rows().length, 48);
  assert.ok(!rows().some((r) => r.player_id === first), 'expired player must leave the market');
  assert.equal(new Date(rows()[47].expires_at) - t0, 49 * HOUR); // the newcomer stays exactly 48 hours from its slot

  // Nobody can buy a player who is not on the market.
  const off = db.prepare('SELECT id FROM players WHERE id NOT IN (SELECT player_id FROM market_listings) LIMIT 1').get().id;
  const uid = game.register('Marktkunde', 'passwort123', 'testcode', 'testcode');
  assert.throws(() => game.buy(uid, off), /nicht auf dem Markt/);

  // Server was off for 10 days: still 48 offers, all in the future, one slot per hour.
  const later = new Date(t0.getTime() + 10 * 24 * HOUR);
  market.refreshMarket(later);
  const r = rows();
  assert.equal(r.length, 48);
  assert.ok(r.every((x) => new Date(x.expires_at) > later));
  assert.equal(new Set(r.map((x) => x.expires_at)).size, 48);
});

test('starter team: 9 forwards, 6 defensemen, 1 goalie, given once and free', () => {
  delete process.env.NO_STARTER;
  try {
    const uid = game.register('Neuling', 'passwort123', 'testcode', 'testcode');
    const team = game.myTeam(uid);
    const count = (pos) => team.players.filter((p) => p.pos === pos).length;
    assert.equal(team.players.length, 16);
    assert.deepEqual([count('F'), count('D'), count('G')], [9, 6, 1]);
    assert.ok(team.value <= 3_500_000);
    assert.equal(team.balance, 2_000_000); // starter team costs nothing
    game.login('Neuling', 'passwort123'); // logging in again must not add more players
    assert.equal(game.myTeam(uid).players.length, 16);
  } finally {
    process.env.NO_STARTER = '1';
  }
});

test('injuries: names are matched, injured players leave the market, missed games are flagged', () => {
  db.prepare(`INSERT INTO players (id, team, first, last, pos, price, prev_price) VALUES (7001,'TST','Anton','Lindström','F',500000,500000)`).run();
  const parsed = injuries.parseInjuries({ injuries: [{ displayName: 'Testteam', injuries: [
    { status: 'Out', athlete: { displayName: 'Anton Lindstrom' }, details: { type: 'Lower Body', detail: 'Knee', returnDate: '2026-11-15T00:00Z' } },
    { status: 'Day-To-Day', athlete: { displayName: 'Vorname1005 Spieler1005' }, shortComment: 'Illness' },
    { status: 'Out', athlete: { displayName: 'Jemand Unbekannt' } },
    { status: 'Out', athlete: { displayName: 'Jacob Markstrom' } }, // two players share this name in the test data: skipped on purpose
  ] }] });
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].status, 'out');
  assert.equal(parsed[1].status, 'dtd');
  assert.equal(injuries.applyInjuries(parsed), 2); // unknown and ambiguous names are ignored

  const m = db.prepare('SELECT injury_status s, injury_text t, injury_return r FROM players WHERE id=7001').get();
  assert.deepEqual([m.s, m.t, m.r], ['out', 'Lower Body, Knee', '2026-11-15']);

  // An injured ("out") player on the market is replaced right away.
  db.prepare("INSERT OR REPLACE INTO market_listings (player_id, listed_at, expires_at) VALUES (7001, '2026-10-22T00:00:00Z', '2099-01-01T00:00:00Z')").run();
  market.refreshMarket(new Date('2026-10-22T10:00:00Z'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM market_listings WHERE player_id=7001').get().n, 0);

  // Missed the last game of his team -> flagged. Played it -> not flagged.
  db.prepare(`UPDATE players SET games = 5 WHERE id IN (7001, 1006)`).run();
  db.prepare(`INSERT INTO games (id, day, state, home, away) VALUES (500,'2026-10-20','FINAL','TST','ABC')`).run();
  db.prepare(`INSERT INTO day_stats (player_id, day, game_id) VALUES (1006,'2026-10-20',500)`).run();
  const uid = game.register('Beobachter', 'passwort123', 'testcode', 'testcode');
  assert.equal(game.playerDetail(uid, 7001).missedLast, true);
  assert.equal(game.playerDetail(uid, 1006).missedLast, false);
  assert.equal(game.playerDetail(uid, 7001).injury.status, 'out');
});

/* ---------- Real season stats and game log from the NHL ---------- */

test('season stats come from the NHL table, not from days counted since the app started', () => {
  const list = nhl.parseClubStats({
    skaters: [{ playerId: 8480002, gamesPlayed: 8, goals: 4, assists: 6, plusMinus: 3, shots: 25, penaltyMinutes: 2 }],
    goalies: [{ playerId: 8480010, gamesPlayed: 6, wins: 4, saves: 150, goalsAgainst: 12, shutouts: 1 }],
  });
  assert.equal(list.length, 2);
  nhl.applySeasonStats(list);
  const h = db.prepare('SELECT games, goals, assists, plus_minus, shots, pim, fantasy_pts FROM players WHERE id=8480002').get();
  assert.deepEqual([h.games, h.goals, h.assists, h.plus_minus, h.shots, h.pim], [8, 4, 6, 3, 25, 2]);
  assert.equal(h.fantasy_pts, 4 * 50 + 6 * 25 + 25 * 2 - 2 * 2 + 3 * 5); // 411
  const g = db.prepare('SELECT games, wins, fantasy_pts FROM players WHERE id=8480010').get();
  assert.deepEqual([g.games, g.wins], [6, 4]);
  assert.equal(g.fantasy_pts, 150 - 12 * 15 + 4 * 20 + 30);
  // a later game day being finalized must not overwrite the NHL totals
  const before = db.prepare('SELECT games FROM players WHERE id=8480002').get().games;
  nhl.finalizeDay('2099-01-01');
  assert.equal(db.prepare('SELECT games FROM players WHERE id=8480002').get().games, before);
});

test('game log: last games of a skater and a goalie in plain words', () => {
  const rows = nhl.parseGameLog({ gameLog: [
    { gameDate: '2026-10-21', opponentAbbrev: 'EDM', homeRoadFlag: 'H', goals: 1, assists: 1, plusMinus: 2, shots: 4, pim: 0 },
    { gameDate: '2026-10-19', opponentAbbrev: 'BOS', homeRoadFlag: 'R', goals: 0, assists: 0, plusMinus: -1, shots: 1, pim: 2 },
    { gameDate: '2026-10-17', opponentAbbrev: 'NYR', homeRoadFlag: 'H', decision: 'W', shotsAgainst: 30, goalsAgainst: 2, toi: '60:00' },
  ] });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].pts, 50 + 25 + 4 * 2 + 2 * 5);
  assert.equal(rows[0].text, '1 Tor, 1 Assist, +2, 4 Schüsse');
  assert.equal(rows[0].home, true);
  assert.equal(rows[1].home, false);
  assert.equal(rows[1].text, 'kein Punkt, -1, 1 Schüsse');
  assert.equal(rows[2].text, '28 Paraden, 2 Gegentore, Sieg');
  assert.equal(rows[2].pts, 28 - 2 * 15 + 20);
});

test('"not in the last game" is never shown for goalies or when that game was not read', () => {
  const uid = db.prepare("SELECT id FROM users WHERE name = 'Beobachter'").get().id;
  db.prepare(`INSERT INTO players (id, team, first, last, pos, price, prev_price, games) VALUES (7101,'TST','Back','Upgoalie','G',200000,200000,4)`).run();
  assert.equal(game.playerDetail(uid, 7101).missedLast, false); // goalie: backups sit all the time
  db.prepare(`INSERT INTO players (id, team, first, last, pos, price, prev_price, games) VALUES (7102,'NOB','Ohne','Boxscore','F',200000,200000,4)`).run();
  db.prepare(`INSERT INTO games (id, day, state, home, away) VALUES (501,'2026-10-21','FINAL','NOB','XYZ')`).run();
  assert.equal(game.playerDetail(uid, 7102).missedLast, false); // no boxscore stored for that game: we do not know
});

test('league ticker, topscorers list and rules are served', async () => {
  const { db } = await import('./db.js');
  const game = await import('./game.js');
  db.prepare("INSERT OR IGNORE INTO players (id, team, first, last, pos, price, prev_price, games, fantasy_pts) VALUES (990001,'TOR','Tick','Er','F',100000,100000,5,321)").run();
  db.prepare("INSERT OR IGNORE INTO users (name, salt, pw_hash, balance) VALUES ('tickuser','s','x',1000000)").run();
  const uid = db.prepare("SELECT id FROM users WHERE name='tickuser'").get().id;
  db.prepare("INSERT OR IGNORE INTO market_listings (player_id, listed_at, expires_at) VALUES (990001, ?, ?)").run(new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString());
  game.buy(uid, 990001);
  game.sell(uid, 990001);
  const t = game.ticker();
  assert.equal(t[0].kind, 'sell');
  assert.equal(t[1].kind, 'buy');
  assert.equal(t[1].player, 'Tick Er');
  assert.ok(game.topscorers(uid, {}).some((p) => p.id === 990001));
  assert.ok(game.topscorers(uid, { pos: 'D' }).every((p) => p.pos === 'D'));
  assert.ok(game.playerDetail(uid, 990001).transfers.length >= 2);
  assert.ok('nextStart' in game.liveView(uid));
});

test('lineup: 3 lines of 3F + 2D + 1 goalie, extra players on the bench, only the lineup scores', async () => {
  const { db } = await import('./db.js');
  const game = await import('./game.js');
  const { autoFillAll } = await import('./lineup.js');
  db.prepare("INSERT OR IGNORE INTO users (name, salt, pw_hash, balance) VALUES ('lineupuser','s','x',0)").run();
  const uid = db.prepare("SELECT id FROM users WHERE name='lineupuser'").get().id;
  let id = 880000;
  const add = (pos, n) => { for (let i = 0; i < n; i++, id++) {
    db.prepare("INSERT INTO players (id, team, first, last, pos, price, prev_price) VALUES (?,?,?,?,?,100000,100000)").run(id, 'ZZZ', 'L', 'P' + id, pos);
    db.prepare('INSERT INTO roster (user_id, player_id, bought_for) VALUES (?,?,100000)').run(uid, id); } };
  add('F', 10); add('D', 6); add('G', 2);
  const t = game.myTeam(uid);
  const count = (f) => t.players.filter(f).length;
  assert.equal(count((p) => p.lineup > 0 && p.pos === 'F'), 9);
  assert.equal(count((p) => p.lineup > 0 && p.pos === 'D'), 6);
  assert.equal(count((p) => p.lineup === 9), 1);
  assert.equal(count((p) => p.lineup === 0), 2); // 1 forward + 1 goalie on the bench
  const bench = t.players.find((p) => p.lineup === 0 && p.pos === 'F');
  const starter = t.players.find((p) => p.lineup === 1 && p.pos === 'F');
  assert.throws(() => game.setLineup(uid, bench.id, 1), /voll/);
  game.setLineup(uid, starter.id, 0);
  game.setLineup(uid, bench.id, 1);
  assert.equal(game.myTeam(uid).players.find((p) => p.id === bench.id).lineup, 1);
  assert.throws(() => game.setLineup(uid, bench.id, 9), /Ungültig/);
  autoFillAll();
});

test('auction: highest sealed bid wins at expiry; managers can offer players and only the seller sees offers', async () => {
  const { db } = await import('./db.js');
  const game = await import('./game.js');
  const { refreshMarket } = await import('./market.js');
  const mk = (n) => { db.prepare("INSERT OR IGNORE INTO users (name, salt, pw_hash, balance) VALUES (?,'s','x',1000000)").run(n); return db.prepare('SELECT id FROM users WHERE name=?').get(n).id; };
  const [a, b, c] = [mk('auc_a'), mk('auc_b'), mk('auc_c')];
  db.prepare("INSERT OR IGNORE INTO players (id, team, first, last, pos, price, prev_price) VALUES (770001,'ZZY','Auk','Tion','F',200000,200000)").run();
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  db.prepare('INSERT OR REPLACE INTO market_listings (player_id, listed_at, expires_at) VALUES (770001, ?, ?)').run(new Date().toISOString(), soon);
  assert.throws(() => game.placeBid(a, 770001, 150000), /mindestens/);
  game.placeBid(a, 770001, 210000);
  game.placeBid(b, 770001, 300000);
  game.placeBid(c, 770001, 250000);
  game.placeBid(c, 770001, 260000); // raise own bid
  assert.equal(game.auctions(a).bids.length, 1);
  // time passes: the listing expires
  db.prepare('UPDATE market_listings SET expires_at = ? WHERE player_id = 770001').run(new Date(Date.now() - 1000).toISOString());
  refreshMarket();
  assert.ok(db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = 770001').get(b), 'highest bidder gets the player');
  assert.equal(db.prepare('SELECT balance FROM users WHERE id = ?').get(b).balance, 700000);
  assert.equal(db.prepare('SELECT balance FROM users WHERE id = ?').get(a).balance, 1000000, 'losers pay nothing');
  assert.equal(game.auctions(a).results[0].won, false);
  assert.equal(game.auctions(b).results[0].won, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bids WHERE player_id = 770001').get().n, 0);

  // b offers the player to the others; only b sees the offers
  game.offerPlayer(b, 770001);
  assert.throws(() => game.placeBid(b, 770001, 500000), /eigener/);
  game.placeBid(a, 770001, 310000);
  game.placeBid(c, 770001, 350000);
  assert.equal(game.auctions(a).offers.length, 0);
  const offers = game.auctions(b).offers[0].bids;
  assert.deepEqual(offers.map((o) => o.user), ['auc_c', 'auc_a']);
  assert.throws(() => game.acceptBid(a, 770001, c), /nicht von dir/);
  game.acceptBid(b, 770001, c);
  assert.ok(db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = 770001').get(c));
  assert.equal(db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = 770001').get(b), undefined);
  assert.equal(db.prepare('SELECT balance FROM users WHERE id = ?').get(b).balance, 700000 + 350000);
  assert.equal(game.auctions(a).results[0].won, false);
});

test('official NHL lineup: rosterSpots are read and shown as "in" / "out" before the game', async () => {
  const { db } = await import('./db.js');
  const game = await import('./game.js');
  const { parseRosterSpots } = await import('./nhl.js');
  assert.deepEqual(parseRosterSpots({ rosterSpots: [{ playerId: 1 }, { playerId: 2 }, {}] }), [1, 2]);
  assert.deepEqual(parseRosterSpots({}), []);
  db.prepare("INSERT OR IGNORE INTO users (name, salt, pw_hash, balance) VALUES ('lnuser','s','x',1)").run();
  const uid = db.prepare("SELECT id FROM users WHERE name='lnuser'").get().id;
  for (const [id, last] of [[660001, 'In'], [660002, 'Out']]) db.prepare("INSERT OR IGNORE INTO players (id, team, first, last, pos, price, prev_price) VALUES (?, 'QQQ', 'X', ?, 'F', 100000, 100000)").run(id, last);
  db.prepare("INSERT OR REPLACE INTO games (id, day, start_utc, state, home, away) VALUES (660100, '2097-05-05', ?, 'FUT', 'QQQ', 'RRR')").run(new Date(Date.now() + 3_600_000).toISOString());
  const find = (id) => game.topscorers(uid, {}).find((p) => p.id === id) ?? null;
  db.prepare('UPDATE players SET games = 1, fantasy_pts = 5 WHERE id IN (660001, 660002)').run();
  assert.equal(find(660001).nhlLineup, null, 'no lineup published yet');
  db.prepare('INSERT INTO game_lineup (game_id, player_id) VALUES (660100, 660001)').run();
  assert.equal(find(660001).nhlLineup, 'in');
  assert.equal(find(660002).nhlLineup, 'out');
  db.prepare("DELETE FROM games WHERE id = 660100").run();
});

test('every player belongs to one manager only', async () => {
  const { db } = await import('./db.js');
  const game = await import('./game.js');
  const { refreshMarket } = await import('./market.js');
  const mk = (n) => { db.prepare("INSERT OR IGNORE INTO users (name, salt, pw_hash, balance) VALUES (?,'s','x',5000000)").run(n); return db.prepare('SELECT id FROM users WHERE name=?').get(n).id; };
  const [a, b] = [mk('one_a'), mk('one_b')];
  db.prepare("INSERT OR IGNORE INTO players (id, team, first, last, pos, price, prev_price) VALUES (550001,'ZZW','Solo','Player','F',100000,100000)").run();
  db.prepare('INSERT INTO roster (user_id, player_id, bought_for) VALUES (?,550001,100000)').run(a);
  assert.throws(() => db.prepare('INSERT INTO roster (user_id, player_id, bought_for) VALUES (?,550001,100000)').run(b), /UNIQUE/);
  // an owned player cannot be on the market or be bought
  db.prepare('INSERT OR REPLACE INTO market_listings (player_id, listed_at, expires_at) VALUES (550001, ?, ?)').run(new Date().toISOString(), new Date(Date.now() + 3_600_000).toISOString());
  refreshMarket();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM market_listings WHERE player_id = 550001').get().n, 0);
  assert.throws(() => game.placeBid(b, 550001, 900000), /nicht auf dem Markt|einem anderen/);
  assert.equal(game.topscorers(b, {}).find((p) => p.id === 550001)?.ownerName ?? 'one_a', 'one_a');
});

test('starter team always costs between 3.0 and 3.5 million', () => {
  delete process.env.NO_STARTER;
  try {
    for (let i = 0; i < 8; i++) {
      const uid = game.register('Start' + i, 'passwort123', 'testcode', 'testcode');
      const team = game.myTeam(uid);
      if (!team.players.length) continue; // not enough free players left in the small test pool
      assert.equal(team.players.length, 16);
      assert.ok(team.value >= 3_000_000 && team.value <= 3_500_000, `value ${team.value}`);
    }
  } finally { process.env.NO_STARTER = '1'; }
});

test('game events: goals with assists and penalties are read from play-by-play', async () => {
  const { parseGameEvents } = await import('./nhl.js');
  const json = {
    homeTeam: { id: 1, abbrev: 'NJD' }, awayTeam: { id: 2, abbrev: 'TOR' },
    rosterSpots: [{ playerId: 10, firstName: { default: 'Nico' }, lastName: { default: 'Hischier' } }, { playerId: 11, firstName: { default: 'Jack' }, lastName: { default: 'Hughes' } }, { playerId: 20, firstName: { default: 'Auston' }, lastName: { default: 'Matthews' } }],
    plays: [
      { typeDescKey: 'goal', periodDescriptor: { number: 1, periodType: 'REG' }, timeInPeriod: '05:12', details: { eventOwnerTeamId: 1, scoringPlayerId: 10, assist1PlayerId: 11, homeScore: 1, awayScore: 0 } },
      { typeDescKey: 'penalty', periodDescriptor: { number: 2, periodType: 'REG' }, timeInPeriod: '10:00', details: { eventOwnerTeamId: 2, committedByPlayerId: 20, descKey: 'tripping', duration: 2 } },
      { typeDescKey: 'shot-on-goal', details: {} },
    ],
  };
  const ev = parseGameEvents(json);
  assert.deepEqual(ev.goals, [{ period: 1, periodType: 'REG', time: '05:12', team: 'NJD', scorer: 'Nico Hischier', assists: ['Jack Hughes'], home: 1, away: 0 }]);
  assert.equal(ev.penalties[0].player, 'Auston Matthews');
  assert.equal(ev.penalties[0].text, 'Beinstellen');
  assert.equal(ev.penalties[0].minutes, 2);
});

test('game log results: final score from the players point of view', async () => {
  const nhl = await import('./nhl.js');
  const res = nhl.parseSeasonResults({ games: [
    { id: 1, gameState: 'OFF', homeTeam: { abbrev: 'NJD', score: 4 }, awayTeam: { abbrev: 'TOR', score: 2 } },
    { id: 2, gameState: 'OFF', homeTeam: { abbrev: 'BOS', score: 3 }, awayTeam: { abbrev: 'NJD', score: 1 }, gameOutcome: { lastPeriodType: 'OT' } },
    { id: 3, gameState: 'FUT', homeTeam: { abbrev: 'NJD' }, awayTeam: { abbrev: 'TOR' } },
  ] });
  assert.equal(res.size, 2);
  const log = [{ gameId: 1, team: 'NJD', home: true }, { gameId: 2, team: 'NJD', home: false }, { gameId: 3, team: 'NJD', home: true }];
  nhl.addResults(log, new Map([['NJD', res]]));
  assert.deepEqual(log[0].result, { own: 4, opp: 2, win: true, ot: false });
  assert.deepEqual(log[1].result, { own: 1, opp: 3, win: false, ot: true });
  assert.ok(!log[2].result);
});

test('market trend: last change, live forecast and movers', async () => {
  const { db } = await import('./db.js');
  const game = await import('./game.js');
  db.prepare("INSERT OR IGNORE INTO players (id, team, first, last, pos, price, prev_price) VALUES (440001,'ZZV','Up','Mover','F',110000,100000)").run();
  db.prepare("INSERT OR IGNORE INTO players (id, team, first, last, pos, price, prev_price) VALUES (440002,'ZZV','Down','Mover','F',90000,100000)").run();
  const t = game.marketTrend(1);
  assert.ok(typeof t.last.pct === 'number' && typeof t.forecast.pct === 'number');
  assert.ok(t.risers.some((p) => p.id === 440001 && p.delta === 10000));
  assert.ok(t.fallers.some((p) => p.id === 440002 && p.delta === -10000));
});

test('points only count for games that started after the manager joined', async () => {
  const { db } = await import('./db.js');
  const nhl = await import('./nhl.js');
  const mk = (n) => { db.prepare("INSERT OR IGNORE INTO users (name, salt, pw_hash, balance) VALUES (?,'s','x',0)").run(n); return db.prepare('SELECT id FROM users WHERE name=?').get(n).id; };
  const late = mk('late_joiner');
  db.prepare("INSERT OR IGNORE INTO players (id, team, first, last, pos, price, prev_price) VALUES (330001,'ZZU','Early','Goal','F',100000,100000)").run();
  db.prepare("INSERT INTO roster (user_id, player_id, bought_for, lineup) VALUES (?,330001,100000,1)").run(late);
  db.prepare("INSERT INTO games (id, day, state, home, away, start_utc) VALUES (330100,'2090-03-03','FINAL','ZZU','ZZT','2000-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO day_stats (day, player_id, game_id, goals, pts) VALUES ('2090-03-03',330001,330100,1,50)").run();
  nhl.finalizeDay('2090-03-03');
  assert.equal(db.prepare('SELECT points FROM users WHERE id=?').get(late).points, 0, 'game started before he joined');
});
