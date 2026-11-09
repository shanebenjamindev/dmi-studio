// Cloudflare D1 in production; built-in SQLite for local Node development.
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, IS_CLOUDFLARE } from './config';
import { CUSTOMER_STATUS } from '../shared/customers';
import { SCHEMA } from './schema';
import { DEFAULT_ROLES, SUPER_ADMIN } from '../shared/permissions';

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
  // A database this code already upgraded is used as it is: a cold start reads one setting instead of running the
  // upgrade again (some sixty statements in a row, about two seconds on D1 before the first answer). A new database
  // has no settings table yet.
  if (await getSetting<string | null>('schema_version', null).catch(() => null) === schemaVersion()) return;
  await upgrade();
  await setSetting('schema_version', schemaVersion());
}
/** What the upgrade below does, as a short hash: any change to the schema, the upgrade, the seeds or the repairs runs
 *  them once more on the next cold start. */
let version = '';
const schemaVersion = () => version ||= crypto.createHash('sha256')
  .update([SCHEMA, upgrade, seedAdmin, repairData, JSON.stringify(DEFAULT_ROLES), JSON.stringify(CUSTOMER_STATUS)].map(String).join('\n')).digest('hex').slice(0, 16);
async function upgrade() {
  await db.executeMultiple(SCHEMA);
  // Columns added after a table was first made, with their type.
  const columns = new Map<string, string[]>();
  for (const [table, column, type = 'TEXT'] of [['task_projects','created_by'],['task_projects','team_id'],['projects', 'customer_id'], ['notification_preferences','email'],['notification_preferences','verified_at','INTEGER'],['notification_preferences','pending_email'],['notification_preferences','verification_hash'],['notification_preferences','verification_expires','INTEGER'],['notification_preferences','verification_attempts','INTEGER NOT NULL DEFAULT 0'],['notification_preferences','verification_sent_at','INTEGER'], ['customers','created_by'], ['customers', 'gloc'], ['customers', 'links'], ['users', 'team_role'], ['boards', 'about'],
    ['board_lists', 'archived', 'INTEGER NOT NULL DEFAULT 0'], ['board_cards', 'description'], ['board_cards', 'start_at', 'INTEGER'], ['board_cards', 'due_at', 'INTEGER'],
    ['board_cards', 'done', 'INTEGER NOT NULL DEFAULT 0'], ['board_cards', 'cover'], ['board_cards', 'archived', 'INTEGER NOT NULL DEFAULT 0'],
    ['boards', 'workspace_id'], ['boards', 'private', 'INTEGER NOT NULL DEFAULT 0'], ['workspaces', 'visibility', "TEXT NOT NULL DEFAULT 'private'"], ['users', 'dept_role'],
    ['oauth_states','owner_id'], ['tasks','campaign_id'], ['task_project_members','follows','INTEGER NOT NULL DEFAULT 1'], ['board_cards', 'card_kind', "TEXT NOT NULL DEFAULT 'task'"], ['board_cards', 'project_card_id'], ['board_cards', 'work_project_id'], ['board_cards', 'customer_id'], ['card_attachments', 'customer_id'], ['card_attachments', 'file_key'], ['tasks', 'description_by'], ['board_cards', 'description_by'], ['board_cards', 'result'],
    // Admin module (server/admin/*): staff profiles, session origin, task priority, label colour, customer records.
    ['users', 'phone'], ['users', 'manager_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL'], ['users', 'avatar_at', 'INTEGER'], ['sessions', 'ip'], ['sessions', 'agent'],
    ['tasks', 'priority_id', 'TEXT REFERENCES task_priorities(id) ON DELETE SET NULL'], ['task_labels', 'color'], ['notifications', 'broadcast_id'],
    ['customers', 'category_id', 'TEXT REFERENCES customer_categories(id) ON DELETE SET NULL'], ['customers', 'source_id', 'TEXT REFERENCES customer_sources(id) ON DELETE SET NULL'],
    ['customers', 'status'], ['customers', 'manager_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL'], ['customers', 'archived_at', 'INTEGER'], ['customers', 'updated_by'], ['customers', 'code'],
    // A board's own look and who reshapes it (lists, labels, name, background): its admins, or its members if they allow it.
    ['boards', 'member_edit', 'INTEGER NOT NULL DEFAULT 0'], ['boards', 'label_text', 'INTEGER NOT NULL DEFAULT 0'], ['board_lists', 'folded', 'INTEGER NOT NULL DEFAULT 0'],
    // The order someone put their quick notes in (dragged); new ones go first.
    ['quick_notes', 'pos', 'REAL'],
    // The customer a board is for, whether its editors may share it, and what sharing a board opened (closed when unshared).
    ['boards', 'customer_id'], ['boards', 'editor_share', 'INTEGER NOT NULL DEFAULT 1'],
    ['task_project_members', 'via_board'], ['customer_members', 'via_board'],
    // A project its managers put on hold or cancelled (shared/projects.ts); otherwise its stage follows its tasks.
    ['task_projects', 'hold'],
    // A list's own colour (the whole column), one of the cards' cover colours.
    ['board_lists', 'color']]) {
    // One look at each table's columns, not one per column: every cold start on D1 runs this.
    const info = columns.get(table) || (await db.execute(`PRAGMA table_info(${table})`)).rows.map(c => c.name as string);
    columns.set(table, info);
    if (!info.includes(column)) { await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); info.push(column); }
  }
  await db.execute('CREATE INDEX IF NOT EXISTS notifications_broadcast ON notifications(broadcast_id)');
  await seedAdmin();
  await repairData();
}
/** Data a change elsewhere may leave out of step, set right: after each upgrade, and by the cron every ten minutes
 *  (they read whole tables, so not on every cold start). */
export async function repairData() {
  // Project cards without their project get one, keeping their existing child tasks.
  await db.execute("INSERT OR IGNORE INTO task_projects(id,name,created_by,created_at) SELECT 'tj_card_'||id,title,created_by,created_at FROM board_cards WHERE card_kind='project' AND work_project_id IS NULL");
  await db.execute("UPDATE board_cards SET work_project_id='tj_card_'||id WHERE card_kind='project' AND work_project_id IS NULL");
  await db.execute("UPDATE tasks SET project_id=(SELECT p.work_project_id FROM task_board_links l JOIN board_cards c ON c.id=l.card_id JOIN board_cards p ON p.id=c.project_card_id WHERE l.task_id=tasks.id) WHERE project_id IS NULL AND EXISTS(SELECT 1 FROM task_board_links l JOIN board_cards c ON c.id=l.card_id JOIN board_cards p ON p.id=c.project_card_id WHERE l.task_id=tasks.id AND p.work_project_id IS NOT NULL)");
  // Company admins are Super Admins.
  await db.execute({ sql: "INSERT OR IGNORE INTO user_roles(user_id,role_id,created_at) SELECT id,'role_super_admin',? FROM users WHERE role='admin'", args: [Date.now()] });
  await db.execute("UPDATE task_projects SET created_by=COALESCE((SELECT c.created_by FROM customers c WHERE c.id=task_projects.customer_id),(SELECT i.user_id FROM task_imports i JOIN tasks t ON t.import_id=i.id WHERE t.project_id=task_projects.id ORDER BY i.created_at LIMIT 1),(SELECT id FROM users WHERE role='admin' AND disabled=0 ORDER BY created_at,id LIMIT 1)) WHERE created_by IS NULL");
  await db.execute("UPDATE mail_outbox SET state='cancelled',error='Cần xác minh email cá nhân để nhận thư' WHERE state='pending' AND user_id IN(SELECT user_id FROM notification_preferences WHERE email IS NULL OR verified_at IS NULL)");
  // Existing ownerless starter boards belong to the original administrator; no implicit admin access remains.
  await db.execute("UPDATE boards SET created_by=(SELECT id FROM users WHERE role='admin' AND disabled=0 ORDER BY created_at,id LIMIT 1) WHERE created_by IS NULL AND EXISTS(SELECT 1 FROM users WHERE role='admin' AND disabled=0)");
  await db.execute('UPDATE boards SET private=1 WHERE private<>1');
  await db.execute("INSERT OR IGNORE INTO task_campaigns(id,project_id,name,created_at) SELECT 'tc_existing_'||p.id,p.id,'Công việc hiện có',p.created_at FROM task_projects p WHERE EXISTS(SELECT 1 FROM tasks t WHERE t.project_id=p.id AND t.campaign_id IS NULL)");
  await db.execute("UPDATE tasks SET campaign_id='tc_existing_'||project_id WHERE project_id IS NOT NULL AND campaign_id IS NULL");
  // A task dragged into a board's done column before the column's meaning was used took the column's name as its status
  // ("Xong"): it gets the task workflow's own, done late when finished after its due date.
  await db.execute("UPDATE tasks SET status=CASE WHEN due_at IS NOT NULL AND done_at > due_at THEN 'Hoàn thành muộn' ELSE 'Hoàn thành' END WHERE status IN ('Xong','Đã xong','Hoàn tất','Đã hoàn thành','Done','Completed')");
}
/** The built-in roles (their default permissions only when first made) and the task statuses and priorities the Tasks
 *  page started with, once: what admins later change or remove stays so. */
async function seedAdmin() {
  const t = Date.now(), have = new Set((await db.execute('SELECT key FROM roles WHERE key IS NOT NULL')).rows.map(r => r.key));
  for (const r of DEFAULT_ROLES.filter(r => !have.has(r.key))) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO roles(id,key,name,about,rank,system,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)', args: ['role_' + r.key, r.key, r.name, r.about, r.rank, t, t] });
    // Super Admin holds every permission in code, whatever its rows say.
    if (r.key !== SUPER_ADMIN) for (const [perm, scope] of Object.entries(r.perms)) await db.execute({ sql: 'INSERT OR IGNORE INTO role_permissions(role_id,perm,scope) VALUES(?,?,?)', args: ['role_' + r.key, perm, scope] });
  }
  const seeded = await getSetting<string[]>('admin_seeded', []);
  const lists: [string, [string, string][]][] = [
    ['task_statuses', [['Chưa thực hiện', '#94a3b8'], ['Đang thực hiện', '#0b7df2'], ['Đang đánh giá', '#8b5cf6'], ['Tạm dừng', '#f59e0b'], ['Hoàn thành', '#16a34a'], ['Hoàn thành muộn', '#65a30d'], ['Đã huỷ', '#ef4444']]],
    ['task_priorities', [['Thấp', '#94a3b8'], ['Trung bình', '#0b7df2'], ['Cao', '#f59e0b'], ['Khẩn cấp', '#d62828']]],
  ];
  for (const [table, rows] of lists.filter(([table]) => !seeded.includes(table))) {
    for (const [i, [name, color]] of rows.entries()) await db.execute({ sql: `INSERT OR IGNORE INTO ${table}(id,name,color,pos,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`, args: [uid(table === 'task_statuses' ? 'ts_' : 'tp_'), name, color, i + 1, t, t] });
    seeded.push(table);
  }
  if(!seeded.includes('customer_statuses')) {
    const colors=['#94a3b8','#0b7df2','#16a34a','#f59e0b','#64748b'];
    for(const [i,[id,name]] of Object.entries(CUSTOMER_STATUS).entries())await db.execute({sql:'INSERT OR IGNORE INTO customer_statuses(id,name,color,pos,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)',args:[id,name,colors[i],i+1,t,t]});
    // Preserve any historic custom values as selectable statuses with their existing identifiers.
    await db.execute({sql:"INSERT OR IGNORE INTO customer_statuses(id,name,color,pos,active,created_at,updated_at) SELECT DISTINCT status,status,'#64748b',100,1,?,? FROM customers WHERE status IS NOT NULL AND status<>''",args:[t,t]});
    seeded.push('customer_statuses');
  }
  // The Excel import used to put the customer's code into its notes; it has a field of its own, not shown.
  if (!seeded.includes('customer_code')) {
    for (const c of (await db.execute("SELECT id, notes FROM customers WHERE code IS NULL AND notes LIKE '%Mã khách hàng: %'")).rows) {
      const m = String(c.notes).match(/^Mã khách hàng: (.*)$/m);
      if (m) await db.execute({ sql: 'UPDATE customers SET code = ?, notes = ? WHERE id = ?', args: [m[1].trim(), String(c.notes).replace(/^Mã khách hàng: .*(\r?\n|$)/m, '').trim(), c.id] });
    }
    seeded.push('customer_code');
  }
  // Customers carry tags now (the categories are the tag list); a customer's one category becomes its first tag.
  if (!seeded.includes('customer_tags')) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO customer_tags(customer_id,tag_id,created_at) SELECT id,category_id,? FROM customers WHERE category_id IS NOT NULL AND category_id IN (SELECT id FROM customer_categories)', args: [t] });
    seeded.push('customer_tags');
  }
  // Where customers come from, to pick at once (Quản trị › Khách hàng › Nguồn changes the list).
  if (!seeded.includes('customer_sources')) {
    if (!(await db.execute('SELECT 1 FROM customer_sources LIMIT 1')).rows.length)
      for (const [i, [name, color]] of ([['Facebook Ads', '#1877f2'], ['Google Ads', '#ea4335'], ['Website', '#0b7df2'], ['Giới thiệu', '#16a34a'], ['Khách cũ', '#8b5cf6'], ['Sự kiện', '#f59e0b'], ['Khác', '#64748b']] as const).entries())
        await db.execute({ sql: 'INSERT OR IGNORE INTO customer_sources(id,name,color,pos,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)', args: [uid('cus_'), name, color, i + 1, t, t] });
    seeded.push('customer_sources');
  }
  await setSetting('admin_seeded', seeded);
}

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
// Last, so everything above (uid, getSetting…) exists while the local database is set up.
if (!IS_CLOUDFLARE) await initDatabase();
