import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from '../server/schema';
import {
  buildMigrationStatements,
  inspectMigration,
  migrateToBrandHierarchy,
  snapshotStats,
} from '../server/brand-migration';
import { loadDumpIntoSqlite, sqliteQueryClient } from '../scripts/migrate-brand-hierarchy.ts';

function seedLegacyDb(db) {
  db.exec(SCHEMA);
  // Ensure legacy columns added dynamically in server/db.ts upgrade() exist on the pre-refactor fixture.
  for (const sql of [
    'ALTER TABLE task_projects ADD COLUMN created_by TEXT',
    'ALTER TABLE task_projects ADD COLUMN team_id TEXT',
    'ALTER TABLE task_projects ADD COLUMN hold TEXT',
    'ALTER TABLE task_project_members ADD COLUMN follows INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE task_project_members ADD COLUMN via_board TEXT',
    'ALTER TABLE tasks ADD COLUMN campaign_id TEXT',
    'ALTER TABLE boards ADD COLUMN project_id TEXT',
    'ALTER TABLE boards ADD COLUMN customer_id TEXT',
    "ALTER TABLE board_cards ADD COLUMN card_kind TEXT NOT NULL DEFAULT 'task'",
    'ALTER TABLE board_cards ADD COLUMN project_card_id TEXT',
    'ALTER TABLE board_cards ADD COLUMN work_project_id TEXT',
    'ALTER TABLE board_cards ADD COLUMN customer_id TEXT',
    'ALTER TABLE customers ADD COLUMN gloc TEXT',
    'ALTER TABLE customers ADD COLUMN created_by TEXT',
  ]) {
    try { db.exec(sql); } catch { /* column may already exist in SCHEMA */ }
  }
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
