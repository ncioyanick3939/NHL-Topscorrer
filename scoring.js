import { SCORING, PRICE } from './config.js';

/** Penalty points from penalty minutes of one game (2 min = -10, 5 min = -75, 10 min = -50). */
export function penaltyPoints(pim) {
  const c = SCORING;
  if (!pim) return 0;
  if (pim === 10) return c.penalty10;
  const majors = Math.floor(pim / 5);
  const minors = Math.round((pim - majors * 5) / 2);
  return majors * c.penalty5 + minors * c.penalty2;
}

/** Points of the game result for a player who played. result: 'W','OTW','L','OTL','SOL' or null while running. */
export function resultPoints(result) {
  const c = SCORING;
  return { W: c.win, OTW: c.winOT, L: c.loss, OTL: c.lossOT, SOL: c.lossSO }[result] ?? 0;
}

/** Fantasy points from one player's stats of one game (Topscorers rules). Pure function. */
export function statsToPoints(s) {
  const c = SCORING;
  const pos = s.pos === 'D' || s.pos === 'G' ? s.pos : 'F';
  let pts =
    (s.goals || 0) * c.goal[pos] +
    (s.assists || 0) * c.assist[pos] +
    (s.pp_goals || 0) * c.powerplayGoal +
    ((s.goals || 0) >= 3 ? c.hattrick : 0) +
    (s.shots || 0) * c.shot +
    (s.blocked || 0) * c.blocked +
    (s.plus_minus || 0) * c.plusMinus +
    (s.saves || 0) * c.save +
    (s.goals_against || 0) * c.goalAgainst +
    (s.shutout ? c.shutout : 0) +
    (s.zero_against && (pos === 'G' || pos === 'D') ? c.zeroAgainst : 0) +
    (s.dressed ? c.lineup : 0) +
    (s.sh_goals || 0) * c.shGoal + (s.sh_assists || 0) * c.shAssist + (s.pp_assists || 0) * c.ppAssist +
    (s.gwg || 0) * c.gwg + (s.pwg || 0) * c.pwg +
    (s.fo_won || 0) * c.faceoffWon + (s.fo_lost || 0) * c.faceoffLost +
    (s.missed || 0) * c.missedShot +
    (s.toi_min || 0) * c.timeOnIce + (s.goalie_time || 0) * c.goalieTime +
    (s.pen_pts != null ? s.pen_pts : penaltyPoints(s.pim)) +
    resultPoints(s.result);
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

/** Fantasy points of a whole season from NHL season totals (rough: used for start prices only). */
export function seasonPoints(t) {
  const c = SCORING;
  const pos = t.pos === 'D' || t.pos === 'G' ? t.pos : 'F';
  return Math.round(
    (t.goals || 0) * c.goal[pos] + (t.assists || 0) * c.assist[pos] + (t.shots || 0) * c.shot +
    (t.plus_minus || 0) * c.plusMinus + (t.saves || 0) * c.save + (t.goals_against || 0) * c.goalAgainst +
    (t.wins || 0) * c.win + (t.shutouts || 0) * c.shutout + (t.games || 0) * c.lineup +
    (t.pim || 0) * (c.penalty2 / 2));
}
