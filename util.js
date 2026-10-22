import { RULES } from './config.js';

/** Current date and hour in Zurich. */
export function zurichNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RULES.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) };
}

export function dayAfter(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** True once prices of game day `day` may move: next day at the rollover hour (Zurich). */
export function rolloverReached(day, now = new Date()) {
  const z = zurichNow(now);
  const next = dayAfter(day);
  return z.date > next || (z.date === next && z.hour >= RULES.rolloverHourZurich);
}

export function fmtPrice(n) {
  return Math.round(n).toLocaleString('de-CH');
}
