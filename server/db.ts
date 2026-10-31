// SQLite persistence using Node's built-in driver (no native npm modules to compile).
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config';

// node:sqlite prints an ExperimentalWarning on import; silence only that one.
const origEmit = process.emitWarning;
(process as any).emitWarning = (w: any, ...rest: any[]) => {
  if (String(w?.message ?? w).includes('SQLite')) return;
  return (origEmit as any).call(process, w, ...rest);
};

let DatabaseSync: any;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error('\n✖ DM Studio cần Node.js 22.13 trở lên (dùng SQLite tích hợp sẵn). Bạn đang dùng ' + process.version + '.\n  Cài bản mới: https://nodejs.org hoặc `brew install node`.\n');
  process.exit(1);
}

export const db = new DatabaseSync(path.join(DATA_DIR, 'studio.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, aspect TEXT NOT NULL DEFAULT '16:9',
  data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, mime TEXT, file TEXT NOT NULL,
  bytes INTEGER, source TEXT, meta TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, project_id TEXT, scene_id TEXT, kind TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT, input TEXT NOT NULL, status TEXT NOT NULL,
  remote_id TEXT, remote_meta TEXT, result TEXT, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, polled_at INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, created_at);
CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, asset_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ready',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, provider TEXT, model TEXT, kind TEXT,
  ms INTEGER, ok INTEGER, error TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, notes TEXT,
  folder TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
  pass TEXT, disabled INTEGER NOT NULL DEFAULT 0, last_login INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
`);
// Migration: projects can belong to a customer.
if (!db.prepare('PRAGMA table_info(projects)').all().some((c: any) => c.name === 'customer_id')) {
  db.exec('ALTER TABLE projects ADD COLUMN customer_id TEXT');
}
// Migration: customers can keep their videos in a Google Drive folder reached through the Drive API.
if (!db.prepare('PRAGMA table_info(customers)').all().some((c: any) => c.name === 'gloc')) {
  db.exec('ALTER TABLE customers ADD COLUMN gloc TEXT');
}
// Migration: customer links (Google Sheet, Docs, Facebook…) replace the contact fields in the UI.
if (!db.prepare('PRAGMA table_info(customers)').all().some((c: any) => c.name === 'links')) {
  db.exec('ALTER TABLE customers ADD COLUMN links TEXT');
}

export const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
export const now = () => Date.now();

export function all<T = any>(sql: string, ...args: any[]): T[] { return db.prepare(sql).all(...args) as T[]; }
export function get<T = any>(sql: string, ...args: any[]): T | undefined { return db.prepare(sql).get(...args) as T | undefined; }
export function run(sql: string, ...args: any[]) { return db.prepare(sql).run(...args); }

export function getSetting<T = any>(key: string, fallback: T): T {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}
export function setSetting(key: string, value: any) {
  if (value === undefined || value === null || value === '') run('DELETE FROM settings WHERE key = ?', key);
  else run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
