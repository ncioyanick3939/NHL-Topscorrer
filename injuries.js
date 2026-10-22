import { db, tx, getMeta, setMeta } from './db.js';
import { INJURY_URL } from './config.js';

/*
 * The NHL web API has no injury data, so this reads a public injury list (ESPN) and matches
 * players by name. Matching by name is a best guess: if two players share a name, we skip both.
 * If the list cannot be loaded, nothing breaks, the app just shows no injury info.
 */

export const normName = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** ESPN injuries json -> [{name, status: 'out'|'dtd', text, returnDate}] */
export function parseInjuries(json) {
  const out = [];
  for (const group of json.injuries ?? []) {
    for (const i of group.injuries ?? []) {
      const name = i.athlete?.displayName;
      if (!name) continue;
      const raw = String(i.status || '').toLowerCase();
      const status = raw.includes('day') || raw.includes('question') || raw.includes('doubt') ? 'dtd' : 'out';
      const d = i.details || {};
      const text = [d.type, d.detail].filter(Boolean).join(', ') || i.shortComment || i.status || 'verletzt';
      out.push({ name, status, text: String(text).slice(0, 80), returnDate: d.returnDate ? String(d.returnDate).slice(0, 10) : null });
    }
  }
  return out;
}

export function applyInjuries(list) {
  const players = db.prepare('SELECT id, first, last FROM players').all();
  const byName = new Map();
  for (const p of players) {
    const k = normName(`${p.first} ${p.last}`);
    byName.set(k, byName.has(k) ? null : p.id); // null = ambiguous
  }
  let matched = 0;
  tx(() => {
    db.prepare('UPDATE players SET injury_status = NULL, injury_text = NULL, injury_return = NULL').run();
    for (const inj of list) {
      const id = byName.get(normName(inj.name));
      if (!id) continue;
      db.prepare('UPDATE players SET injury_status=?, injury_text=?, injury_return=? WHERE id=?').run(inj.status, inj.text, inj.returnDate, id);
      matched++;
    }
  });
  return matched;
}

export async function syncInjuries({ log = console.log } = {}) {
  const res = await fetch(INJURY_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36', Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Verletztenliste: HTTP ${res.status}`);
  const list = parseInjuries(await res.json());
  const n = applyInjuries(list);
  setMeta('last_injury_sync', Date.now());
  log(`Verletzungen geladen: ${list.length} Einträge, ${n} Spielern zugeordnet`);
  return n;
}

export function injurySyncDue(everyMs) {
  return Date.now() - Number(getMeta('last_injury_sync') || 0) > everyMs;
}
