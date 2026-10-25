import { db } from './db.js';
import { RULES, PRICE } from './config.js';

/*
 * Sealed-bid auctions. A market player is on offer until his listing expires; then the highest bid wins
 * (earliest bid wins a tie). Nobody sees other bids. A manager can also offer his own player: the others bid,
 * only the seller sees the offers and accepts one.
 * No transactions in here on purpose: callers (day closing, market refresh, game actions) wrap them.
 */

export const LOCKED_SQL = `EXISTS (SELECT 1 FROM games g WHERE (g.home = p.team OR g.away = p.team)
  AND g.state IN ('LIVE','CRIT','FINAL','OFF') AND g.day NOT IN (SELECT day FROM days))`;

export const isLocked = (playerId) => !!db.prepare(`SELECT ${LOCKED_SQL} AS l FROM players p WHERE p.id = ?`).get(playerId)?.l;

export function logTransfer(userId, playerId, kind, price) {
  db.prepare('INSERT INTO transfers (user_id, player_id, kind, price, at) VALUES (?,?,?,?,?)').run(userId, playerId, kind, price, new Date().toISOString());
}

/** Why a manager cannot receive this player at this price, or null if he can. */
export function cannotReceive(userId, pos, price) {
  const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  if (!u) return 'Unbekannter Manager.';
  if (u.balance - price < -PRICE.creditLimit) return `Zu wenig Guthaben (Konto darf höchstens bis −${PRICE.creditLimit.toLocaleString('de-CH')} gehen).`;
  if (db.prepare('SELECT COUNT(*) AS n FROM roster WHERE user_id = ?').get(userId).n >= RULES.maxRoster) return `Maximal ${RULES.maxRoster} Spieler im Kader.`;
  if (pos === 'G') {
    const g = db.prepare(`SELECT COUNT(*) AS n FROM roster r JOIN players x ON x.id = r.player_id WHERE r.user_id = ? AND x.pos = 'G'`).get(userId).n;
    if (g >= RULES.maxGoalies) return `Maximal ${RULES.maxGoalies} Torhüter.`;
  }
  return null;
}

function result(userId, playerId, amount, won) {
  db.prepare('INSERT INTO bid_results (user_id, player_id, amount, won, at) VALUES (?,?,?,?,?)').run(userId, playerId, amount, won ? 1 : 0, new Date().toISOString());
}

/** Close all bids of a player: the winner gets a result row "won", everybody else "lost". */
function closeBids(playerId, winnerId) {
  for (const b of db.prepare('SELECT user_id, amount FROM bids WHERE player_id = ?').all(playerId)) result(b.user_id, playerId, b.amount, b.user_id === winnerId);
  db.prepare('DELETE FROM bids WHERE player_id = ?').run(playerId);
}

/** Move a player to a buyer. sellerId null = the market (the system). */
function transfer(buyerId, playerId, price, sellerId) {
  if (sellerId != null) {
    db.prepare('DELETE FROM roster WHERE user_id = ? AND player_id = ?').run(sellerId, playerId);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(price, sellerId);
    logTransfer(sellerId, playerId, 'sell', price);
  }
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(price, buyerId);
  db.prepare('INSERT OR REPLACE INTO roster (user_id, player_id, bought_for) VALUES (?,?,?)').run(buyerId, playerId, price);
  logTransfer(buyerId, playerId, 'buy', price);
  db.prepare('DELETE FROM user_listings WHERE player_id = ?').run(playerId);
}

/** Auction of a market player ended: the highest bidder who can still pay and has room wins. */
export function resolveMarket(playerId) {
  const p = db.prepare('SELECT pos FROM players WHERE id = ?').get(playerId);
  const bids = db.prepare('SELECT user_id, amount FROM bids WHERE player_id = ? ORDER BY amount DESC, at ASC').all(playerId);
  const taken = !!db.prepare('SELECT 1 FROM roster WHERE player_id = ?').get(playerId); // he now belongs to somebody else
  const winner = p && !taken && bids.find((b) => !cannotReceive(b.user_id, p.pos, b.amount) && !db.prepare('SELECT 1 FROM roster WHERE user_id = ? AND player_id = ?').get(b.user_id, playerId));
  if (winner) transfer(winner.user_id, playerId, winner.amount, null);
  closeBids(playerId, winner?.user_id ?? null);
  return winner ?? null;
}

/** The seller accepts one offer for his listed player. */
export function acceptOffer(sellerId, playerId, bidderId) {
  const listing = db.prepare('SELECT 1 FROM user_listings WHERE player_id = ? AND seller_id = ?').get(playerId, sellerId);
  if (!listing) return { error: 'Dieser Spieler ist nicht von dir angeboten.' };
  const bid = db.prepare('SELECT amount FROM bids WHERE player_id = ? AND user_id = ?').get(playerId, bidderId);
  if (!bid) return { error: 'Dieses Angebot gibt es nicht mehr.' };
  const p = db.prepare('SELECT pos FROM players WHERE id = ?').get(playerId);
  const why = cannotReceive(bidderId, p.pos, bid.amount);
  if (why) return { error: `Der Bieter kann nicht kaufen: ${why}` };
  transfer(bidderId, playerId, bid.amount, sellerId);
  closeBids(playerId, bidderId);
  return { price: bid.amount };
}

/** Listings by managers that ran out: the player stays with the seller, all bids are lost. */
export function expireUserListings(now = new Date()) {
  for (const l of db.prepare('SELECT player_id FROM user_listings WHERE expires_at <= ?').all(now.toISOString())) {
    closeBids(l.player_id, null);
    db.prepare('DELETE FROM user_listings WHERE player_id = ?').run(l.player_id);
  }
}

/** A player who left the roster or the market: forget bids without results. */
export function dropBids(playerId) {
  db.prepare('DELETE FROM bids WHERE player_id = ?').run(playerId);
}
