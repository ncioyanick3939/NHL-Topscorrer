import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

/*
 * Optional: keep the database in a private GitHub repo, for free hosting without a disk (e.g. Render free).
 * On start the last backup is loaded, then a snapshot is saved every 10 minutes (only when something changed)
 * and when the server shuts down. Each backup replaces the previous one, so the repo does not grow.
 * Needs BACKUP_REPO ("owner/name", private, with at least one commit) and BACKUP_TOKEN (contents: read and write).
 */
const REPO = process.env.BACKUP_REPO;
const TOKEN = process.env.BACKUP_TOKEN;
const API = process.env.BACKUP_API || 'https://api.github.com';
const BRANCH = 'main';
const FILE = 'app.db.gz';
export const backupEnabled = !!(REPO && TOKEN);

let lastHash = null;
let running = null;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`${API}/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nhl-topscorer', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) throw new Error(`Backup ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

/** Load the last backup into dbPath. Throws when GitHub cannot be reached: never start empty over a good backup. */
export async function restore(dbPath) {
  if (!backupEnabled || existsSync(dbPath)) return false;
  const gz = await gh(`/contents/${FILE}?ref=${BRANCH}`, { raw: true });
  if (!gz) return false; // no backup yet: first start
  const db = gunzipSync(gz);
  mkdirSync(dirname(dbPath), { recursive: true });
  writeFileSync(dbPath, db);
  lastHash = sha(db);
  return true;
}

/** Save a consistent snapshot of the open database, if it changed since the last backup. */
export function backup(db) {
  if (!backupEnabled) return Promise.resolve(false);
  running = (running ?? Promise.resolve()).then(async () => {
    const tmp = join(tmpdir(), `nhl-snapshot-${process.pid}.db`);
    rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
    const raw = readFileSync(tmp);
    rmSync(tmp, { force: true });
    const hash = sha(raw);
    if (hash === lastHash) return false;
    const blob = await gh('/git/blobs', { method: 'POST', body: { content: gzipSync(raw).toString('base64'), encoding: 'base64' } });
    const tree = await gh('/git/trees', { method: 'POST', body: { tree: [{ path: FILE, mode: '100644', type: 'blob', sha: blob.sha }] } });
    const commit = await gh('/git/commits', { method: 'POST', body: { message: `Backup ${new Date().toISOString()}`, tree: tree.sha, parents: [] } });
    await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha, force: true } });
    lastHash = hash;
    return true;
  });
  const r = running;
  running = r.catch(() => {});
  return r;
}

export function startBackups(db, { everyMs = 10 * 60_000, log = console.log } = {}) {
  if (!backupEnabled) return;
  const run = () => backup(db).then((saved) => saved && log('Backup gespeichert')).catch((e) => log(e.message));
  setInterval(run, everyMs).unref();
  // Hosting stops the server with SIGTERM (deploy, restart): save the latest state first.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      try { await backup(db); log('Backup beim Beenden gespeichert'); } catch (e) { log(e.message); }
      process.exit(0);
    });
  }
}
