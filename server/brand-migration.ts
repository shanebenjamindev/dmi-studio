/**
 * Schema & data migration from flat task_projects/task_campaigns/customer_needs/services
 * and company-wide google_accounts to the Brand hierarchy (customers -> brands -> brand_services
 * -> tasks -> subtasks), service_catalog, task_labels, and per-user user_google_accounts.
 *
 * Works identically against local SQLite (node:sqlite) and Cloudflare D1 without relying on
 * persistent session PRAGMAs across D1 batch calls.
 */
import crypto from 'node:crypto';
import type { SqlValue } from './db';

export interface QueryClient {
  execute(statement: string | { sql: string; args?: SqlValue[] }): Promise<{ rows: any[]; rowsAffected?: number }>;
}

export interface ProjectServiceAnomaly {
  id: string;
  name: string;
  customerId: string | null;
  customerName: string | null;
  serviceCount: number;
  serviceIds: string[];
  reason: 'no_service' | 'multiple_services';
}

export interface MigrationReport {
  alreadyMigrated: boolean;
  anomalies: ProjectServiceAnomaly[];
  projectsWithoutCustomer: { id: string; name: string }[];
  customCampaigns: { id: string; projectId: string; name: string; taskCount: number }[];
  defaultCampaigns: { id: string; projectId: string; name: string; taskCount: number }[];
  googleAccounts: { email: string; matchedUserId: string | null; fallbackAdminId: string | null }[];
  legacyVideoCounts: Record<string, number>;
}

export interface MigrationStats {
  customers: number;
  brands: number;
  serviceCatalog: number;
  brandServices: number;
  brandServiceMembers: number;
  tasks: number;
  tasksWithService: number;
  subtasks: number;
  boardsWithService: number;
  boardCardsWithService: number;
  reportsWithService: number;
  userGoogleAccounts: number;
  taskLabelLinks: number;
  subtaskChainsHash: string;
  membersHash: string;
  foreignKeyErrors: number;
}

export interface MigrationOptions {
  /** Abort before altering tables if any tj_ has 0 or >1 linked catalog services (default: true). */
  strict?: boolean;
  /** When strict is false, attach 0-service tj_ rows to an automatically created fallback catalog service. */
  allowFallbackService?: boolean;
  /** Admin user_id override when settings.google_accounts email has no matching user. */
  googleAccountOwnerId?: string | null;
  nowMs?: number;
}

export interface MigrationResult {
  status: 'already_migrated' | 'migrated';
  statementsExecuted: number;
  anomalies: ProjectServiceAnomaly[];
  before: MigrationStats;
  after: MigrationStats;
}

const DEFAULT_CAMPAIGN_NAME = 'Công việc hiện có';
const LEGACY_VIDEO_TABLES = ['ai_calls', 'renders', 'jobs', 'assets', 'projects'] as const;

async function tableExists(db: QueryClient, name: string): Promise<boolean> {
  const r = await db.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", args: [name] });
  return r.rows.length > 0;
}

async function columnsOf(db: QueryClient, table: string): Promise<Set<string>> {
  if (!(await tableExists(db, table))) return new Set();
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return new Set(r.rows.map((row) => String(row.name)));
}

async function scalar(db: QueryClient, sql: string, args: SqlValue[] = []): Promise<number> {
  const r = await db.execute({ sql, args });
  return Number(r.rows[0]?.n ?? 0);
}

const sha = (rows: unknown[]) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);

const sqlLit = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};

async function findFallbackAdmin(db: QueryClient): Promise<string | null> {
  if (!(await tableExists(db, 'users'))) return null;
  const r = await db.execute("SELECT id FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY created_at, id LIMIT 1");
  if (r.rows[0]?.id) return String(r.rows[0].id);
  const anyUser = await db.execute('SELECT id FROM users ORDER BY created_at, id LIMIT 1');
  return anyUser.rows[0]?.id ? String(anyUser.rows[0].id) : null;
}

/**
 * Inspect pre-migration data without modifying the database.
 */
export async function inspectMigration(db: QueryClient, ownerOverride?: string | null): Promise<MigrationReport> {
  const hasOldProjects = await tableExists(db, 'task_projects');
  const hasNewBrandServices = await tableExists(db, 'brand_services');
  const alreadyMigrated = !hasOldProjects && hasNewBrandServices;

  const anomalies: ProjectServiceAnomaly[] = [];
  const projectsWithoutCustomer: { id: string; name: string }[] = [];
  if (hasOldProjects) {
    const hasPs = await tableExists(db, 'project_services');
    const rows = (await db.execute(
      `SELECT p.id, p.name, p.customer_id, c.name customer_name
       FROM task_projects p LEFT JOIN customers c ON c.id = p.customer_id
       ORDER BY p.created_at, p.id`
    )).rows;
    const svcMap = new Map<string, string[]>();
    if (hasPs) {
      for (const ps of (await db.execute('SELECT project_id, service_id FROM project_services ORDER BY created_at, service_id')).rows) {
        const list = svcMap.get(String(ps.project_id)) || [];
        list.push(String(ps.service_id));
        svcMap.set(String(ps.project_id), list);
      }
    }
    for (const p of rows) {
      const pid = String(p.id);
      if (!p.customer_id) projectsWithoutCustomer.push({ id: pid, name: String(p.name) });
      const sids = svcMap.get(pid) || [];
      if (sids.length !== 1) {
        anomalies.push({
          id: pid,
          name: String(p.name),
          customerId: p.customer_id ? String(p.customer_id) : null,
          customerName: p.customer_name ? String(p.customer_name) : null,
          serviceCount: sids.length,
          serviceIds: sids,
          reason: sids.length === 0 ? 'no_service' : 'multiple_services',
        });
      }
    }
  }

  const customCampaigns: MigrationReport['customCampaigns'] = [];
  const defaultCampaigns: MigrationReport['defaultCampaigns'] = [];
  if (await tableExists(db, 'task_campaigns')) {
    const taskCols = await columnsOf(db, 'tasks');
    const countExpr = taskCols.has('campaign_id')
      ? '(SELECT COUNT(*) FROM tasks t WHERE t.campaign_id = c.id AND t.stub = 0)'
      : '0';
    for (const c of (await db.execute(`SELECT c.id, c.project_id, c.name, ${countExpr} n FROM task_campaigns c ORDER BY c.created_at, c.id`)).rows) {
      const entry = { id: String(c.id), projectId: String(c.project_id), name: String(c.name), taskCount: Number(c.n || 0) };
      if (entry.name.trim() === DEFAULT_CAMPAIGN_NAME) defaultCampaigns.push(entry);
      else customCampaigns.push(entry);
    }
  }

  const googleAccounts: MigrationReport['googleAccounts'] = [];
  if (await tableExists(db, 'settings')) {
    const row = (await db.execute("SELECT value FROM settings WHERE key = 'google_accounts'")).rows[0];
    if (row?.value) {
      let list: any[] = [];
      try { list = JSON.parse(String(row.value)); } catch { list = []; }
      const fallbackAdminId = ownerOverride || (await findFallbackAdmin(db));
      const hasUsers = await tableExists(db, 'users');
      for (const acc of Array.isArray(list) ? list : []) {
        const email = String(acc?.email || '').trim().toLowerCase();
        if (!email) continue;
        let matchedUserId: string | null = null;
        if (hasUsers) {
          const u = (await db.execute({ sql: 'SELECT id FROM users WHERE LOWER(email) = ? ORDER BY disabled, created_at LIMIT 1', args: [email] })).rows[0];
          if (u?.id) matchedUserId = String(u.id);
        }
        googleAccounts.push({ email, matchedUserId, fallbackAdminId: matchedUserId ? null : fallbackAdminId });
      }
    }
  }

  const legacyVideoCounts: Record<string, number> = {};
  for (const tbl of LEGACY_VIDEO_TABLES) {
    if (await tableExists(db, tbl)) legacyVideoCounts[tbl] = await scalar(db, `SELECT COUNT(*) n FROM ${tbl}`);
  }

  return { alreadyMigrated, anomalies, projectsWithoutCustomer, customCampaigns, defaultCampaigns, googleAccounts, legacyVideoCounts };
}

/**
 * Capture row counts and structural integrity hashes before or after migration.
 */
export async function snapshotStats(db: QueryClient): Promise<MigrationStats> {
  const isNew = await tableExists(db, 'brand_services');
  const hasOldProjects = await tableExists(db, 'task_projects');
  const serviceTbl = (await tableExists(db, 'service_catalog')) ? 'service_catalog' : 'services';

  const taskCols = await columnsOf(db, 'tasks');
  const taskSvcCol = taskCols.has('brand_service_id') ? 'brand_service_id' : 'project_id';
  const boardCols = await columnsOf(db, 'boards');
  const boardSvcCol = boardCols.has('brand_service_id') ? 'brand_service_id' : 'project_id';
  const cardCols = await columnsOf(db, 'board_cards');
  const cardSvcCol = cardCols.has('brand_service_id') ? 'brand_service_id' : 'work_project_id';
  const repCols = await columnsOf(db, 'reports');
  const repSvcCol = repCols.has('brand_service_id') ? 'brand_service_id' : 'project_id';

  const subtaskRows = (await tableExists(db, 'tasks'))
    ? (await db.execute(`SELECT id, parent_id, ${taskSvcCol} svc_id, title FROM tasks ORDER BY id`)).rows.map((r) => [
        r.id,
        r.parent_id ?? null,
        r.svc_id ?? null,
        r.title,
      ])
    : [];

  let memberRows: unknown[] = [];
  if (isNew && (await tableExists(db, 'brand_service_members'))) {
    memberRows = (await db.execute('SELECT brand_service_id, user_id, role, COALESCE(follows, 1) follows, via_board FROM brand_service_members ORDER BY brand_service_id, user_id')).rows.map((r) => [
      r.brand_service_id,
      r.user_id,
      r.role,
      r.follows,
      r.via_board ?? null,
    ]);
  } else if (hasOldProjects && (await tableExists(db, 'task_project_members'))) {
    const mCols = await columnsOf(db, 'task_project_members');
    const fExpr = mCols.has('follows') ? 'COALESCE(follows, 1)' : '1';
    const vExpr = mCols.has('via_board') ? 'via_board' : 'NULL';
    memberRows = (await db.execute(`SELECT project_id, user_id, role, ${fExpr} follows, ${vExpr} via_board FROM task_project_members ORDER BY project_id, user_id`)).rows.map((r) => [
      r.project_id,
      r.user_id,
      r.role,
      r.follows,
      r.via_board ?? null,
    ]);
  }

  let fkErrors = 0;
  try {
    fkErrors = (await db.execute('PRAGMA foreign_key_check')).rows.length;
  } catch {
    fkErrors = 0;
  }

  return {
    customers: (await tableExists(db, 'customers')) ? await scalar(db, 'SELECT COUNT(*) n FROM customers') : 0,
    brands: (await tableExists(db, 'brands')) ? await scalar(db, 'SELECT COUNT(*) n FROM brands') : 0,
    serviceCatalog: (await tableExists(db, serviceTbl)) ? await scalar(db, `SELECT COUNT(*) n FROM ${serviceTbl}`) : 0,
    brandServices: isNew
      ? await scalar(db, 'SELECT COUNT(*) n FROM brand_services')
      : hasOldProjects
        ? await scalar(db, 'SELECT COUNT(*) n FROM task_projects')
        : 0,
    brandServiceMembers: memberRows.length,
    tasks: (await tableExists(db, 'tasks')) ? await scalar(db, 'SELECT COUNT(*) n FROM tasks') : 0,
    tasksWithService: (await tableExists(db, 'tasks')) ? await scalar(db, `SELECT COUNT(*) n FROM tasks WHERE ${taskSvcCol} IS NOT NULL`) : 0,
    subtasks: (await tableExists(db, 'tasks')) ? await scalar(db, 'SELECT COUNT(*) n FROM tasks WHERE parent_id IS NOT NULL') : 0,
    boardsWithService: (await tableExists(db, 'boards')) ? await scalar(db, `SELECT COUNT(*) n FROM boards WHERE ${boardSvcCol} IS NOT NULL`) : 0,
    boardCardsWithService: (await tableExists(db, 'board_cards')) ? await scalar(db, `SELECT COUNT(*) n FROM board_cards WHERE ${cardSvcCol} IS NOT NULL`) : 0,
    reportsWithService: (await tableExists(db, 'reports')) ? await scalar(db, `SELECT COUNT(*) n FROM reports WHERE ${repSvcCol} IS NOT NULL`) : 0,
    userGoogleAccounts: (await tableExists(db, 'user_google_accounts')) ? await scalar(db, 'SELECT COUNT(*) n FROM user_google_accounts') : 0,
    taskLabelLinks: (await tableExists(db, 'task_label_links')) ? await scalar(db, 'SELECT COUNT(*) n FROM task_label_links') : 0,
    subtaskChainsHash: sha(subtaskRows),
    membersHash: sha(memberRows),
    foreignKeyErrors: fkErrors,
  };
}

/**
 * Assert that zero tasks, subtasks, permissions, boards, or cards were dropped or corrupted.
 */
export function verifyMigrationInvariants(before: MigrationStats, after: MigrationStats, extraLabelsExpected = 0): string[] {
  const errors: string[] = [];
  if (after.customers !== before.customers) errors.push(`customers mismatch: ${before.customers} -> ${after.customers}`);
  if (after.brands < before.customers) errors.push(`missing default brands: customers=${before.customers}, brands=${after.brands}`);
  if (after.brandServices !== before.brandServices) errors.push(`brand_services mismatch: ${before.brandServices} -> ${after.brandServices}`);
  if (after.brandServiceMembers !== before.brandServiceMembers) errors.push(`members mismatch: ${before.brandServiceMembers} -> ${after.brandServiceMembers}`);
  if (after.tasks !== before.tasks) errors.push(`tasks count mismatch: ${before.tasks} -> ${after.tasks}`);
  if (after.tasksWithService !== before.tasksWithService) errors.push(`tasksWithService mismatch: ${before.tasksWithService} -> ${after.tasksWithService}`);
  if (after.subtasks !== before.subtasks) errors.push(`subtasks count mismatch: ${before.subtasks} -> ${after.subtasks}`);
  if (after.subtaskChainsHash !== before.subtaskChainsHash) errors.push('subtask parent_id/title/service checksum changed');
  if (after.membersHash !== before.membersHash) errors.push('brand_service_members permissions checksum changed');
  if (after.boardsWithService !== before.boardsWithService) errors.push(`boards mismatch: ${before.boardsWithService} -> ${after.boardsWithService}`);
  if (after.boardCardsWithService !== before.boardCardsWithService) errors.push(`board_cards mismatch: ${before.boardCardsWithService} -> ${after.boardCardsWithService}`);
  if (after.reportsWithService !== before.reportsWithService) errors.push(`reports mismatch: ${before.reportsWithService} -> ${after.reportsWithService}`);
  if (after.taskLabelLinks < before.taskLabelLinks + extraLabelsExpected) {
    errors.push(`task_label_links lower than expected: ${after.taskLabelLinks} < ${before.taskLabelLinks + extraLabelsExpected}`);
  }
  if (after.foreignKeyErrors > 0) errors.push(`foreign_key_check returned ${after.foreignKeyErrors} errors`);
  return errors;
}

/**
 * Build deterministic, dependency-ordered SQL statements compatible with both node:sqlite and Cloudflare D1.
 */
export async function buildMigrationStatements(db: QueryClient, options: MigrationOptions = {}): Promise<{ statements: string[]; report: MigrationReport }> {
  const strict = options.strict !== false;
  const allowFallback = !!options.allowFallbackService;
  const nowMs = options.nowMs ?? Date.now();
  const report = await inspectMigration(db, options.googleAccountOwnerId);

  if (strict && report.anomalies.length > 0) {
    const list = report.anomalies.map((a) => `${a.id} (${a.name}: ${a.serviceCount} services)`).join(', ');
    throw new Error(`Found ${report.anomalies.length} tj_ projects without exactly 1 service: ${list}`);
  }

  const stmts: string[] = [];

  // 1. Ensure target additive tables exist (brands & user_google_accounts).
  stmts.push(
    `CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE, name TEXT NOT NULL, logo TEXT, notes TEXT NOT NULL DEFAULT '', pos REAL NOT NULL DEFAULT 0, drive_folder TEXT, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS brands_customer ON brands(customer_id, deleted_at, pos)`,
    `CREATE TABLE IF NOT EXISTS user_google_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, email TEXT NOT NULL, name TEXT, picture TEXT, refresh TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT 'drive', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, email))`,
    `CREATE INDEX IF NOT EXISTS user_google_accounts_user ON user_google_accounts(user_id)`
  );

  // 2. Ensure every customer has at least one brand (idempotent default brand matching customer name).
  if (await tableExists(db, 'customers')) {
    const cCols = await columnsOf(db, 'customers');
    const glocExpr = cCols.has('gloc') ? 'c.gloc' : 'NULL';
    const createdByExpr = cCols.has('created_by') ? 'c.created_by' : 'NULL';
    stmts.push(
      `INSERT OR IGNORE INTO brands(id, customer_id, name, logo, notes, pos, drive_folder, created_by, created_at, updated_at, deleted_at)
       SELECT 'br_default_' || c.id, c.id, c.name, NULL, '', 0, ${glocExpr}, ${createdByExpr}, c.created_at, ${nowMs}, NULL
       FROM customers c
       WHERE NOT EXISTS (SELECT 1 FROM brands b WHERE b.customer_id = c.id AND b.deleted_at IS NULL)`
    );
  }

  // 3. Migrate services -> service_catalog and rebuild service_package_items FK.
  const hasOldServices = await tableExists(db, 'services');
  const hasCatalog = await tableExists(db, 'service_catalog');
  if (hasOldServices || !hasCatalog) {
    stmts.push(
      `CREATE TABLE IF NOT EXISTS service_catalog (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT, category_id TEXT REFERENCES service_categories(id) ON DELETE SET NULL, about TEXT NOT NULL DEFAULT '', image TEXT, price REAL, currency TEXT NOT NULL DEFAULT 'VND', unit TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_by TEXT, updated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`
    );
  }
  if (hasOldServices) {
    stmts.push(
      `INSERT OR IGNORE INTO service_catalog(id, name, code, category_id, about, image, price, currency, unit, status, created_by, updated_by, created_at, updated_at, deleted_at)
       SELECT id, name, code, category_id, about, image, price, currency, unit, status, created_by, updated_by, created_at, updated_at, deleted_at FROM services`
    );
    if (await tableExists(db, 'service_package_items')) {
      stmts.push(
        `CREATE TABLE IF NOT EXISTS service_package_items_next (package_id TEXT NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES service_catalog(id) ON DELETE CASCADE, qty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(package_id, service_id))`,
        `INSERT OR IGNORE INTO service_package_items_next(package_id, service_id, qty) SELECT package_id, service_id, qty FROM service_package_items`,
        `DROP TABLE service_package_items`,
        `ALTER TABLE service_package_items_next RENAME TO service_package_items`
      );
    }
  }

  const needsFallback = allowFallback && report.anomalies.some((a) => a.reason === 'no_service');
  if (needsFallback) {
    stmts.push(
      `INSERT OR IGNORE INTO service_catalog(id, name, code, category_id, about, image, price, currency, unit, status, created_by, updated_by, created_at, updated_at, deleted_at)
       VALUES('sv_general', 'Dịch vụ chung', 'GENERAL', NULL, 'Dịch vụ mặc định cho dữ liệu cũ chưa gắn danh mục', NULL, NULL, 'VND', '', 'active', NULL, NULL, ${nowMs}, ${nowMs}, NULL)`
    );
  }

  // 4. Create brand_services & brand_service_members and copy task_projects -> brand_services.
  stmts.push(
    `CREATE TABLE IF NOT EXISTS brand_services (id TEXT PRIMARY KEY, brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE, catalog_service_id TEXT NOT NULL REFERENCES service_catalog(id) ON DELETE RESTRICT, name TEXT NOT NULL, hold TEXT, created_by TEXT, team_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS brand_services_brand ON brand_services(brand_id)`,
    `CREATE INDEX IF NOT EXISTS brand_services_catalog ON brand_services(catalog_service_id)`,
    `CREATE INDEX IF NOT EXISTS brand_services_brand_catalog ON brand_services(brand_id, catalog_service_id)`,
    `CREATE TABLE IF NOT EXISTS brand_service_members (brand_service_id TEXT NOT NULL REFERENCES brand_services(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'normal', follows INTEGER NOT NULL DEFAULT 1, via_board TEXT, PRIMARY KEY(brand_service_id, user_id))`
  );

  if (await tableExists(db, 'task_projects')) {
    const pCols = await columnsOf(db, 'task_projects');
    const holdExpr = pCols.has('hold') ? 'p.hold' : 'NULL';
    const createdByExpr = pCols.has('created_by') ? 'p.created_by' : 'NULL';
    const teamIdExpr = pCols.has('team_id') ? 'p.team_id' : 'NULL';
    const catExpr = allowFallback
      ? `COALESCE((SELECT ps.service_id FROM project_services ps WHERE ps.project_id = p.id ORDER BY ps.created_at, ps.service_id LIMIT 1), 'sv_general')`
      : `(SELECT ps.service_id FROM project_services ps WHERE ps.project_id = p.id ORDER BY ps.created_at, ps.service_id LIMIT 1)`;
    stmts.push(
      `INSERT OR IGNORE INTO brand_services(id, brand_id, catalog_service_id, name, hold, created_by, team_id, created_at, updated_at)
       SELECT p.id,
         CASE WHEN p.customer_id IS NOT NULL THEN (SELECT b.id FROM brands b WHERE b.customer_id = p.customer_id AND b.deleted_at IS NULL ORDER BY b.pos, b.created_at, b.id LIMIT 1) ELSE NULL END,
         ${catExpr},
         p.name, ${holdExpr}, ${createdByExpr}, ${teamIdExpr}, p.created_at, ${nowMs}
       FROM task_projects p`
    );
  }

  if (await tableExists(db, 'task_project_members')) {
    const mCols = await columnsOf(db, 'task_project_members');
    const fExpr = mCols.has('follows') ? 'COALESCE(follows, 1)' : '1';
    const vExpr = mCols.has('via_board') ? 'via_board' : 'NULL';
    stmts.push(
      `INSERT OR IGNORE INTO brand_service_members(brand_service_id, user_id, role, follows, via_board)
       SELECT project_id, user_id, role, ${fExpr}, ${vExpr}
       FROM task_project_members
       WHERE project_id IN (SELECT id FROM brand_services)`
    );
  }

  // 5. Convert custom task_campaigns -> task_labels + task_label_links.
  if (report.customCampaigns.length > 0) {
    const existingLabels = new Map<string, string>();
    if (await tableExists(db, 'task_labels')) {
      for (const l of (await db.execute('SELECT id, name FROM task_labels')).rows) {
        existingLabels.set(String(l.name).trim().toLowerCase(), String(l.id));
      }
    }
    const taskCols = await columnsOf(db, 'tasks');
    for (const cmp of report.customCampaigns) {
      const cleanName = cmp.name.trim();
      if (!cleanName) continue;
      const key = cleanName.toLowerCase();
      let labelId = existingLabels.get(key);
      if (!labelId) {
        labelId = `tl_cmp_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
        existingLabels.set(key, labelId);
        stmts.push(`INSERT OR IGNORE INTO task_labels(id, name) VALUES(${sqlLit(labelId)}, ${sqlLit(cleanName)})`);
      }
      if (taskCols.has('campaign_id')) {
        stmts.push(
          `INSERT OR IGNORE INTO task_label_links(task_id, label_id) SELECT id, ${sqlLit(labelId)} FROM tasks WHERE campaign_id = ${sqlLit(cmp.id)}`
        );
      }
    }
  }

  // 6. Rename columns on tasks, boards, board_cards, reports in place (preserving all FKs like task_reviews).
  const taskCols = await columnsOf(db, 'tasks');
  if (taskCols.has('project_id')) {
    stmts.push(
      `DROP INDEX IF EXISTS tasks_project`,
      `ALTER TABLE tasks RENAME COLUMN project_id TO brand_service_id`,
      `CREATE INDEX IF NOT EXISTS tasks_brand_service ON tasks(brand_service_id)`
    );
  } else if (await tableExists(db, 'tasks')) {
    if (!taskCols.has('brand_service_id')) stmts.push(`ALTER TABLE tasks ADD COLUMN brand_service_id TEXT`);
    stmts.push(`CREATE INDEX IF NOT EXISTS tasks_brand_service ON tasks(brand_service_id)`);
  }
  if (taskCols.has('campaign_id')) {
    stmts.push(`ALTER TABLE tasks DROP COLUMN campaign_id`);
  }

  const boardCols = await columnsOf(db, 'boards');
  if (boardCols.has('project_id')) {
    stmts.push(
      `DROP INDEX IF EXISTS boards_project`,
      `ALTER TABLE boards RENAME COLUMN project_id TO brand_service_id`,
      `CREATE UNIQUE INDEX IF NOT EXISTS boards_brand_service ON boards(brand_service_id) WHERE brand_service_id IS NOT NULL`
    );
  } else if (await tableExists(db, 'boards')) {
    if (!boardCols.has('brand_service_id')) stmts.push(`ALTER TABLE boards ADD COLUMN brand_service_id TEXT`);
    stmts.push(`CREATE UNIQUE INDEX IF NOT EXISTS boards_brand_service ON boards(brand_service_id) WHERE brand_service_id IS NOT NULL`);
  }

  const cardCols = await columnsOf(db, 'board_cards');
  if (cardCols.has('work_project_id')) {
    stmts.push(`ALTER TABLE board_cards RENAME COLUMN work_project_id TO brand_service_id`);
  } else if ((await tableExists(db, 'board_cards')) && !cardCols.has('brand_service_id')) {
    stmts.push(`ALTER TABLE board_cards ADD COLUMN brand_service_id TEXT`);
  }
  if (cardCols.has('project_card_id')) {
    stmts.push(`ALTER TABLE board_cards RENAME COLUMN project_card_id TO service_card_id`);
  } else if ((await tableExists(db, 'board_cards')) && !cardCols.has('service_card_id')) {
    stmts.push(`ALTER TABLE board_cards ADD COLUMN service_card_id TEXT`);
  }
  if (await tableExists(db, 'board_cards')) {
    stmts.push(`UPDATE board_cards SET card_kind = 'service' WHERE card_kind = 'project'`);
  }

  const repCols = await columnsOf(db, 'reports');
  if (repCols.has('project_id')) {
    stmts.push(`ALTER TABLE reports RENAME COLUMN project_id TO brand_service_id`);
  } else if ((await tableExists(db, 'reports')) && !repCols.has('brand_service_id')) {
    stmts.push(`ALTER TABLE reports ADD COLUMN brand_service_id TEXT`);
  }

  // 7. Migrate settings['google_accounts'] -> user_google_accounts (refresh tokens stay server-side).
  if (report.googleAccounts.length > 0 && (await tableExists(db, 'settings'))) {
    const row = (await db.execute("SELECT value FROM settings WHERE key = 'google_accounts'")).rows[0];
    let rawList: any[] = [];
    try { rawList = JSON.parse(String(row?.value || '[]')); } catch { rawList = []; }
    for (const acc of Array.isArray(rawList) ? rawList : []) {
      const email = String(acc?.email || '').trim().toLowerCase();
      const refresh = String(acc?.refresh || '').trim();
      if (!email || !refresh) continue;
      const meta = report.googleAccounts.find((g) => g.email === email);
      const ownerId = meta?.matchedUserId || meta?.fallbackAdminId;
      if (!ownerId) continue;
      const gid = `uga_${crypto.createHash('sha256').update(`${ownerId}:${email}`).digest('hex').slice(0, 16)}`;
      stmts.push(
        `INSERT INTO user_google_accounts(id, user_id, email, name, picture, refresh, scopes, created_at, updated_at)
         VALUES(${sqlLit(gid)}, ${sqlLit(ownerId)}, ${sqlLit(email)}, ${sqlLit(acc?.name ? String(acc.name) : '')}, ${sqlLit(acc?.picture ? String(acc.picture) : '')}, ${sqlLit(refresh)}, 'drive', ${nowMs}, ${nowMs})
         ON CONFLICT(user_id, email) DO UPDATE SET name = excluded.name, picture = excluded.picture, refresh = excluded.refresh, updated_at = excluded.updated_at`
      );
    }
    stmts.push(`DELETE FROM settings WHERE key = 'google_accounts'`);
  }

  // 8. Drop obsolete tables only after child FK references have moved.
  stmts.push(
    `DROP INDEX IF EXISTS task_campaigns_project`,
    `DROP TABLE IF EXISTS task_campaigns`,
    `DROP INDEX IF EXISTS project_services_service`,
    `DROP TABLE IF EXISTS project_services`,
    `DROP INDEX IF EXISTS customer_needs_service`,
    `DROP TABLE IF EXISTS customer_needs`,
    `DROP TABLE IF EXISTS task_project_members`,
    `DROP TABLE IF EXISTS task_projects`,
    `DROP TABLE IF EXISTS services`
  );
  for (const tbl of LEGACY_VIDEO_TABLES) {
    if (tbl === 'jobs') stmts.push(`DROP INDEX IF EXISTS jobs_project`);
    stmts.push(`DROP TABLE IF EXISTS ${tbl}`);
  }

  return { statements: stmts, report };
}

/**
 * Run idempotent migration and validate invariants. Throws and rolls back (if SQLite supports it) on error.
 */
export async function migrateToBrandHierarchy(db: QueryClient, options: MigrationOptions = {}): Promise<MigrationResult> {
  const before = await snapshotStats(db);
  const { statements, report } = await buildMigrationStatements(db, options);
  const alreadyMigrated = report.alreadyMigrated && report.googleAccounts.length === 0;

  let customTasksExpected = 0;
  if (!report.alreadyMigrated && (await tableExists(db, 'task_campaigns'))) {
    const taskCols = await columnsOf(db, 'tasks');
    if (taskCols.has('campaign_id')) {
      const hasLinks = (await tableExists(db, 'task_label_links')) && (await tableExists(db, 'task_labels'));
      customTasksExpected = await scalar(
        db,
        hasLinks
          ? `SELECT COUNT(*) n FROM tasks t JOIN task_campaigns c ON c.id = t.campaign_id
             WHERE TRIM(c.name) <> '' AND TRIM(c.name) <> ?
               AND NOT EXISTS (
                 SELECT 1 FROM task_label_links l JOIN task_labels lb ON lb.id = l.label_id
                 WHERE l.task_id = t.id AND LOWER(TRIM(lb.name)) = LOWER(TRIM(c.name))
               )`
          : `SELECT COUNT(*) n FROM tasks t JOIN task_campaigns c ON c.id = t.campaign_id WHERE TRIM(c.name) <> '' AND TRIM(c.name) <> ?`,
        [DEFAULT_CAMPAIGN_NAME]
      );
    }
  }

  for (const sql of statements) {
    await db.execute(sql);
  }

  const after = await snapshotStats(db);
  const errors = verifyMigrationInvariants(before, after, customTasksExpected);
  if (errors.length > 0) {
    throw new Error(`Migration invariant check failed:\n- ${errors.join('\n- ')}`);
  }

  return {
    status: alreadyMigrated ? 'already_migrated' : 'migrated',
    statementsExecuted: statements.length,
    anomalies: report.anomalies,
    before,
    after,
  };
}
