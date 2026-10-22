import { SCORING, PRICE } from './config.js';

/** Fantasy points from one player's stats of one game. Pure function. */
export function statsToPoints(s) {
  const c = SCORING;
  let pts =
    (s.goals || 0) * c.goal +
    (s.assists || 0) * c.assist +
    (s.shots || 0) * c.shot +
    (s.blocked || 0) * c.blocked +
    (s.pim || 0) * c.pim +
    (s.plus_minus || 0) * c.plusMinus +
    (s.saves || 0) * c.save +
    (s.goals_against || 0) * c.goalAgainst +
    (s.win ? c.win : 0) +
    (s.shutout ? c.shutout : 0);
  return Math.round(pts);
}

/** New price from the points of one finalized day. Pure function. */
export function nextPrice(price, pts) {
  let pct = pts * PRICE.pctPerPoint;
  pct = Math.max(-PRICE.capPct, Math.min(PRICE.capPct, pct));
  const next = Math.round((price * (1 + pct / 100)) / 10) * 10;
  return Math.max(PRICE.minPrice, next);
}

/** Short German text of what happened, e.g. "1 Tor, 2 Assists". */
export function summarize(s) {
  const parts = [];
  if (s.goals) parts.push(`${s.goals} ${s.goals === 1 ? 'Tor' : 'Tore'}`);
  if (s.assists) parts.push(`${s.assists} ${s.assists === 1 ? 'Assist' : 'Assists'}`);
  if (s.shutout) parts.push('Shutout');
  else if (s.win) parts.push('Sieg');
  if (s.saves) parts.push(`${s.saves} Paraden`);
  if (s.pim) parts.push(`${s.pim} Strafmin.`);
  return parts.join(', ') || 'kein Punkt';
}

/** Fantasy points of a whole season from NHL season totals (blocked shots are not in the NHL season table). */
export function seasonPoints(t) {
  const c = SCORING;
  return Math.round(
    (t.goals || 0) * c.goal + (t.assists || 0) * c.assist + (t.shots || 0) * c.shot + (t.pim || 0) * c.pim +
    (t.plus_minus || 0) * c.plusMinus + (t.saves || 0) * c.save + (t.goals_against || 0) * c.goalAgainst +
    (t.wins || 0) * c.win + (t.shutouts || 0) * c.shutout);
}
