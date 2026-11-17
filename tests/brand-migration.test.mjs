import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  buildMigrationStatements,
  inspectMigration,
  migrateToBrandHierarchy,
  snapshotStats,
} from '../server/brand-migration';
import { loadDumpIntoSqlite, sqliteQueryClient } from '../scripts/migrate-brand-hierarchy.ts';

const LEGACY_PRE_BRAND_SCHEMA = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', pass TEXT, disabled INTEGER NOT NULL DEFAULT 0, last_login INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, notes TEXT, folder TEXT NOT NULL DEFAULT '', gloc TEXT, links TEXT, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE task_priorities (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, pos REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE service_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, pos REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE services (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT, category_id TEXT REFERENCES service_categories(id) ON DELETE SET NULL, about TEXT NOT NULL DEFAULT '', image TEXT, price REAL, currency TEXT NOT NULL DEFAULT 'VND', unit TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_by TEXT, updated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE service_packages (id TEXT PRIMARY KEY, name TEXT NOT NULL, about TEXT NOT NULL DEFAULT '', price REAL, currency TEXT NOT NULL DEFAULT 'VND', term TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_by TEXT, updated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE service_package_items (package_id TEXT NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE, qty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(package_id,service_id));
CREATE TABLE customer_needs (customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE, added_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(customer_id,service_id));
CREATE TABLE task_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, customer_id TEXT, created_by TEXT, team_id TEXT, hold TEXT, created_at INTEGER NOT NULL);
CREATE TABLE task_project_members (project_id TEXT NOT NULL REFERENCES task_projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'normal', follows INTEGER NOT NULL DEFAULT 1, via_board TEXT, PRIMARY KEY(project_id,user_id));
CREATE TABLE project_services (project_id TEXT NOT NULL REFERENCES task_projects(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE, added_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(project_id,service_id));
CREATE TABLE task_campaigns (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE task_labels (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT);
CREATE TABLE task_label_links (task_id TEXT NOT NULL, label_id TEXT NOT NULL, PRIMARY KEY (task_id, label_id));
CREATE TABLE tasks (id TEXT PRIMARY KEY, external_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT '', start_at INTEGER, due_at INTEGER, done_at INTEGER, project_id TEXT, parent_id TEXT, campaign_id TEXT, description TEXT, result TEXT, created_by TEXT, source_updated_at INTEGER, import_id TEXT, stub INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX tasks_project ON tasks(project_id);
CREATE TABLE task_reviews (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, round INTEGER NOT NULL, submitted_by TEXT, submitted_at INTEGER NOT NULL, note TEXT, result TEXT, reviewer_id TEXT, reviewed_at INTEGER, outcome TEXT, feedback TEXT);
CREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, bg TEXT NOT NULL, role_id TEXT, created_by TEXT, pos REAL NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, workspace_id TEXT, private INTEGER NOT NULL DEFAULT 0, customer_id TEXT, project_id TEXT);
CREATE UNIQUE INDEX boards_project ON boards(project_id) WHERE project_id IS NOT NULL;
CREATE TABLE board_cards (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, list_id TEXT NOT NULL, title TEXT NOT NULL, pos REAL NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, customer_id TEXT, card_kind TEXT NOT NULL DEFAULT 'task', project_card_id TEXT, work_project_id TEXT);
CREATE TABLE reports (id TEXT PRIMARY KEY, customer_id TEXT, project_id TEXT, title TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE task_services (task_id TEXT NOT NULL, service_id TEXT NOT NULL, added_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(task_id,service_id));
CREATE TABLE board_services (board_id TEXT NOT NULL, service_id TEXT NOT NULL, added_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(board_id,service_id));
CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, aspect TEXT NOT NULL DEFAULT '16:9', data TEXT NOT NULL, customer_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
`;

function seedLegacyDb(db) {
  db.exec(LEGACY_PRE_BRAND_SCHEMA);
}

test('brand migration preserves tasks, multi-level subtask chains, permissions, custom campaign labels, and is idempotent', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  seedLegacyDb(db);

  const t0 = 1_700_000_000_000;
  db.prepare(`INSERT INTO users(id,email,name,role,disabled,created_at,updated_at) VALUES
    ('u_admin','admin@dmi.test','Admin','admin',0,?,?),
    ('u_drive','driveowner@dmi.test','Drive Owner','member',0,?,?),
    ('u_obs','obs@dmi.test','Observer','member',0,?,?)`).run(t0, t0, t0, t0, t0, t0);

  db.prepare(`INSERT INTO customers(id,name,folder,gloc,created_by,created_at,updated_at) VALUES
    ('c_1','Alpha Auto','','{"kind":"gdrive","account":"driveowner@dmi.test","id":"fld_1"}','u_admin',?,?),
    ('c_2','Beta Detailing','',NULL,'u_admin',?,?)`).run(t0, t0, t0, t0);

  db.prepare(`INSERT INTO services(id,name,created_at,updated_at) VALUES
    ('sv_ads','Meta Ads',?,?),
    ('sv_web','Website',?,?)`).run(t0, t0, t0, t0);

  db.prepare(`INSERT INTO service_packages(id,name,created_at,updated_at) VALUES('pkg_1','Growth',?,?)`).run(t0, t0);
  db.prepare(`INSERT INTO service_package_items(package_id,service_id,qty) VALUES('pkg_1','sv_ads',1)`).run();

  db.prepare(`INSERT INTO task_projects(id,name,customer_id,created_by,team_id,hold,created_at) VALUES
    ('tj_a','Meta Ads','c_1','u_admin','team_ads',NULL,?),
    ('tj_b','Website','c_2','u_admin',NULL,'paused',?),
    ('tj_internal','Internal Ops',NULL,'u_admin',NULL,NULL,?)`).run(t0, t0 + 1, t0 + 2);

  db.prepare(`INSERT INTO project_services(project_id,service_id,added_by,created_at) VALUES
    ('tj_a','sv_ads','u_admin',?),
    ('tj_b','sv_web','u_admin',?),
    ('tj_internal','sv_web','u_admin',?)`).run(t0, t0, t0);

  db.prepare(`INSERT INTO task_project_members(project_id,user_id,role,follows,via_board) VALUES
    ('tj_a','u_drive','normal',1,NULL),
    ('tj_a','u_obs','observer',0,'b_1'),
    ('tj_b','u_drive','observer',1,NULL)`).run();

  db.prepare(`INSERT INTO task_campaigns(id,project_id,name,created_at) VALUES
    ('tc_def','tj_a','Công việc hiện có',?),
    ('tc_q4','tj_a','Chiến dịch Q4',?),
    ('tc_q4_b','tj_b','chiến dịch q4',?)`).run(t0, t0, t0);

  // Nested 4-level task chain + orphan task + review round referencing tasks(id).
  db.prepare(`INSERT INTO tasks(id,title,status,project_id,parent_id,campaign_id,created_by,stub,created_at,updated_at) VALUES
    ('tk_root','Root Ad Task','Đang thực hiện','tj_a',NULL,'tc_q4','u_admin',0,?,?),
    ('tk_child','Child Task','Chưa thực hiện','tj_a','tk_root','tc_def','u_admin',0,?,?),
    ('tk_grand','Grandchild Task','Chưa thực hiện','tj_a','tk_child',NULL,'u_admin',0,?,?),
    ('tk_great','Great-grandchild Task','Hoàn thành','tj_a','tk_grand',NULL,'u_admin',0,?,?),
    ('tk_web','Web Task','Chưa thực hiện','tj_b',NULL,'tc_q4_b','u_admin',0,?,?),
    ('tk_orphan','Loose Personal Task','Chưa thực hiện',NULL,NULL,NULL,'u_admin',0,?,?)`).run(t0, t0, t0, t0, t0, t0, t0, t0, t0, t0, t0, t0);

  db.prepare(`INSERT INTO task_reviews(id,task_id,round,submitted_by,submitted_at) VALUES('tr_1','tk_root',1,'u_drive',?)`).run(t0);
  db.prepare(`INSERT INTO customer_needs(customer_id,service_id,added_by,created_at) VALUES('c_2','sv_ads','u_admin',?)`).run(t0);
  db.prepare(`INSERT INTO boards(id,name,bg,created_by,pos,created_at,updated_at,project_id,customer_id) VALUES('b_1','Meta Ads','blue','u_admin',1,?,?,'tj_a','c_1')`).run(t0, t0);
  db.prepare(`INSERT INTO board_cards(id,board_id,list_id,title,pos,created_at,updated_at,card_kind,work_project_id,project_card_id,customer_id) VALUES
    ('k_1','b_1','l_1','Meta Ads',1,?,?,'project','tj_a',NULL,'c_1'),
    ('k_2','b_1','l_1','Child',2,?,?,'task',NULL,'k_1','c_1')`).run(t0, t0, t0, t0);
  db.prepare(`INSERT INTO reports(id,customer_id,project_id,title,data,created_at,updated_at) VALUES('rp_1','c_1','tj_a','Report','{}',?,?)`).run(t0, t0);
  db.prepare(`INSERT INTO settings(key,value) VALUES('google_accounts', ?)`).run(JSON.stringify([
    { email: 'driveowner@dmi.test', name: 'Drive Owner', picture: '', refresh: 'rt_drive' },
    { email: 'shared@external.test', name: 'Shared', picture: '', refresh: 'rt_shared' },
  ]));
  db.prepare(`INSERT INTO projects(id,title,aspect,data,created_at,updated_at) VALUES('p_vid','Old Video','16:9','{}',?,?)`).run(t0, t0);

  const client = sqliteQueryClient(db);
  const first = await migrateToBrandHierarchy(client, { strict: true, nowMs: t0 + 100 });
  assert.equal(first.status, 'migrated');
  assert.equal(first.anomalies.length, 0);

  // Idempotent 2nd and 3rd runs should be safe no-ops and preserve exact counts/hashes.
  const second = await migrateToBrandHierarchy(client, { strict: true, nowMs: t0 + 200 });
  assert.equal(second.status, 'already_migrated');
  const third = await migrateToBrandHierarchy(client, { strict: true, nowMs: t0 + 300 });
  assert.equal(third.status, 'already_migrated');
  assert.deepEqual(third.after, first.after);

  // Obsolete tables are completely gone, including legacy video tables.
  const tbls = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  for (const old of ['task_projects', 'task_project_members', 'project_services', 'task_campaigns', 'customer_needs', 'services', 'projects', 'assets', 'jobs', 'renders', 'ai_calls']) {
    assert.equal(tbls.has(old), false, `expected ${old} to be dropped`);
  }
  for (const next of ['brands', 'brand_services', 'brand_service_members', 'service_catalog', 'user_google_accounts']) {
    assert.equal(tbls.has(next), true, `expected ${next} to exist`);
  }

  // Brand hierarchy & kept tj_ IDs.
  const brands = db.prepare('SELECT id, customer_id, name, drive_folder FROM brands ORDER BY customer_id').all();
  assert.deepEqual(brands.map((b) => [b.customer_id, b.name]), [['c_1', 'Alpha Auto'], ['c_2', 'Beta Detailing']]);
  assert.equal(brands[0].drive_folder, '{"kind":"gdrive","account":"driveowner@dmi.test","id":"fld_1"}');

  const svcRows = db.prepare('SELECT id, brand_id, catalog_service_id, name, hold FROM brand_services ORDER BY id').all();
  assert.equal(svcRows.find((r) => r.id === 'tj_a').catalog_service_id, 'sv_ads');
  assert.equal(svcRows.find((r) => r.id === 'tj_b').hold, 'paused');
  assert.equal(svcRows.find((r) => r.id === 'tj_internal').brand_id, null);

  // Task count, nested subtask parent chain, review row intact.
  const tasks = db.prepare('SELECT id, parent_id, brand_service_id FROM tasks ORDER BY id').all();
  assert.equal(tasks.length, 6);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  assert.equal(byId.get('tk_great').parent_id, 'tk_grand');
  assert.equal(byId.get('tk_grand').parent_id, 'tk_child');
  assert.equal(byId.get('tk_child').parent_id, 'tk_root');
  assert.equal(byId.get('tk_root').parent_id, null);
  assert.equal(byId.get('tk_root').brand_service_id, 'tj_a');
  assert.equal(byId.get('tk_orphan').brand_service_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM task_reviews').get().n, 1);

  // Member permissions unchanged.
  const members = db.prepare('SELECT brand_service_id, user_id, role, follows, via_board FROM brand_service_members ORDER BY brand_service_id, user_id').all();
  assert.deepEqual(members.map((m) => [m.brand_service_id, m.user_id, m.role, m.follows, m.via_board]), [
    ['tj_a', 'u_drive', 'normal', 1, null],
    ['tj_a', 'u_obs', 'observer', 0, 'b_1'],
    ['tj_b', 'u_drive', 'observer', 1, null],
  ]);

  // Custom campaigns became labels; placeholder "Công việc hiện có" skipped.
  const labels = db.prepare('SELECT name FROM task_labels ORDER BY name').all().map((l) => l.name);
  assert.equal(labels.includes('Công việc hiện có'), false);
  const q4Links = db.prepare("SELECT l.task_id FROM task_label_links l JOIN task_labels lb ON lb.id = l.label_id WHERE LOWER(lb.name) = 'chiến dịch q4' ORDER BY l.task_id").all();
  assert.deepEqual(q4Links.map((x) => x.task_id), ['tk_root', 'tk_web']);

  // Boards, board_cards, reports columns migrated.
  assert.equal(db.prepare('SELECT brand_service_id FROM boards WHERE id=?').get('b_1').brand_service_id, 'tj_a');
  assert.equal(db.prepare('SELECT card_kind, brand_service_id FROM board_cards WHERE id=?').get('k_1').card_kind, 'service');
  assert.equal(db.prepare('SELECT service_card_id FROM board_cards WHERE id=?').get('k_2').service_card_id, 'k_1');
  assert.equal(db.prepare('SELECT brand_service_id FROM reports WHERE id=?').get('rp_1').brand_service_id, 'tj_a');

  // Legacy google_accounts split per user and removed from settings.
  const gaccs = db.prepare('SELECT user_id, email FROM user_google_accounts ORDER BY email').all();
  assert.deepEqual(gaccs.map((g) => [g.user_id, g.email]), [
    ['u_drive', 'driveowner@dmi.test'],
    ['u_admin', 'shared@external.test'],
  ]);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='google_accounts'").get(), undefined);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  db.close();
});

test('brand migration exports tj_ anomalies (0 or >1 services) and blocks strict run without data loss', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  seedLegacyDb(db);
  const t0 = 1_700_000_000_000;
  db.prepare(`INSERT INTO services(id,name,created_at,updated_at) VALUES('sv_1','Ads',?,?),('sv_2','SEO',?,?)`).run(t0, t0, t0, t0);
  db.prepare(`INSERT INTO task_projects(id,name,customer_id,created_at) VALUES('tj_zero','Zero Svc',NULL,?),('tj_multi','Two Svc',NULL,?)`).run(t0, t0);
  db.prepare(`INSERT INTO project_services(project_id,service_id,created_at) VALUES('tj_multi','sv_1',?),('tj_multi','sv_2',?)`).run(t0, t0 + 1);

  const client = sqliteQueryClient(db);
  const report = await inspectMigration(client);
  assert.equal(report.anomalies.length, 2);
  assert.deepEqual(report.anomalies.map((a) => [a.id, a.reason, a.serviceCount]), [
    ['tj_multi', 'multiple_services', 2],
    ['tj_zero', 'no_service', 0],
  ]);

  await assert.rejects(() => migrateToBrandHierarchy(client, { strict: true }), /tj_multi.*2 services.*tj_zero.*0 services/);
  // Database stays unmodified when strict aborts before altering tables.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM task_projects").get().n, 2);

  // Fallback mode repairs 0-service row via sv_general while taking earliest service for >1-service row.
  const relaxed = await migrateToBrandHierarchy(client, { strict: false, allowFallbackService: true, nowMs: t0 });
  assert.equal(relaxed.after.brandServices, 2);
  assert.equal(db.prepare('SELECT catalog_service_id FROM brand_services WHERE id=?').get('tj_zero').catalog_service_id, 'sv_general');
  assert.equal(db.prepare('SELECT catalog_service_id FROM brand_services WHERE id=?').get('tj_multi').catalog_service_id, 'sv_1');

  db.close();
});

test('generated D1 migration SQL statements replay cleanly end-to-end on real D1 backup when available', async (t) => {
  const dumpPath = 'data/backups/d1-latest.sql';
  if (!fs.existsSync(dumpPath)) {
    t.skip('No local data/backups/d1-latest.sql snapshot in workspace');
    return;
  }

  const db = new DatabaseSync(':memory:');
  loadDumpIntoSqlite(db, dumpPath);
  const client = sqliteQueryClient(db);
  const before = await snapshotStats(client);
  const { statements } = await buildMigrationStatements(client, { strict: true });
  for (const sql of statements) db.exec(`${sql};`);
  const after = await snapshotStats(client);

  assert.equal(after.customers, before.customers);
  assert.equal(after.brands, before.customers);
  assert.equal(after.brandServices, before.brandServices);
  assert.equal(after.tasks, before.tasks);
  assert.equal(after.subtasks, before.subtasks);
  assert.equal(after.subtaskChainsHash, before.subtaskChainsHash);
  assert.equal(after.membersHash, before.membersHash);
  assert.equal(after.foreignKeyErrors, 0);

  db.close();
});
