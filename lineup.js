import { db } from './db.js';

/*
 * Lineup like Topscorers: 3 lines of 3 forwards + 2 defensemen, plus 1 goalie (16 players).
 * Only players in the lineup earn points. roster.lineup: -1 = not placed yet, 0 = bench, 1..3 = line, 9 = goalie.
 */
export const CAP = { F: 3, D: 2 };
export const GOALIE_SLOT = 9;

export function slotFits(userId, pos, line, exceptPlayerId = null) {
  if (line === 0) return true;
  const used = db.prepare(`SELECT COUNT(*) AS n FROM roster r JOIN players p ON p.id = r.player_id
    WHERE r.user_id = ? AND r.lineup = ? AND p.pos = ? AND r.player_id != ?`).get(userId, line, pos, exceptPlayerId ?? -1).n;
  return used < (pos === 'G' ? 1 : CAP[pos]);
}

/** Players that are not placed yet go to the first free slot (best price first), otherwise to the bench. */
export function autoFill(userId) {
  const open = db.prepare(`SELECT r.player_id, p.pos FROM roster r JOIN players p ON p.id = r.player_id
    WHERE r.user_id = ? AND r.lineup = -1 ORDER BY p.price DESC`).all(userId);
  if (!open.length) return;
  // no transaction here on purpose: this also runs inside the day closing transaction (they cannot be nested)
  for (const o of open) {
    const lines = o.pos === 'G' ? [GOALIE_SLOT] : [1, 2, 3];
    const line = lines.find((l) => slotFits(userId, o.pos, l)) ?? 0;
    db.prepare('UPDATE roster SET lineup = ? WHERE user_id = ? AND player_id = ?').run(line, userId, o.player_id);
  }
}

export function autoFillAll() {
  for (const u of db.prepare("SELECT DISTINCT user_id FROM roster WHERE lineup = -1").all()) autoFill(u.user_id);
}
