// Hosting và giới hạn: how much the Cloudflare account holds and uses against the Workers Free limits (every D1 database,
// rows read and written today, Workers requests), and a SQL console for Super Admins. The account's figures come from the
// Cloudflare API and need a token (CF_API_TOKEN, CF_ACCOUNT_ID); without one the page shows this database and the limits.
// The daily limits reset at 00:00 UTC (7:00 in Vietnam).
import { db, get, cloudDatabase } from '../db';
import { HttpError, json, readJson, type Router } from '../http';
import { need, logAction, type Ctx } from './common';

// Workers Free: developers.cloudflare.com/d1/platform/limits, /d1/platform/pricing and /workers/platform/limits (checked 2026-11-11).
export const LIMITS = { databases: 10, databaseBytes: 500e6, accountBytes: 5e9, rowsRead: 5e6, rowsWritten: 1e5, requests: 1e5, workers: 100,
  cpu: '10 ms', queriesPerRequest: 50, timeTravelDays: 7, assetFiles: 20000 };

const CF = 'https://api.cloudflare.com/client/v4';
const cfConfig = () => ({ token: process.env.CF_API_TOKEN?.trim() || '', account: process.env.CF_ACCOUNT_ID?.trim() || '', current: process.env.CF_D1_DATABASE_ID?.trim() || '' });
async function cf<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { token, account } = cfConfig();
  const res = await fetch(`${CF}/accounts/${account}${path}`, {
    method: init.method || 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(10000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.errors?.[0]?.message || `Cloudflare trả lỗi ${res.status}`);
  return data.result;
}
async function analytics(query: string, variables: Record<string, string>) {
  const res = await fetch(`${CF}/graphql`, {
    method: 'POST', headers: { authorization: `Bearer ${cfConfig().token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data?.viewer?.accounts?.[0] || {};
}
const USAGE = `query($a: String!, $today: Date!) { viewer { accounts(filter: { accountTag: $a }) {
  today: d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $today, date_leq: $today }) { sum { readQueries writeQueries rowsRead rowsWritten } dimensions { databaseId } }
  workers: workersInvocationsAdaptive(limit: 100, filter: { date_geq: $today, date_leq: $today }) { sum { requests errors } dimensions { scriptName } }
} } }`;
interface Usage { rowsRead: number; rowsWritten: number; readQueries: number; writeQueries: number }
const noUsage = (): Usage => ({ rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0 });
const byDatabase = (groups: any[] = []) => new Map(groups.map((g) => [g.dimensions.databaseId as string, { ...noUsage(), ...g.sum } as Usage]));
const addUp = (list: Usage[]) => list.reduce((t, u) => ({ rowsRead: t.rowsRead + u.rowsRead, rowsWritten: t.rowsWritten + u.rowsWritten, readQueries: t.readQueries + u.readQueries, writeQueries: t.writeQueries + u.writeQueries }), noUsage());

async function thisDatabase() {
  const pages = await get<any>('PRAGMA page_count').catch(() => null), size = await get<any>('PRAGMA page_size').catch(() => null);
  const tables = await get<any>("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").catch(() => null);
  return { name: cloudDatabase ? 'dmi-studio-db' : 'studio.db (máy này)', bytes: Number(pages?.page_count || 0) * Number(size?.page_size || 0) || null, tables: Number(tables?.n || 0), cloud: cloudDatabase };
}

async function account() {
  const { token, account: id, current } = cfConfig();
  if (!token || !id) return { configured: false as const };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [list, usage, scripts] = await Promise.all([
      cf<any[]>('/d1/database?per_page=100'),
      analytics(USAGE, { a: id, today }),
      cf<any[]>('/workers/scripts').catch(() => null),
    ]);
    // The list leaves the number of tables out; each database's own record has it.
    const details = await Promise.all(list.slice(0, 20).map((d) => cf<any>(`/d1/database/${d.uuid}`).catch(() => null)));
    const day = byDatabase(usage.today);
    const databases = list.map((d, i) => ({
      id: d.uuid as string, name: d.name as string, bytes: Number(details[i]?.file_size ?? d.file_size ?? 0), tables: details[i]?.num_tables ?? null,
      region: details[i]?.running_in_region || null, createdAt: Date.parse(d.created_at) || null, current: cloudDatabase && d.uuid === current,
      today: day.get(d.uuid) || noUsage(),
    })).sort((a, b) => Number(b.current) - Number(a.current) || b.bytes - a.bytes);
    const used = new Map<string, any>((usage.workers || []).map((w: any) => [w.dimensions.scriptName, w.sum]));
    const names = scripts ? scripts.map((s) => s.id as string) : [...used.keys()];
    const workers = names.map((name) => ({ name, today: Number(used.get(name)?.requests || 0), errorsToday: Number(used.get(name)?.errors || 0) }))
      .sort((a, b) => b.today - a.today);
    return {
      configured: true as const, databases, workers,
      totals: { databases: databases.length, bytes: databases.reduce((s, d) => s + d.bytes, 0), today: addUp(databases.map((d) => d.today)),
        workers: workers.length, requestsToday: workers.reduce((s, w) => s + w.today, 0) },
    };
  } catch (e: any) {
    return { configured: true as const, error: String(e?.message || e) };
  }
}

// ---------------------------------------------------------------- SQL console
/** Splits a script into statements at the semicolons outside quotes and comments; a trigger's body stays whole. */
export function splitSql(sql: string): string[] {
  const parts: string[] = [];
  let cur = '', i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      for (; j < sql.length; j++) { if (sql[j] === close) { if (close !== ']' && sql[j + 1] === close) { j++; continue; } break; } }
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '-' && sql[i + 1] === '-') { const j = sql.indexOf('\n', i); cur += sql.slice(i, j < 0 ? sql.length : j); i = j < 0 ? sql.length : j; continue; }
    if (ch === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); cur += sql.slice(i, j < 0 ? sql.length : j + 2); i = j < 0 ? sql.length : j + 2; continue; }
    if (ch === ';') { parts.push(cur); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  parts.push(cur);
  const out: string[] = [];
  let trigger = '';
  for (const p of parts) {
    if (trigger) { trigger += ';' + p; if (/\bEND\s*$/i.test(bare(trigger))) { out.push(trigger.trim()); trigger = ''; } continue; }
    if (/^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(bare(p)) && !/\bEND\s*$/i.test(bare(p))) { trigger = p; continue; }
    if (bare(p)) out.push(p.trim());
  }
  if (trigger) out.push(trigger.trim());
  return out;
}
/** The statement without comments and with every quoted text emptied, to look at its keywords. */
const bare = (s: string) => s.replace(/--[^\n]*|\/\*[\s\S]*?(\*\/|$)/g, ' ').replace(/'(?:[^']|'')*'?|"(?:[^"]|"")*"?|`[^`]*`?|\[[^\]]*\]?/g, "''").trim();
/** Only reads: SELECT, EXPLAIN, VALUES, a WITH that changes nothing, and PRAGMAs that set nothing. */
export function readsOnly(s: string) {
  const b = bare(s), word = b.match(/^\w+/)?.[0]?.toUpperCase();
  if (word === 'SELECT' || word === 'EXPLAIN' || word === 'VALUES') return true;
  if (word === 'WITH') return !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(b);
  if (word === 'PRAGMA') return !b.includes('=') && !/^PRAGMA\s+(\w+\.)?(optimize|wal_checkpoint|incremental_vacuum|shrink_memory)\b/i.test(b);
  return false;
}
// Writing the database out to another file, or opening one, reaches the server's disk: never from here.
const REFUSED = /^(ATTACH|DETACH)\b|^VACUUM\b[\s\S]*\bINTO\b/i;
const MAX_ROWS = 1000, MAX_STATEMENTS = 20, MAX_CELL = 5000;
const cell = (v: unknown) => v instanceof Uint8Array || v instanceof ArrayBuffer ? `<BLOB ${(v as ArrayBufferLike).byteLength} bytes>`
  : Array.isArray(v) ? `<BLOB ${v.length} bytes>` : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && v.length > MAX_CELL ? v.slice(0, MAX_CELL) + '…' : v;
function table(rows: any[]) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.slice(0, MAX_ROWS).map((r) => columns.map((c) => cell(r[c]))), rowCount: rows.length, truncated: rows.length > MAX_ROWS };
}

async function runHere(sql: string) {
  const t = Date.now(), r = await db.execute(sql);
  return { ...table(r.rows), changes: r.rowsAffected, ms: Date.now() - t, rowsRead: null as number | null };
}
async function runThere(id: string, sql: string) {
  const t = Date.now(), [r] = await cf<any[]>(`/d1/database/${id}/query`, { method: 'POST', body: { sql } });
  if (r && r.success === false) throw new Error(r.error || 'Câu lệnh lỗi');
  return { ...table(r?.results || []), changes: Number(r?.meta?.changes || 0), ms: Math.round(r?.meta?.duration ?? Date.now() - t), rowsRead: r?.meta?.rows_read ?? null };
}

const superAdmin = (c: Ctx) => { if (c.user.role !== 'admin') throw new HttpError(403, 'Chỉ Super Admin mới chạy được SQL'); };

let cached: { data: any; at: number } | null = null;
export function registerHosting(api: Router) {
  api.get('/api/admin/hosting', async (req, res) => {
    await need(req, 'settings.view');
    const refresh = /[?&]refresh=1\b/.test(req.url || '');
    if (!refresh && cached && Date.now() - cached.at < 60000) return json(res, 200, cached.data);
    const data = { limits: LIMITS, database: await thisDatabase(), cloudflare: await account(), at: Date.now() };
    cached = { data, at: Date.now() };
    json(res, 200, data);
  });
  api.post('/api/admin/sql', async (req, res) => {
    const c = await need(req, 'settings.update');
    superAdmin(c);
    const b = await readJson(req), sql = String(b.sql || '');
    if (!sql.trim()) throw new HttpError(400, 'Nhập câu lệnh SQL');
    if (sql.length > 100_000) throw new HttpError(400, 'Câu lệnh dài quá 100 KB');
    const statements = splitSql(sql);
    if (statements.length > MAX_STATEMENTS) throw new HttpError(400, `Mỗi lần chạy tối đa ${MAX_STATEMENTS} câu lệnh`);
    if (statements.some((s) => REFUSED.test(bare(s)))) throw new HttpError(400, 'ATTACH, DETACH và VACUUM INTO không chạy được ở đây');
    const writes = statements.filter((s) => !readsOnly(s)).length;
    if (writes && !b.allowWrite) throw new HttpError(400, 'Có câu lệnh thay đổi dữ liệu: bật “Cho phép sửa dữ liệu” để chạy');
    // Another database of the account goes through the Cloudflare API; the one this app uses through its own connection.
    const target = String(b.database || '');
    let name = (await thisDatabase()).name, run = runHere;
    if (target && target !== cfConfig().current) {
      if (!cfConfig().token || !cfConfig().account) throw new HttpError(400, 'Chưa có token Cloudflare để mở database khác');
      const found = (await cf<any[]>('/d1/database?per_page=100')).find((d) => d.uuid === target);
      if (!found) throw new HttpError(404, 'Không tìm thấy database này trên tài khoản');
      name = found.name; run = (s) => runThere(target, s);
    }
    // Logged before it runs, so a statement that fails or wipes the logs is on record too.
    await logAction(c, writes ? 'Chạy SQL (sửa dữ liệu)' : 'Chạy SQL', `${name}: ${sql.slice(0, 1000)}`, 'database');
    const results: any[] = [];
    for (const [index, s] of statements.entries()) {
      try { results.push({ sql: s, reads: readsOnly(s), ...(await run(s)) }); }
      catch (e: any) { return json(res, 200, { database: name, results, error: { index, sql: s, message: String(e?.message || e).replace(/^D1_ERROR:\s*/, '') } }); }
    }
    if (writes) cached = null;
    json(res, 200, { database: name, results });
  });
}
