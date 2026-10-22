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
  db.prepare(`INSERT INTO games (id, day, state, home, away) VALUES (1,'2026-10-22','LIVE','NJD','EDM')`).run();
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
  const p = db.prepare('SELECT price, prev_price, goals, games FROM players WHERE id=8480002').get();
  assert.equal(p.prev_price, 1_000_000);
  assert.equal(p.price, nextPrice(1_000_000, 61)); // 61 points
  assert.equal(p.goals, 1);
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
  db.prepare(`INSERT INTO players (id, team, first, last, pos, price, prev_price) VALUES (7001,'TST','Anton','Lindström','G',500000,500000)`).run();
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
