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

const { db } = await import('./db.js');
const { statsToPoints, nextPrice } = await import('./scoring.js');
const nhl = await import('./nhl.js');
const game = await import('./game.js');
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
  assert.equal(game.myTeam(uid).balance, 4_000_000);

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
  assert.equal(me.balance, 5_000_000);
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
