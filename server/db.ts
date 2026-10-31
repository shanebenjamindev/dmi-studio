// One async SQL interface for local SQLite and the shared Turso cloud database.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { createClient, type InValue } from '@libsql/client';
import { DATA_DIR } from './config';

const url = process.env.TURSO_DATABASE_URL?.trim();
const token = process.env.TURSO_AUTH_TOKEN?.trim();
export const cloudDatabase = !!url;
if (!!url !== !!token) throw new Error('Cần đặt cả TURSO_DATABASE_URL và TURSO_AUTH_TOKEN');
if (url && !/^(libsql|https):\/\//.test(url)) throw new Error('TURSO_DATABASE_URL phải dùng libsql:// hoặc https://');
if (process.env.RENDER && !url) throw new Error('Render cần database cloud: hãy đặt TURSO_DATABASE_URL và TURSO_AUTH_TOKEN');
export const db = createClient({
  url: url || pathToFileURL(path.join(DATA_DIR, 'studio.db')).href,
  authToken: token,
});
// Never fall back to a local database if the cloud is unavailable.
await db.execute('SELECT 1');
if (!cloudDatabase) await db.execute('PRAGMA journal_mode = WAL');
await db.execute('PRAGMA foreign_keys = ON');
await db.executeMultiple(`
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
// Upgrade existing local or cloud databases without changing their data.
for (const [table, column] of [['projects', 'customer_id'], ['customers', 'gloc'], ['customers', 'links']]) {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  if (!info.rows.some((c) => c.name === column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
}

export const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
export const now = () => Date.now();

export async function all<T = any>(sql: string, ...args: InValue[]): Promise<T[]> {
  return (await db.execute({ sql, args })).rows as unknown as T[];
}
export async function get<T = any>(sql: string, ...args: InValue[]): Promise<T | undefined> {
  return (await all<T>(sql, ...args))[0];
}
export async function run(sql: string, ...args: InValue[]) {
  const result = await db.execute({ sql, args });
  return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
}
export async function getSetting<T = any>(key: string, fallback: T): Promise<T> {
  const row = await get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}
export async function setSetting(key: string, value: any) {
  if (value === undefined || value === null || value === '') await run('DELETE FROM settings WHERE key = ?', key);
  else await run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
