import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || new URL('./data/app.db', import.meta.url).pathname;
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,          -- NHL player id
  team TEXT NOT NULL,
  first TEXT NOT NULL,
  last TEXT NOT NULL,
  pos TEXT NOT NULL,               -- F, D, G
  number INTEGER,
  headshot TEXT,
  price INTEGER NOT NULL,
  prev_price INTEGER NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  goals INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  plus_minus INTEGER NOT NULL DEFAULT 0,
  shots INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  pim INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  fantasy_pts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS players_team ON players(team);

CREATE TABLE IF NOT EXISTS price_history (
  player_id INTEGER NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,               -- YYYY-MM-DD of the game day
  price INTEGER NOT NULL,
  pts INTEGER NOT NULL DEFAULT 0,  -- fantasy points earned that day
  summary TEXT,                    -- e.g. "1 Tor, 2 Assists"
  PRIMARY KEY (player_id, day)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  balance INTEGER NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roster (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  bought_for INTEGER NOT NULL,
  bought_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, player_id)
);

-- One row per NHL game, filled from the schedule. day = NHL game date (YYYY-MM-DD).
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  start_utc TEXT,
  state TEXT NOT NULL,             -- FUT, PRE, LIVE, CRIT, FINAL, OFF
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER
);
CREATE INDEX IF NOT EXISTS games_day ON games(day);

-- Live stats of a player for one game day. Overwritten on every poll (boxscore is cumulative).
CREATE TABLE IF NOT EXISTS day_stats (
  player_id INTEGER NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  goals INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  shots INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  pim INTEGER NOT NULL DEFAULT 0,
  plus_minus INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  win INTEGER NOT NULL DEFAULT 0,
  shutout INTEGER NOT NULL DEFAULT 0,
  pts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day)
);

-- A day is finalized once: prices move, season stats and manager points are booked.
CREATE TABLE IF NOT EXISTS days (
  day TEXT PRIMARY KEY,
  finalized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_day_points (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  pts INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- Transfer market: a player is on offer until expires_at (48 hours after he was listed).
CREATE TABLE IF NOT EXISTS market_listings (
  player_id INTEGER PRIMARY KEY REFERENCES players(id),
  listed_at TEXT NOT NULL,         -- ISO time
  expires_at TEXT NOT NULL         -- ISO time
);

-- Every buy and sell, for the league ticker and the transfer history of a player.
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL,              -- 'buy' | 'sell'
  price INTEGER NOT NULL,
  at TEXT NOT NULL                 -- ISO time
);
CREATE INDEX IF NOT EXISTS transfers_at ON transfers(at);

-- Sealed bids. Nobody sees other people's bids; only the seller of a user listing sees the offers for his player.
CREATE TABLE IF NOT EXISTS bids (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  amount INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (user_id, player_id)
);
-- A manager offers one of his players to the others.
CREATE TABLE IF NOT EXISTS user_listings (
  player_id INTEGER PRIMARY KEY REFERENCES players(id),
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
-- What happened to my bids (won or lost), shown in "Meine Gebote".
CREATE TABLE IF NOT EXISTS bid_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  amount INTEGER NOT NULL,
  won INTEGER NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

/* ---------- Migrations: add columns to databases created by older versions ---------- */
function addColumn(table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}
addColumn('players', 'injury_status', 'TEXT');   // 'out' | 'dtd' | NULL
addColumn('players', 'injury_text', 'TEXT');
addColumn('players', 'injury_return', 'TEXT');
addColumn('roster', 'lineup', 'INTEGER NOT NULL DEFAULT -1'); // -1 not placed, 0 bench, 1-3 line, 9 goalie
addColumn('users', 'starter_given', 'INTEGER NOT NULL DEFAULT 0');

export function getMeta(key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}
export function setMeta(key, value) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

/** Run fn inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
