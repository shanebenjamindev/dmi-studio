// Cloudflare D1 in production; built-in SQLite for local Node development.
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, IS_CLOUDFLARE } from './config';
import { SCHEMA } from './schema';

export type SqlValue = string | number | bigint | null | ArrayBuffer | Uint8Array;
export interface SqlResult { rows: any[]; rowsAffected: number; lastInsertRowid?: number | bigint }
export interface SqlClient {
  execute(statement: string | { sql: string; args?: SqlValue[] }): Promise<SqlResult>;
  executeMultiple(sql: string): Promise<void>;
  close(): void;
}
interface D1Result { results?: any[]; meta: { changes?: number; last_row_id?: number } }
interface D1Statement {
  bind(...args: any[]): D1Statement;
  all(): Promise<D1Result>;
}
export interface D1Binding {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
}
export const cloudDatabase = IS_CLOUDFLARE;
export let db: SqlClient;
function d1Client(binding: D1Binding): SqlClient {
  return {
    async execute(statement) {
      const { sql, args = [] } = typeof statement === 'string' ? { sql: statement } : statement;
      const normalized = args.map(value => typeof value === 'bigint' ? Number(value) : value);
      const stmt = binding.prepare(sql);
      const result = await (normalized.length ? stmt.bind(...normalized) : stmt).all();
      return { rows: result.results || [], rowsAffected: result.meta.changes || 0, lastInsertRowid: result.meta.last_row_id };
    },
    async executeMultiple(sql) {
      // Only used for the static application schema, never user-provided SQL.
      await binding.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => binding.prepare(s)));
    },
    close() {},
  };
}
async function localClient(): Promise<SqlClient> {
  const { DatabaseSync } = await import('node:sqlite');
  const local = new DatabaseSync(path.join(DATA_DIR, 'studio.db'));
  return {
    async execute(statement) {
      const { sql, args = [] } = typeof statement === 'string' ? { sql: statement } : statement;
      const stmt = local.prepare(sql);
      const normalized = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      if (stmt.columns().length) {
        const rows = stmt.all(...normalized);
        const meta = local.prepare('SELECT changes() n, last_insert_rowid() id').get() as any;
        return { rows, rowsAffected: /^(INSERT|UPDATE|DELETE)/i.test(sql.trim()) ? Number(meta.n) : 0, lastInsertRowid: meta.id };
      }
      const result = stmt.run(...normalized);
      return { rows: [], rowsAffected: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
    },
    async executeMultiple(sql) { local.exec(sql); },
    close() { local.close(); },
  };
}
let initialized: Promise<void> | undefined;
export function initDatabase(binding?: D1Binding): Promise<void> {
  return initialized ||= initialize(binding).catch(error => { initialized = undefined; throw error; });
}
async function initialize(binding?: D1Binding) {
  if (IS_CLOUDFLARE && !binding) throw new Error('Thiếu Cloudflare D1 binding DB');
  db ||= IS_CLOUDFLARE ? d1Client(binding!) : await localClient();
  if (!IS_CLOUDFLARE) {
    await db.execute('PRAGMA journal_mode=WAL');
    await db.execute('PRAGMA foreign_keys=ON');
  }
  await db.executeMultiple(SCHEMA);
  for (const [table, column] of [['projects', 'customer_id'], ['customers', 'gloc'], ['customers', 'links']]) {
    const info = await db.execute(`PRAGMA table_info(${table})`);
    if (!info.rows.some(c => c.name === column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
  }
}
if (!IS_CLOUDFLARE) await initDatabase();

export const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
export const now = () => Date.now();

export async function all<T = any>(sql: string, ...args: SqlValue[]): Promise<T[]> {
  return (await db.execute({ sql, args })).rows as unknown as T[];
}
export async function get<T = any>(sql: string, ...args: SqlValue[]): Promise<T | undefined> {
  return (await all<T>(sql, ...args))[0];
}
export async function run(sql: string, ...args: SqlValue[]) {
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
