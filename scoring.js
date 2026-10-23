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

const RESULT_LABEL = { W: 'Sieg', OTW: 'Sieg n.V./Penaltys', L: 'Niederlage', OTL: 'Niederlage n.V.', SOL: 'Niederlage Penaltyschiessen' };

/**
 * How the points of one player in one game come about, line by line: [{ label, n, pts }].
 * n = how often (null for one-off bonuses). statsToPoints is the sum of these lines, so both always match.
 */
export function pointsBreakdown(s) {
  const c = SCORING;
  const pos = s.pos === 'D' || s.pos === 'G' ? s.pos : 'F';
  const rows = [];
  const add = (label, n, per) => { if (n && per) rows.push({ label, n, pts: n * per }); };
  const once = (label, on, pts) => { if (on && pts) rows.push({ label, n: null, pts }); };
  add('Tor', s.goals, c.goal[pos]);
  add('Assist', s.assists, c.assist[pos]);
  add('Powerplay-Tor (Bonus)', s.pp_goals, c.powerplayGoal);
  add('Unterzahl-Tor (Bonus)', s.sh_goals, c.shGoal);
  once('Hattrick', (s.goals || 0) >= 3, c.hattrick);
  add('Powerplay-Assist (Bonus)', s.pp_assists, c.ppAssist);
  add('Unterzahl-Assist (Bonus)', s.sh_assists, c.shAssist);
  add('Siegtor', s.gwg, c.gwg);
  add('Siegtor Penaltyschiessen', s.pwg, c.pwg);
  add('Schuss aufs Tor', s.shots, c.shot);
  add('Fehlschuss/Pfosten', s.missed, c.missedShot);
  add('Geblockter Schuss', s.blocked, c.blocked);
  add('Plus/Minus', s.plus_minus, c.plusMinus);
  add('Bully gewonnen', s.fo_won, c.faceoffWon);
  add('Bully verloren', s.fo_lost, c.faceoffLost);
  add('Parade', s.saves, c.save);
  add('Gegentor', s.goals_against, c.goalAgainst);
  once('Shutout', s.shutout, c.shutout);
  once('Zero Against', s.zero_against && (pos === 'G' || pos === 'D'), c.zeroAgainst);
  once('Im Spiel dabei', s.dressed, c.lineup);
  add('Eiszeit (Minuten)', s.toi_min, c.timeOnIce);
  add('Torhüter-Zeitbonus (pro 10 Min.)', s.goalie_time, c.goalieTime);
  const pen = s.pen_pts != null ? s.pen_pts : penaltyPoints(s.pim);
  if (pen) rows.push({ label: 'Strafen', n: s.pim || null, pts: pen });
  once(RESULT_LABEL[s.result] ?? '', s.result, resultPoints(s.result));
  return rows;
}

/** Fantasy points from one player's stats of one game (Topscorers rules). Pure function. */
export function statsToPoints(s) {
  return Math.round(pointsBreakdown(s).reduce((sum, r) => sum + r.pts, 0));
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
