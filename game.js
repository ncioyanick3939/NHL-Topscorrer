import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, tx } from './db.js';
import { PRICE, RULES } from './config.js';
import { nextPrice } from './scoring.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- Accounts ---------- */

const hash = (pw, salt) => scryptSync(pw, salt, 64).toString('hex');

export function register(name, password, invite, expectedInvite) {
  name = String(name || '').trim();
  password = String(password || '');
  if (invite !== expectedInvite) throw new HttpError(403, 'Einladungscode stimmt nicht.');
  if (!/^[\p{L}\p{N}_ .-]{2,20}$/u.test(name)) throw new HttpError(400, 'Name: 2 bis 20 Zeichen (Buchstaben, Zahlen, _ . -).');
  if (password.length < 8) throw new HttpError(400, 'Passwort: mindestens 8 Zeichen.');
  const salt = randomBytes(16).toString('hex');
  try {
    const r = db.prepare('INSERT INTO users (name, salt, pw_hash, balance) VALUES (?,?,?,?)')
      .run(name, salt, hash(password, salt), PRICE.startBudget);
    return Number(r.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Dieser Name ist schon vergeben.');
    throw e;
  }
}

export function login(name, password) {
  const u = db.prepare('SELECT * FROM users WHERE name = ?').get(String(name || '').trim());
  const salt = u?.salt ?? '00';
  const a = Buffer.from(hash(String(password || ''), salt), 'hex');
  const b = Buffer.from(u?.pw_hash ?? '0'.repeat(128), 'hex');
  if (!u || !timingSafeEqual(a, b)) throw new HttpError(401, 'Name oder Passwort falsch.');
  return u.id;
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expires = Date.now() + 30 * 24 * 3600 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?,?,?)').run(token, userId, expires);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  return { token, expires };
}

export function userFromToken(token) {
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.name, u.balance, u.points FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token = ? AND s.expires > ?`).get(token, Date.now()) ?? null;
}

export function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/* ---------- Helpers ---------- */

/** A player is locked while his team plays or has played on a day that is not closed yet. */
const LOCKED_SQL = `EXISTS (SELECT 1 FROM games g WHERE (g.home = p.team OR g.away = p.team)
  AND g.state IN ('LIVE','CRIT','FINAL','OFF') AND g.day NOT IN (SELECT day FROM days))`;

const todayPtsSql = `COALESCE((SELECT SUM(ds.pts) FROM day_stats ds WHERE ds.player_id = p.id
  AND ds.day NOT IN (SELECT day FROM days)), 0)`;

function history(playerId, n = 14) {
  return db.prepare('SELECT price FROM price_history WHERE player_id = ? ORDER BY day DESC LIMIT ?')
    .all(playerId, n).map((r) => r.price).reverse();
}

function shape(p, owned) {
  const hist = history(p.id);
  const live = p.today_pts ?? 0;
  return {
    id: p.id, team: p.team, first: p.first, last: p.last, pos: p.pos, number: p.number, headshot: p.headshot,
    price: p.price, prev: p.prev_price, hist: hist.length ? hist : [p.price],
    games: p.games, goals: p.goals, assists: p.assists, points: p.fantasy_pts,
    todayPts: live, tomorrow: live ? nextPrice(p.price, live) : p.price,
    locked: !!p.locked, owned: owned.has(p.id),
  };
}

const SELECT_PLAYER = `SELECT p.*, ${LOCKED_SQL} AS locked, ${todayPtsSql} AS today_pts FROM players p`;

const ownedSet = (userId) => new Set(db.prepare('SELECT player_id FROM roster WHERE user_id = ?').all(userId).map((r) => r.player_id));

/* ---------- Market ---------- */

export function listPlayers(userId, { pos, q, sort, limit = 60 } = {}) {
  const where = [];
  const args = [];
  if (pos && ['F', 'D', 'G'].includes(pos)) { where.push('p.pos = ?'); args.push(pos); }
  if (q) { where.push("(p.first || ' ' || p.last || ' ' || p.team) LIKE ?"); args.push(`%${String(q).slice(0, 40)}%`); }
  const order = { price: 'p.price DESC', change: '(p.price - p.prev_price) * 1.0 / p.prev_price DESC', points: 'p.fantasy_pts DESC', live: 'today_pts DESC' }[sort] || 'p.price DESC';
  const rows = db.prepare(`${SELECT_PLAYER} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}, p.id LIMIT ?`)
    .all(...args, Math.min(Number(limit) || 60, 200));
  const owned = ownedSet(userId);
  return rows.map((p) => shape(p, owned));
}

export function playerDetail(userId, id) {
  const p = db.prepare(`${SELECT_PLAYER} WHERE p.id = ?`).get(id);
  if (!p) throw new HttpError(404, 'Spieler nicht gefunden.');
  const log = db.prepare('SELECT day, price, pts, summary FROM price_history WHERE player_id = ? ORDER BY day DESC LIMIT 10').all(id);
  const live = db.prepare(`SELECT * FROM day_stats WHERE player_id = ? AND day NOT IN (SELECT day FROM days)`).get(id) ?? null;
  const own = db.prepare('SELECT bought_for FROM roster WHERE user_id = ? AND player_id = ?').get(userId, id);
  const full = db.prepare('SELECT shots, blocked, pim, plus_minus, wins FROM players WHERE id = ?').get(id);
  return { ...shape(p, ownedSet(userId)), ...full, plusMinus: full.plus_minus, boughtFor: own?.bought_for ?? null, log, live };
}

export function buy(userId, playerId) {
  return tx(() => {
    const p = db.prepare(`${SELECT_PLAYER} WHERE p.id = ?`).get(playerId);
    if (!p) throw new HttpError(404, 'Spieler nicht gefunden.');
    if (p.locked) throw new HttpError(409, 'Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen.');
    const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = ?').get(userId, playerId)) throw new HttpError(409, 'Dieser Spieler gehört dir schon.');
    if (u.balance < p.price) throw new HttpError(409, 'Zu wenig Guthaben.');
    const count = db.prepare('SELECT COUNT(*) AS n FROM roster WHERE user_id = ?').get(userId).n;
    if (count >= RULES.maxRoster) throw new HttpError(409, `Maximal ${RULES.maxRoster} Spieler im Kader.`);
    if (p.pos === 'G') {
      const g = db.prepare(`SELECT COUNT(*) AS n FROM roster r JOIN players x ON x.id = r.player_id WHERE r.user_id = ? AND x.pos = 'G'`).get(userId).n;
      if (g >= RULES.maxGoalies) throw new HttpError(409, `Maximal ${RULES.maxGoalies} Torhüter.`);
    }
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(p.price, userId);
    db.prepare('INSERT INTO roster (user_id, player_id, bought_for) VALUES (?,?,?)').run(userId, playerId, p.price);
    return { price: p.price };
  });
}

export function sell(userId, playerId) {
  return tx(() => {
    const p = db.prepare(`${SELECT_PLAYER} WHERE p.id = ?`).get(playerId);
    if (!p) throw new HttpError(404, 'Spieler nicht gefunden.');
    if (!db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = ?').get(userId, playerId)) throw new HttpError(409, 'Dieser Spieler gehört dir nicht.');
    if (p.locked) throw new HttpError(409, 'Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen.');
    db.prepare('DELETE FROM roster WHERE user_id = ? AND player_id = ?').run(userId, playerId);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(p.price, userId);
    return { price: p.price };
  });
}

/* ---------- Team, league, live ---------- */

export function myTeam(userId) {
  const rows = db.prepare(`${SELECT_PLAYER} JOIN roster r ON r.player_id = p.id WHERE r.user_id = ? ORDER BY p.price DESC`).all(userId);
  const owned = ownedSet(userId);
  const bought = new Map(db.prepare('SELECT player_id, bought_for FROM roster WHERE user_id = ?').all(userId).map((r) => [r.player_id, r.bought_for]));
  const players = rows.map((p) => ({ ...shape(p, owned), boughtFor: bought.get(p.id) }));
  const u = db.prepare('SELECT balance, points FROM users WHERE id = ?').get(userId);
  const value = players.reduce((s, p) => s + p.price, 0);
  const invested = players.reduce((s, p) => s + p.boughtFor, 0);
  return { players, balance: u.balance, points: u.points, value, invested };
}

export function league(userId) {
  const rows = db.prepare(`SELECT u.id, u.name, u.balance, u.points,
      COALESCE((SELECT SUM(p.price) FROM roster r JOIN players p ON p.id = r.player_id WHERE r.user_id = u.id), 0) AS value,
      COALESCE((SELECT SUM(ds.pts) FROM roster r JOIN day_stats ds ON ds.player_id = r.player_id
                WHERE r.user_id = u.id AND ds.day NOT IN (SELECT day FROM days)), 0) AS live
    FROM users u`).all();
  return rows.map((r) => ({ id: r.id, name: r.name, wealth: r.balance + r.value, value: r.value, points: r.points + r.live, live: r.live, me: r.id === userId }))
    .sort((a, b) => b.points - a.points || b.wealth - a.wealth);
}

export function liveView(userId) {
  const games = db.prepare(`SELECT * FROM games WHERE day NOT IN (SELECT day FROM days) OR day >= date('now','-1 day') ORDER BY day, start_utc`).all();
  const open = db.prepare(`SELECT ds.*, p.first, p.last, p.team, p.price, p.headshot, p.pos FROM day_stats ds JOIN players p ON p.id = ds.player_id
                           WHERE ds.day NOT IN (SELECT day FROM days)`).all();
  const mine = new Set(ownedSet(userId));
  const top = [...open].sort((a, b) => b.pts - a.pts).slice(0, 10)
    .map((r) => ({ id: r.player_id, name: `${r.first} ${r.last}`.trim(), team: r.team, pos: r.pos, pts: r.pts, goals: r.goals, assists: r.assists, headshot: r.headshot, mine: mine.has(r.player_id) }));
  const mineRows = open.filter((r) => mine.has(r.player_id)).sort((a, b) => b.pts - a.pts)
    .map((r) => ({ id: r.player_id, name: `${r.first} ${r.last}`.trim(), team: r.team, pos: r.pos, pts: r.pts, goals: r.goals, assists: r.assists, headshot: r.headshot, tomorrow: nextPrice(r.price, r.pts), price: r.price }));
  return {
    games: games.map((g) => ({ id: g.id, day: g.day, start: g.start_utc, state: g.state, home: g.home, away: g.away, homeScore: g.home_score, awayScore: g.away_score })),
    top, mine: mineRows, myPoints: mineRows.reduce((s, r) => s + r.pts, 0),
  };
}

export function recentMoves(limit = 30) {
  return db.prepare(`SELECT h.day, h.price, h.pts, h.summary, p.id, p.first, p.last, p.team, p.prev_price
                     FROM price_history h JOIN players p ON p.id = h.player_id
                     WHERE h.day = (SELECT MAX(day) FROM days) AND h.pts != 0 ORDER BY ABS(h.pts) DESC LIMIT ?`).all(limit);
}
