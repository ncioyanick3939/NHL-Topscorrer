// Start for free hosting (Render free): load the database backup, start the server, keep it awake.
import { join } from 'node:path';
import { restore, startBackups, backupEnabled } from './backup.js';

const DATA_DIR = process.env.DATA_DIR || new URL('./data', import.meta.url).pathname;
const dbPath = process.env.DB_PATH || join(DATA_DIR, 'app.db');

if (backupEnabled) {
  try {
    console.log((await restore(dbPath)) ? 'Datenbank aus dem Backup geladen' : 'Kein Backup geladen (erster Start oder Datenbank vorhanden)');
  } catch (e) {
    // Never start with an empty database: its first backup would overwrite the good one. The host restarts us.
    console.error(`Backup konnte nicht geladen werden, Start abgebrochen: ${e.message}`);
    process.exit(1);
  }
} else {
  console.log('Hinweis: BACKUP_REPO/BACKUP_TOKEN fehlen, die Datenbank wird nicht gesichert.');
}

const { db } = await import('./db.js');
await import('./server.js');
startBackups(db);

// Free hosts put the app to sleep after some minutes without visitors; a request to itself keeps it running.
const self = process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL;
if (self) setInterval(() => fetch(`${self}/healthz`).catch(() => {}), 10 * 60_000).unref();
