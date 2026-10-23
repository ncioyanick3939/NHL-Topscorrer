import { db, tx } from './db.js';
import { RULES } from './config.js';
import { resolveMarket, expireUserListings, isLocked, dropBids } from './auction.js';

const HOUR = 3_600_000;

/** Pick a random player who is healthy and not on the market yet. Pricier players are a bit more likely. */
function pickPlayer(exclude = -1) {
  const rows = db.prepare(`SELECT id, price FROM players
    WHERE id NOT IN (SELECT player_id FROM market_listings)
      AND id NOT IN (SELECT player_id FROM roster)
      AND id != ?
      AND (injury_status IS NULL OR injury_status != 'out')`).all(exclude);
  if (!rows.length) return null;
  const weights = rows.map((r) => Math.sqrt(r.price));
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rows.length; i++) {
    x -= weights[i];
    if (x <= 0) return rows[i].id;
  }
  return rows[rows.length - 1].id;
}

const insert = (playerId, expires) =>
  db.prepare('INSERT INTO market_listings (player_id, listed_at, expires_at) VALUES (?,?,?)')
    .run(playerId, new Date(expires.getTime() - RULES.marketHours * HOUR).toISOString(), expires.toISOString());

/**
 * Keep the market at 48 offers. Every hour one offer expires and a new one arrives,
 * so each player stays for 48 hours. Cheap to call: do it before every market read.
 */
export function refreshMarket(now = new Date()) {
  return tx(() => {
    expireUserListings(now);
    const total = db.prepare('SELECT COUNT(*) AS n FROM market_listings').get().n;
    if (total === 0) {
      // First start: fill the market with offers that leave one per hour.
      for (let k = 1; k <= RULES.marketSlots; k++) {
        const id = pickPlayer();
        if (id == null) break;
        insert(id, new Date(now.getTime() + k * HOUR));
      }
      return;
    }
    const expired = db.prepare('SELECT player_id, expires_at FROM market_listings WHERE expires_at <= ? ORDER BY expires_at')
      .all(now.toISOString());
    for (const e of expired) {
      // A player whose team plays today cannot change hands yet: his auction is settled once the day is closed.
      if (RULES.marketLock && isLocked(e.player_id) && db.prepare('SELECT 1 FROM bids WHERE player_id = ?').get(e.player_id)) continue;
      resolveMarket(e.player_id);
      db.prepare('DELETE FROM market_listings WHERE player_id = ?').run(e.player_id);
      // The replacement keeps the hourly rhythm: it leaves 48 hours after the offer it replaces.
      let next = new Date(e.expires_at).getTime() + RULES.marketHours * HOUR;
      while (next <= now.getTime()) next += RULES.marketHours * HOUR; // server was off for a long time
      const id = pickPlayer(e.player_id); // not the player who just left
      if (id != null) insert(id, new Date(next));
    }
    // A player who now belongs to a manager (or is injured, see below) cannot be on the market.
    for (const o of db.prepare('SELECT l.player_id, l.expires_at FROM market_listings l WHERE l.player_id IN (SELECT player_id FROM roster)').all()) {
      db.prepare('DELETE FROM market_listings WHERE player_id = ?').run(o.player_id);
      dropBids(o.player_id);
      const id = pickPlayer();
      if (id != null) insert(id, new Date(o.expires_at));
    }
    // Players who became injured ("out") leave the market right away and are replaced.
    const out = db.prepare(`SELECT l.player_id, l.expires_at FROM market_listings l JOIN players p ON p.id = l.player_id
                            WHERE p.injury_status = 'out'`).all();
    for (const o of out) {
      db.prepare('DELETE FROM market_listings WHERE player_id = ?').run(o.player_id);
      dropBids(o.player_id);
      const id = pickPlayer();
      if (id != null) insert(id, new Date(o.expires_at));
    }
  });
}

export function isListed(playerId, now = new Date()) {
  return !!db.prepare('SELECT 1 FROM market_listings WHERE player_id = ? AND expires_at > ?').get(playerId, now.toISOString());
}
