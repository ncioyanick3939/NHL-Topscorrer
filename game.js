import { autoFill, autoFillAll, slotFits, GOALIE_SLOT } from './lineup.js';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, tx } from './db.js';
import { PRICE, RULES } from './config.js';
import { LOCKED_SQL, logTransfer, cannotReceive, acceptOffer, dropBids } from './auction.js';
import { nextPrice, pointsBreakdown } from './scoring.js';
import { refreshMarket } from './market.js';

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
    const id = Number(r.lastInsertRowid);
    ensureStarterTeam(id);
    return id;
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
  ensureStarterTeam(u.id);
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

/* ---------- Starter team ---------- */

/**
 * Every manager gets a free team once: 9 forwards, 6 defensemen, 1 goalie (the players are random,
 * healthy and cheap, so everybody starts with a similar team value).
 * If no players are loaded yet, the team is given at the next login.
 */
export function ensureStarterTeam(userId) {
  if (process.env.NO_STARTER === '1') return false;
  const u = db.prepare('SELECT starter_given FROM users WHERE id = ?').get(userId);
  if (!u || u.starter_given) return false;
  const need = RULES.starter;
  const poolFor = (pos, cap) => db.prepare(`SELECT id, price FROM players WHERE pos = ? AND price <= ?
      AND id NOT IN (SELECT player_id FROM roster) AND (injury_status IS NULL OR injury_status != 'out')`).all(pos, cap);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const target = (need.minTotal + need.maxTotal) / 2;
  const inRange = (t) => t >= need.minTotal && t <= need.maxTotal;
  for (const cap of [need.maxPlayerPrice, need.maxPlayerPrice * 2, 10 ** 9]) {
    const pools = { F: poolFor('F', cap), D: poolFor('D', cap), G: poolFor('G', cap) };
    if (pools.F.length < need.F || pools.D.length < need.D || pools.G.length < need.G) continue;
    for (let attempt = 0; attempt < 30; attempt++) {
      const take = (pos, n) => shuffle([...pools[pos]]).slice(0, n).map((p) => ({ ...p, pos }));
      const pick = [...take('F', need.F), ...take('D', need.D), ...take('G', need.G)];
      let total = pick.reduce((s, p) => s + p.price, 0);
      // Swap players of the same position for cheaper or dearer ones until the total is between min and max.
      for (let step = 0; step < 400 && !inRange(total); step++) {
        const i = Math.floor(Math.random() * pick.length);
        const pool = pools[pick[i].pos];
        const cand = pool[Math.floor(Math.random() * pool.length)];
        if (pick.some((p) => p.id === cand.id)) continue;
        const next = total - pick[i].price + cand.price;
        if (Math.abs(next - target) < Math.abs(total - target)) { pick[i] = { ...cand, pos: pick[i].pos }; total = next; }
      }
      if (!inRange(total)) continue;
      tx(() => {
        if (db.prepare('SELECT COUNT(*) AS n FROM roster WHERE user_id = ?').get(userId).n === 0) {
          for (const p of pick) db.prepare('INSERT INTO roster (user_id, player_id, bought_for) VALUES (?,?,?)').run(userId, p.id, p.price);
        }
        db.prepare('UPDATE users SET starter_given = 1 WHERE id = ?').run(userId);
      });
      return true;
    }
  }
  return false; // not enough players loaded yet: try again at the next login
}

/* ---------- Helpers ---------- */

const todayPtsSql = `COALESCE((SELECT SUM(ds.pts) FROM day_stats ds WHERE ds.player_id = p.id
  AND ds.day NOT IN (SELECT day FROM days)), 0)`;

function history(playerId, n = 14) {
  return db.prepare('SELECT price FROM price_history WHERE player_id = ? ORDER BY day DESC LIMIT ?')
    .all(playerId, n).map((r) => r.price).reverse();
}

/** The next unfinished game of the team: only when it starts within 24 hours or is running. */
function nextGame(raw) {
  if (!raw) return null;
  const [start, state] = raw.split('|');
  const live = state === 'LIVE' || state === 'CRIT';
  return live || new Date(start) - Date.now() < 24 * 3_600_000 ? { start, state } : null;
}

function shape(p, owned) {
  const hist = history(p.id);
  const live = p.today_pts ?? 0;
  return {
    id: p.id, team: p.team, first: p.first, last: p.last, pos: p.pos, number: p.number, headshot: p.headshot,
    price: p.price, prev: p.prev_price, hist: hist.length ? hist : [p.price],
    games: p.games, goals: p.goals, assists: p.assists, points: p.fantasy_pts,
    todayPts: live, tomorrow: live ? nextPrice(p.price, live) : p.price,
    locked: !!p.locked, tradeLocked: RULES.marketLock && !!p.locked, owned: owned.has(p.id), // locked: lineup fixed; tradeLocked: no market
    injury: p.injury_status ? { status: p.injury_status, text: p.injury_text, returnDate: p.injury_return } : null,
    missedLast: !!p.missed_last,
    hoursLeft: p.listing_expires ? Math.max(0, Math.ceil((new Date(p.listing_expires) - Date.now()) / 3_600_000)) : null,
    onMarket: !!p.listing_expires && new Date(p.listing_expires) > new Date(),
    dressed: !!p.dressed, nhlLineup: p.nhl_lineup_out ? (p.in_nhl_lineup ? 'in' : 'out') : null, nextGame: nextGame(p.next_game),
    ownerName: p.owner_name ?? null,
    listedBy: p.listed_by ?? null, minBid: p.listed_by ? PRICE.minPrice : p.price_floor ?? p.price,
  };
}

/**
 * 1 if the player (a skater, not a goalie: backups often sit) was not in the last finished game of his team,
 * and only when that game's boxscore is stored, so we know who did play.
 */
const LAST_GAME = `(SELECT g.id FROM games g WHERE (g.home = p.team OR g.away = p.team) AND g.state IN ('FINAL','OFF')
  ORDER BY g.day DESC, g.start_utc DESC LIMIT 1)`;
const MISSED_SQL = `CASE WHEN p.pos != 'G' AND p.games > 0 AND ${LAST_GAME} IS NOT NULL
  AND EXISTS (SELECT 1 FROM day_stats d WHERE d.game_id = ${LAST_GAME})
  AND NOT EXISTS (SELECT 1 FROM day_stats d WHERE d.game_id = ${LAST_GAME} AND d.player_id = p.id) THEN 1 ELSE 0 END`;

const NEXT_GAME_ID = `(SELECT g.id FROM games g WHERE (g.home = p.team OR g.away = p.team) AND g.day NOT IN (SELECT day FROM days)
  AND g.state NOT IN ('FINAL','OFF') ORDER BY g.start_utc LIMIT 1)`;

const SELECT_PLAYER = `SELECT p.*, ${LOCKED_SQL} AS locked, ${todayPtsSql} AS today_pts, ${MISSED_SQL} AS missed_last,
  COALESCE((SELECT expires_at FROM market_listings m WHERE m.player_id = p.id), (SELECT expires_at FROM user_listings l WHERE l.player_id = p.id)) AS listing_expires,
  EXISTS (SELECT 1 FROM game_lineup gl WHERE gl.player_id = p.id AND gl.game_id = ${NEXT_GAME_ID}) AS in_nhl_lineup,
  EXISTS (SELECT 1 FROM game_lineup gl WHERE gl.game_id = ${NEXT_GAME_ID}) AS nhl_lineup_out,
  (SELECT g.start_utc || '|' || g.state FROM games g WHERE (g.home = p.team OR g.away = p.team) AND g.day NOT IN (SELECT day FROM days)
     AND g.state NOT IN ('FINAL','OFF') ORDER BY g.start_utc LIMIT 1) AS next_game,
  EXISTS (SELECT 1 FROM day_stats d WHERE d.player_id = p.id AND d.day NOT IN (SELECT day FROM days)) AS dressed,
  (SELECT u.name FROM roster r JOIN users u ON u.id = r.user_id WHERE r.player_id = p.id) AS owner_name,
  (SELECT u.name FROM user_listings l JOIN users u ON u.id = l.seller_id WHERE l.player_id = p.id) AS listed_by,
  (SELECT l.seller_id FROM user_listings l WHERE l.player_id = p.id) AS listed_by_id FROM players p`;

const ownedSet = (userId) => new Set(db.prepare('SELECT player_id FROM roster WHERE user_id = ?').all(userId).map((r) => r.player_id));

/* ---------- Market ---------- */

export function listPlayers(userId, { pos, q, sort, limit = 60 } = {}) {
  refreshMarket();
  const nowIso = new Date().toISOString();
  const where = [`(p.id IN (SELECT player_id FROM market_listings WHERE expires_at > '${nowIso}') OR p.id IN (SELECT player_id FROM user_listings WHERE expires_at > '${nowIso}'))`];
  const args = [];
  if (pos && ['F', 'D', 'G'].includes(pos)) { where.push('p.pos = ?'); args.push(pos); }
  if (q) { where.push("(p.first || ' ' || p.last || ' ' || p.team) LIKE ?"); args.push(`%${String(q).slice(0, 40)}%`); }
  const order = { expiry: 'listing_expires ASC', price: 'p.price DESC', change: '(p.price - p.prev_price) * 1.0 / p.prev_price DESC', points: 'p.fantasy_pts DESC', live: 'today_pts DESC' }[sort] || 'listing_expires ASC';
  const rows = db.prepare(`${SELECT_PLAYER} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}, p.id LIMIT ?`)
    .all(...args, Math.min(Number(limit) || 60, 200));
  const owned = ownedSet(userId);
  const mine = myBids(userId);
  return rows.map((p) => ({ ...shape(p, owned), myBid: mine.get(p.id) ?? null }));
}

const myBids = (userId) => new Map(db.prepare('SELECT player_id, amount FROM bids WHERE user_id = ?').all(userId).map((r) => [r.player_id, r.amount]));

export function playerDetail(userId, id) {
  const p = db.prepare(`${SELECT_PLAYER} WHERE p.id = ?`).get(id);
  if (!p) throw new HttpError(404, 'Spieler nicht gefunden.');
  const log = db.prepare('SELECT day, price, pts, summary FROM price_history WHERE player_id = ? ORDER BY day DESC LIMIT 10').all(id);
  const transfers = db.prepare(`SELECT t.kind, t.price, t.at, u.name AS user FROM transfers t JOIN users u ON u.id = t.user_id
    WHERE t.player_id = ? ORDER BY t.id DESC LIMIT 8`).all(id);
  const live = breakdownOf(db.prepare(`SELECT * FROM day_stats WHERE player_id = ? AND day NOT IN (SELECT day FROM days)`).get(id), p.pos);
  const own = db.prepare('SELECT bought_for FROM roster WHERE user_id = ? AND player_id = ?').get(userId, id);
  const full = db.prepare('SELECT shots, blocked, pim, plus_minus, wins FROM players WHERE id = ?').get(id);
  return { ...shape(p, ownedSet(userId)), myBid: myBids(userId).get(id) ?? null, ...full, plusMinus: full.plus_minus, boughtFor: own?.bought_for ?? null, log, live, transfers,
    histFull: db.prepare('SELECT day, price FROM price_history WHERE player_id = ? ORDER BY day ASC LIMIT 120').all(id) };
}

/** Live stats of a day with the points line by line. Rows stored before the full stats were kept get a rest line. */
function breakdownOf(row, pos) {
  if (!row) return null;
  const { detail, ...stats } = row;
  let lines;
  try { lines = detail ? pointsBreakdown(JSON.parse(detail)) : null; } catch { lines = null; }
  if (!lines) {
    lines = pointsBreakdown({ ...stats, pos });
    const rest = row.pts - lines.reduce((s, r) => s + r.pts, 0);
    if (rest) lines.push({ label: 'Weitere (Eiszeit, Bullys, Resultat …)', n: null, pts: rest });
  }
  return { ...stats, breakdown: lines };
}

/** League ticker: the latest buys and sells of all managers. */
export function ticker(limit = 50) {
  return db.prepare(`SELECT t.kind, t.price, t.at, u.name AS user, p.id AS playerId, p.first, p.last
    FROM transfers t JOIN users u ON u.id = t.user_id JOIN players p ON p.id = t.player_id
    ORDER BY t.id DESC LIMIT ?`).all(Math.min(Number(limit) || 50, 100))
    .map((r) => ({ kind: r.kind, price: r.price, at: r.at, user: r.user, playerId: r.playerId, player: `${r.first} ${r.last}`.trim() }));
}

/** Best players of the season by fantasy points, optionally by position. */
export function topscorers(userId, { pos, limit = 25 } = {}) {
  const where = ['p.games > 0'];
  const args = [];
  if (pos && ['F', 'D', 'G'].includes(pos)) { where.push('p.pos = ?'); args.push(pos); }
  const rows = db.prepare(`${SELECT_PLAYER} WHERE ${where.join(' AND ')} ORDER BY p.fantasy_pts DESC, p.id LIMIT ?`)
    .all(...args, Math.min(Number(limit) || 25, 100));
  const owned = ownedSet(userId);
  return rows.map((p) => shape(p, owned));
}

export function buy(userId, playerId) {
  refreshMarket();
  return tx(() => {
    const p = db.prepare(`${SELECT_PLAYER} WHERE p.id = ?`).get(playerId);
    if (!p) throw new HttpError(404, 'Spieler nicht gefunden.');
    if (!(p.listing_expires && new Date(p.listing_expires) > new Date())) throw new HttpError(409, 'Dieser Spieler ist nicht auf dem Markt.');
    if (RULES.marketLock && p.locked) throw new HttpError(409, 'Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen.');
    const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = ?').get(userId, playerId)) throw new HttpError(409, 'Dieser Spieler gehört dir schon.');
    if (db.prepare('SELECT 1 FROM roster WHERE player_id = ?').get(playerId)) throw new HttpError(409, 'Dieser Spieler gehört schon einem anderen Manager.');
    if (u.balance < p.price) throw new HttpError(409, 'Zu wenig Guthaben.');
    const count = db.prepare('SELECT COUNT(*) AS n FROM roster WHERE user_id = ?').get(userId).n;
    if (count >= RULES.maxRoster) throw new HttpError(409, `Maximal ${RULES.maxRoster} Spieler im Kader.`);
    if (p.pos === 'G') {
      const g = db.prepare(`SELECT COUNT(*) AS n FROM roster r JOIN players x ON x.id = r.player_id WHERE r.user_id = ? AND x.pos = 'G'`).get(userId).n;
      if (g >= RULES.maxGoalies) throw new HttpError(409, `Maximal ${RULES.maxGoalies} Torhüter.`);
    }
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(p.price, userId);
    db.prepare('INSERT INTO roster (user_id, player_id, bought_for) VALUES (?,?,?)').run(userId, playerId, p.price);
    logTransfer(userId, playerId, 'buy', p.price);
    return { price: p.price };
  });
}

export function sell(userId, playerId) {
  return tx(() => {
    const p = db.prepare(`${SELECT_PLAYER} WHERE p.id = ?`).get(playerId);
    if (!p) throw new HttpError(404, 'Spieler nicht gefunden.');
    if (!db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = ?').get(userId, playerId)) throw new HttpError(409, 'Dieser Spieler gehört dir nicht.');
    if (RULES.marketLock && p.locked) throw new HttpError(409, 'Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen.');
    db.prepare('DELETE FROM roster WHERE user_id = ? AND player_id = ?').run(userId, playerId);
    db.prepare('DELETE FROM user_listings WHERE player_id = ? AND seller_id = ?').run(playerId, userId);
    if (!db.prepare('SELECT 1 FROM user_listings WHERE player_id = ?').get(playerId)) dropBids(playerId);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(p.price, userId);
    logTransfer(userId, playerId, 'sell', p.price);
    return { price: p.price };
  });
}

/* ---------- Team, league, live ---------- */

/** Put a player into a line (1-3, goalie: 9) or on the bench (0). Locked players cannot be moved. */
export function setLineup(userId, playerId, line) {
  autoFill(userId);
  return tx(() => {
    const p = db.prepare(`${SELECT_PLAYER} JOIN roster r ON r.player_id = p.id AND r.user_id = ? WHERE p.id = ?`).get(userId, playerId);
    if (!p) throw new HttpError(404, 'Dieser Spieler gehört dir nicht.');
    const ok = line === 0 || (p.pos === 'G' ? line === GOALIE_SLOT : [1, 2, 3].includes(line));
    if (!ok) throw new HttpError(400, 'Ungültige Position.');
    if (p.locked) throw new HttpError(409, 'Gesperrt: Das Team spielt heute, die Aufstellung ist bis zum Tagesabschluss fix.');
    if (!slotFits(userId, p.pos, line, playerId)) throw new HttpError(409, 'Diese Linie ist auf der Position schon voll.');
    db.prepare('UPDATE roster SET lineup = ? WHERE user_id = ? AND player_id = ?').run(line, userId, playerId);
    return { ok: true };
  });
}

export function myTeam(userId) {
  autoFill(userId);
  const rows = db.prepare(`${SELECT_PLAYER} JOIN roster r ON r.player_id = p.id WHERE r.user_id = ? ORDER BY p.price DESC`).all(userId);
  const owned = ownedSet(userId);
  const bought = new Map(db.prepare('SELECT player_id, bought_for FROM roster WHERE user_id = ?').all(userId).map((r) => [r.player_id, r.bought_for]));
  const lineup = new Map(db.prepare('SELECT player_id, lineup FROM roster WHERE user_id = ?').all(userId).map((r) => [r.player_id, r.lineup]));
  const players = rows.map((p) => ({ ...shape(p, owned), boughtFor: bought.get(p.id), lineup: lineup.get(p.id) ?? 0 }));
  const u = db.prepare('SELECT balance, points FROM users WHERE id = ?').get(userId);
  const value = players.reduce((s, p) => s + p.price, 0);
  const invested = players.reduce((s, p) => s + p.boughtFor, 0);
  return { players, balance: u.balance, points: u.points, value, invested };
}

/** Public view of another manager's team: squad, lineup, points. Everybody in the league may look. */
export function managerTeam(targetId) {
  const u = db.prepare('SELECT id, name, balance, points FROM users WHERE id = ?').get(targetId);
  if (!u) throw new HttpError(404, 'Manager nicht gefunden.');
  const rows = db.prepare(`${SELECT_PLAYER} JOIN roster r ON r.player_id = p.id WHERE r.user_id = ? ORDER BY p.price DESC`).all(targetId);
  const owned = ownedSet(targetId);
  const lineup = new Map(db.prepare('SELECT player_id, lineup FROM roster WHERE user_id = ?').all(targetId).map((r) => [r.player_id, r.lineup]));
  const players = rows.map((p) => ({ ...shape(p, owned), lineup: lineup.get(p.id) ?? 0 }));
  // same rule as the league table: only games that started after the manager joined count
  const live = db.prepare(`SELECT COALESCE(SUM(ds.pts), 0) AS s FROM roster r JOIN day_stats ds ON ds.player_id = r.player_id
    JOIN users u ON u.id = r.user_id JOIN games gm ON gm.id = ds.game_id AND datetime(u.created_at) <= datetime(gm.start_utc)
    WHERE r.user_id = ? AND r.lineup > 0 AND ds.day NOT IN (SELECT day FROM days)`).get(targetId).s;
  return { id: u.id, name: u.name, points: u.points + live, live, value: players.reduce((s, p) => s + p.price, 0), count: players.length, players };
}

export function league(userId) {
  autoFillAll();
  const rows = db.prepare(`SELECT u.id, u.name, u.balance, u.points,
      COALESCE((SELECT SUM(p.price) FROM roster r JOIN players p ON p.id = r.player_id WHERE r.user_id = u.id), 0) AS value,
      COALESCE((SELECT SUM(ds.pts) FROM roster r JOIN day_stats ds ON ds.player_id = r.player_id
                JOIN games gm ON gm.id = ds.game_id AND datetime(u.created_at) <= datetime(gm.start_utc)
                WHERE r.user_id = u.id AND r.lineup > 0 AND ds.day NOT IN (SELECT day FROM days)), 0) AS live
    FROM users u`).all();
  return rows.map((r) => ({ id: r.id, name: r.name, wealth: r.balance + r.value, value: r.value, points: r.points + r.live, live: r.live, me: r.id === userId }))
    .sort((a, b) => b.points - a.points || b.wealth - a.wealth);
}

export function liveView(userId) {
  autoFill(userId);
  const inLineup = new Set(db.prepare('SELECT player_id FROM roster WHERE user_id = ? AND lineup > 0').all(userId).map((r) => r.player_id));
  const games = db.prepare(`SELECT * FROM games WHERE day NOT IN (SELECT day FROM days) OR day >= date('now','-1 day') ORDER BY day, start_utc`).all();
  const open = db.prepare(`SELECT ds.*, p.first, p.last, p.team, p.price, p.headshot, p.pos, gm.start_utc AS game_start FROM day_stats ds JOIN players p ON p.id = ds.player_id
                           LEFT JOIN games gm ON gm.id = ds.game_id WHERE ds.day NOT IN (SELECT day FROM days)`).all();
  const joined = new Date(String(db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId)?.created_at).replace(' ', 'T') + 'Z');
  const mine = new Set(ownedSet(userId));
  const top = [...open].sort((a, b) => b.pts - a.pts).slice(0, 10)
    .map((r) => ({ id: r.player_id, name: `${r.first} ${r.last}`.trim(), team: r.team, pos: r.pos, pts: r.pts, goals: r.goals, assists: r.assists, headshot: r.headshot, mine: mine.has(r.player_id) }));
  const mineRows = open.filter((r) => mine.has(r.player_id)).sort((a, b) => b.pts - a.pts)
    .map((r) => ({ id: r.player_id, name: `${r.first} ${r.last}`.trim(), team: r.team, pos: r.pos, pts: r.pts, goals: r.goals, assists: r.assists, headshot: r.headshot, tomorrow: nextPrice(r.price, r.pts), price: r.price, inLineup: inLineup.has(r.player_id), counts: !r.game_start || new Date(r.game_start) >= joined }));
  const next = db.prepare(`SELECT MIN(start_utc) AS t FROM games WHERE state IN ('FUT','PRE') AND start_utc > ?`).get(new Date().toISOString());
  return {
    nextStart: next?.t ?? null,
    openDay: games.find((x) => x.state !== 'FINAL' && x.state !== 'OFF')?.day ?? games.at(-1)?.day ?? null,
    games: games.map((g) => ({ id: g.id, day: g.day, start: g.start_utc, state: g.state, home: g.home, away: g.away, homeScore: g.home_score, awayScore: g.away_score })),
    top, mine: mineRows, myPoints: mineRows.filter((r) => r.inLineup && r.counts).reduce((s, r) => s + r.pts, 0),
  };
}

export function recentMoves(limit = 30) {
  return db.prepare(`SELECT h.day, h.price, h.pts, h.summary, p.id, p.first, p.last, p.team, p.prev_price
                     FROM price_history h JOIN players p ON p.id = h.player_id
                     WHERE h.day = (SELECT MAX(day) FROM days) AND h.pts != 0 ORDER BY ABS(h.pts) DESC LIMIT ?`).all(limit);
}


/* ---------- Bids and offers ---------- */

const onMarketNow = (playerId) => {
  const iso = new Date().toISOString();
  const m = db.prepare('SELECT expires_at FROM market_listings WHERE player_id = ? AND expires_at > ?').get(playerId, iso);
  if (m) return { kind: 'market', expires: m.expires_at };
  const l = db.prepare('SELECT expires_at, seller_id FROM user_listings WHERE player_id = ? AND expires_at > ?').get(playerId, iso);
  return l ? { kind: 'user', expires: l.expires_at, sellerId: l.seller_id } : null;
};

/** Place or change a sealed bid. At least the market value (offers by managers: at least the minimum price). */
export function placeBid(userId, playerId, amount) {
  refreshMarket();
  amount = Math.round(Number(amount));
  return tx(() => {
    const p = db.prepare(`${SELECT_PLAYER} WHERE p.id = ?`).get(playerId);
    if (!p) throw new HttpError(404, 'Spieler nicht gefunden.');
    const on = onMarketNow(playerId);
    if (on?.kind === 'market' && p.owner_name) throw new HttpError(409, 'Dieser Spieler gehört schon einem anderen Manager.');
    if (!on) throw new HttpError(409, 'Dieser Spieler ist nicht auf dem Markt.');
    if (on.sellerId === userId) throw new HttpError(409, 'Das ist dein eigener Spieler.');
    if (db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = ?').get(userId, playerId)) throw new HttpError(409, 'Dieser Spieler gehört dir schon.');
    if (RULES.marketLock && p.locked) throw new HttpError(409, 'Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen.');
    const min = on.kind === 'user' ? PRICE.minPrice : p.price;
    if (!Number.isFinite(amount) || amount < min) throw new HttpError(400, `Das Gebot muss mindestens ${min.toLocaleString('de-CH')} sein.`);
    const why = cannotReceive(userId, p.pos, amount);
    if (why) throw new HttpError(409, why);
    db.prepare(`INSERT INTO bids (user_id, player_id, amount, at) VALUES (?,?,?,?)
                ON CONFLICT(user_id, player_id) DO UPDATE SET amount = excluded.amount, at = excluded.at`).run(userId, playerId, amount, new Date().toISOString());
    return { ok: true, amount };
  });
}

export function cancelBid(userId, playerId) {
  db.prepare('DELETE FROM bids WHERE user_id = ? AND player_id = ?').run(userId, playerId);
  return { ok: true };
}

/** Offer one of my players to the other managers (they bid, I accept one offer or let it run out). */
export function offerPlayer(userId, playerId) {
  refreshMarket();
  return tx(() => {
    const p = db.prepare(`${SELECT_PLAYER} WHERE p.id = ?`).get(playerId);
    if (!p || !db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = ?').get(userId, playerId)) throw new HttpError(409, 'Dieser Spieler gehört dir nicht.');
    if (RULES.marketLock && p.locked) throw new HttpError(409, 'Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen.');
    if (db.prepare('SELECT 1 FROM user_listings WHERE player_id = ?').get(playerId)) throw new HttpError(409, 'Dieser Spieler ist schon angeboten.');
    const expires = new Date(Date.now() + RULES.userListingHours * 3_600_000).toISOString();
    db.prepare('INSERT INTO user_listings (player_id, seller_id, expires_at) VALUES (?,?,?)').run(playerId, userId, expires);
    return { ok: true, expires };
  });
}

export function cancelOffer(userId, playerId) {
  return tx(() => {
    const r = db.prepare('DELETE FROM user_listings WHERE player_id = ? AND seller_id = ?').run(playerId, userId);
    if (r.changes) {
      for (const b of db.prepare('SELECT user_id, amount FROM bids WHERE player_id = ?').all(playerId)) {
        db.prepare('INSERT INTO bid_results (user_id, player_id, amount, won, at) VALUES (?,?,?,0,?)').run(b.user_id, playerId, b.amount, new Date().toISOString());
      }
      dropBids(playerId);
    }
    return { ok: true };
  });
}

export function acceptBid(userId, playerId, bidderId) {
  return tx(() => {
    const p = db.prepare(`${SELECT_PLAYER} WHERE p.id = ?`).get(playerId);
    if (RULES.marketLock && p?.locked) throw new HttpError(409, 'Gesperrt: Das Team spielt heute oder der Tag ist noch nicht abgeschlossen.');
    const r = acceptOffer(userId, playerId, bidderId);
    if (r.error) throw new HttpError(409, r.error);
    return r;
  });
}

/** My open bids, offers for my listed players (only I see them), and what happened to my last bids. */
export function auctions(userId) {
  refreshMarket();
  const hours = (iso) => Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 3_600_000));
  const bids = db.prepare(`SELECT b.player_id AS id, b.amount, p.first, p.last, p.team, p.price,
      COALESCE((SELECT expires_at FROM market_listings WHERE player_id = p.id), (SELECT expires_at FROM user_listings WHERE player_id = p.id)) AS expires
    FROM bids b JOIN players p ON p.id = b.player_id WHERE b.user_id = ? ORDER BY expires`).all(userId)
    .map((r) => ({ id: r.id, name: `${r.first} ${r.last}`.trim(), team: r.team, amount: r.amount, price: r.price, hoursLeft: r.expires ? hours(r.expires) : null }));
  const offers = db.prepare(`SELECT l.player_id AS id, l.expires_at, p.first, p.last, p.team, p.price FROM user_listings l
    JOIN players p ON p.id = l.player_id WHERE l.seller_id = ? ORDER BY l.expires_at`).all(userId)
    .map((l) => ({
      id: l.id, name: `${l.first} ${l.last}`.trim(), team: l.team, price: l.price, hoursLeft: hours(l.expires_at),
      bids: db.prepare(`SELECT b.user_id AS userId, u.name AS user, b.amount FROM bids b JOIN users u ON u.id = b.user_id
                        WHERE b.player_id = ? ORDER BY b.amount DESC, b.at`).all(l.id),
    }));
  const results = db.prepare(`SELECT r.won, r.amount, r.at, p.first, p.last FROM bid_results r JOIN players p ON p.id = r.player_id
    WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 10`).all(userId)
    .map((r) => ({ won: !!r.won, amount: r.amount, at: r.at, name: `${r.first} ${r.last}`.trim() }));
  return { bids, offers, results };
}


/** All known games, newest first for finished ones is done by the client. */
export function allGames() {
  return db.prepare('SELECT id, day, start_utc, state, home, away, home_score, away_score FROM games ORDER BY start_utc, id LIMIT 600').all()
    .map((g) => ({ id: g.id, day: g.day, start: g.start_utc, state: g.state, home: g.home, away: g.away, homeScore: g.home_score, awayScore: g.away_score }));
}


/** Is the market going up or down? Last price change, live forecast for tomorrow, and the biggest movers. */
export function marketTrend(userId) {
  refreshMarket();
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 10_000) / 100 : 0);
  const all = db.prepare('SELECT SUM(price) AS now, SUM(prev_price) AS before FROM players').get();
  const iso = new Date().toISOString();
  const listed = db.prepare(`SELECT SUM(p.price) AS now, SUM(p.prev_price) AS before FROM players p WHERE p.id IN
    (SELECT player_id FROM market_listings WHERE expires_at > ? UNION SELECT player_id FROM user_listings WHERE expires_at > ?)`).get(iso, iso);
  const rows = db.prepare(`${SELECT_PLAYER} WHERE p.prev_price != p.price OR ${todayPtsSql} != 0`).all();
  const owned = ownedSet(userId);
  const withMoves = rows.map((p) => ({ p: shape(p, owned), last: p.price - p.prev_price, soon: p.today_pts ? nextPrice(p.price, p.today_pts) - p.price : 0 }));
  const forecastDelta = withMoves.reduce((s, r) => s + r.soon, 0);
  const top = (key, dir) => withMoves.filter((r) => r[key] * dir > 0).sort((a, b) => (b[key] - a[key]) * dir).slice(0, 3).map((r) => ({ ...r.p, delta: r[key] }));
  return {
    last: { pct: pct(all.now, all.before), delta: all.now - all.before },
    listed: { pct: pct(listed.now ?? 0, listed.before ?? 0) },
    forecast: { pct: pct(all.now + forecastDelta, all.now), delta: forecastDelta },
    risers: top('last', 1), fallers: top('last', -1),
    liveRisers: top('soon', 1), liveFallers: top('soon', -1),
  };
}
