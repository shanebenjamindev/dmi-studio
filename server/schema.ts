// Admin module tables (roles … notification_logs, at the end): see server/admin/ and shared/permissions.ts. The logs keep the
// person's id and name as they were, with no foreign key: they outlive the account, and nobody edits them.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, aspect TEXT NOT NULL DEFAULT '16:9',
  data TEXT NOT NULL, customer_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
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
  folder TEXT NOT NULL, gloc TEXT, links TEXT, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
  pass TEXT, disabled INTEGER NOT NULL DEFAULT 0, last_login INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY, redirect TEXT NOT NULL, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL, owner_id TEXT
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY, n INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS team_roles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, pages TEXT NOT NULL, pos REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dept_roles (
  id TEXT PRIMARY KEY, team_role_id TEXT NOT NULL, name TEXT NOT NULL, level TEXT NOT NULL, pos REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, bg TEXT NOT NULL, role_id TEXT, created_by TEXT, pos REAL NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  about TEXT, workspace_id TEXT, private INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS board_lists (
  id TEXT PRIMARY KEY, board_id TEXT NOT NULL, name TEXT NOT NULL, pos REAL NOT NULL, created_at INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS board_cards (
  id TEXT PRIMARY KEY, board_id TEXT NOT NULL, list_id TEXT NOT NULL, title TEXT NOT NULL, pos REAL NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  description TEXT, start_at INTEGER, due_at INTEGER, done INTEGER NOT NULL DEFAULT 0, cover TEXT, archived INTEGER NOT NULL DEFAULT 0, customer_id TEXT, card_kind TEXT NOT NULL DEFAULT 'task', project_card_id TEXT, work_project_id TEXT
);
CREATE TABLE IF NOT EXISTS board_stars (user_id TEXT NOT NULL, board_id TEXT NOT NULL, PRIMARY KEY (user_id, board_id));
CREATE TABLE IF NOT EXISTS user_prefs (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS board_backgrounds (user_id TEXT NOT NULL, board_id TEXT NOT NULL, bg TEXT NOT NULL, PRIMARY KEY (user_id, board_id));
CREATE TABLE IF NOT EXISTS board_members (
  board_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, added_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (board_id, user_id)
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, about TEXT, owner_id TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, added_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS board_labels (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, pos REAL NOT NULL);
CREATE TABLE IF NOT EXISTS card_labels (card_id TEXT NOT NULL, label_id TEXT NOT NULL, PRIMARY KEY (card_id, label_id));
CREATE TABLE IF NOT EXISTS card_members (card_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (card_id, user_id));
CREATE TABLE IF NOT EXISTS card_checklists (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, title TEXT NOT NULL, pos REAL NOT NULL);
CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY, checklist_id TEXT NOT NULL, card_id TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, pos REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS card_comments (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL, board_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS card_attachments (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL, user_id TEXT, name TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL,
  customer_id TEXT, file_key TEXT
);
CREATE TABLE IF NOT EXISTS inbox_cards (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, pos REAL NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_cards_user ON inbox_cards(user_id, pos);
CREATE TABLE IF NOT EXISTS board_activity (
  id TEXT PRIMARY KEY, board_id TEXT NOT NULL, card_id TEXT, user_id TEXT, action TEXT NOT NULL, data TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS board_activity_board ON board_activity(board_id, created_at);
CREATE TABLE IF NOT EXISTS task_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, customer_id TEXT, created_by TEXT, team_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS task_project_members (project_id TEXT NOT NULL REFERENCES task_projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'normal', PRIMARY KEY(project_id,user_id));
CREATE TABLE IF NOT EXISTS task_campaigns (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS task_campaigns_project ON task_campaigns(project_id);
CREATE TABLE IF NOT EXISTS task_people (id TEXT PRIMARY KEY, name TEXT NOT NULL, user_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, external_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT '', start_at INTEGER, due_at INTEGER, done_at INTEGER,
  project_id TEXT, parent_id TEXT, description TEXT, result TEXT, created_by TEXT, source_updated_at INTEGER, import_id TEXT,
  stub INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_external ON tasks(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE TABLE IF NOT EXISTS task_assignees (task_id TEXT NOT NULL, person_id TEXT NOT NULL, PRIMARY KEY (task_id, person_id));
CREATE TABLE IF NOT EXISTS task_followers (task_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (task_id, user_id));
CREATE TABLE IF NOT EXISTS task_labels (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS task_label_links (task_id TEXT NOT NULL, label_id TEXT NOT NULL, PRIMARY KEY (task_id, label_id));
CREATE TABLE IF NOT EXISTS task_board_links (task_id TEXT PRIMARY KEY, card_id TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS task_import_sheets (import_id TEXT PRIMARY KEY, name TEXT NOT NULL, headers TEXT NOT NULL, row_count INTEGER NOT NULL, parts INTEGER NOT NULL, title_column INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS task_import_sheet_parts (import_id TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(import_id,part));
CREATE TABLE IF NOT EXISTS task_imports (
  id TEXT PRIMARY KEY, user_id TEXT, rows INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ads_services (id TEXT PRIMARY KEY, reporting_key TEXT NOT NULL UNIQUE, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS report_images (report_id TEXT NOT NULL, file TEXT NOT NULL, mime TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(report_id,file));
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, customer_id TEXT, project_id TEXT, title TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, email TEXT, verified_at INTEGER, pending_email TEXT, verification_hash TEXT, verification_expires INTEGER, verification_attempts INTEGER NOT NULL DEFAULT 0, verification_sent_at INTEGER
);
CREATE TABLE IF NOT EXISTS mail_outbox (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, sent_at INTEGER, next_at INTEGER NOT NULL DEFAULT 0,
 locked_until INTEGER NOT NULL DEFAULT 0, error TEXT
);
CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox(state,next_at);

CREATE TABLE IF NOT EXISTS customer_members (
 customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL DEFAULT 'normal', added_by TEXT, created_at INTEGER NOT NULL,
 PRIMARY KEY(customer_id,user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 task_id TEXT,payload TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at);
CREATE TABLE IF NOT EXISTS roles (
 id TEXT PRIMARY KEY, key TEXT UNIQUE, name TEXT NOT NULL, about TEXT NOT NULL DEFAULT '', rank INTEGER NOT NULL, system INTEGER NOT NULL DEFAULT 0,
 created_by TEXT, updated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permissions (
 role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE, perm TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'organization', PRIMARY KEY(role_id,perm)
);
CREATE TABLE IF NOT EXISTS user_roles (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
 scope TEXT, granted_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,role_id)
);
CREATE INDEX IF NOT EXISTS user_roles_role ON user_roles(role_id);
CREATE TABLE IF NOT EXISTS teams (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, about TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#64748b',
 department_id TEXT REFERENCES team_roles(id) ON DELETE SET NULL, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS team_members (
 team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL DEFAULT 'member', added_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(team_id,user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user ON team_members(user_id);
CREATE TABLE IF NOT EXISTS user_avatars (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, mime TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_logs (
 id TEXT PRIMARY KEY, user_id TEXT, email TEXT, ok INTEGER NOT NULL, method TEXT NOT NULL, reason TEXT, ip TEXT, agent TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_logs_at ON login_logs(created_at);
CREATE INDEX IF NOT EXISTS login_logs_user ON login_logs(user_id,created_at);
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, action TEXT NOT NULL, user_id TEXT, user_name TEXT, entity_type TEXT, entity_id TEXT, entity_label TEXT,
 method TEXT, path TEXT, status INTEGER, old_data TEXT, new_data TEXT, ip TEXT, agent TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_kind ON audit_logs(kind,created_at);
CREATE INDEX IF NOT EXISTS audit_logs_user ON audit_logs(user_id,created_at);
CREATE INDEX IF NOT EXISTS audit_logs_entity ON audit_logs(entity_type,entity_id,created_at);
CREATE TABLE IF NOT EXISTS task_statuses (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, pos REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS task_priorities (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, pos REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS task_templates (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, about TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, checklist TEXT NOT NULL DEFAULT '[]', status TEXT,
 priority_id TEXT REFERENCES task_priorities(id) ON DELETE SET NULL, labels TEXT NOT NULL DEFAULT '[]', due_days INTEGER,
 created_by TEXT, updated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS customer_statuses (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, pos REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customer_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, pos REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customer_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, pos REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customer_interactions (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE, user_id TEXT, kind TEXT NOT NULL, summary TEXT NOT NULL,
 happened_at INTEGER NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS customer_interactions_customer ON customer_interactions(customer_id,happened_at);
CREATE TABLE IF NOT EXISTS service_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, pos REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS services (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT, category_id TEXT REFERENCES service_categories(id) ON DELETE SET NULL, about TEXT NOT NULL DEFAULT '',
 image TEXT, price REAL, currency TEXT NOT NULL DEFAULT 'VND', unit TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
 created_by TEXT, updated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS service_packages (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, about TEXT NOT NULL DEFAULT '', price REAL, currency TEXT NOT NULL DEFAULT 'VND', term TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active', created_by TEXT, updated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS service_package_items (
 package_id TEXT NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
 qty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(package_id,service_id)
);
CREATE TABLE IF NOT EXISTS customer_needs (
 customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
 added_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(customer_id,service_id)
);
CREATE INDEX IF NOT EXISTS customer_needs_service ON customer_needs(service_id);
CREATE TABLE IF NOT EXISTS customer_tags (
 customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES customer_categories(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL, PRIMARY KEY(customer_id,tag_id)
);
CREATE INDEX IF NOT EXISTS customer_tags_tag ON customer_tags(tag_id);
CREATE TABLE IF NOT EXISTS quick_notes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'yellow',
 open INTEGER NOT NULL DEFAULT 0, x INTEGER, y INTEGER, w INTEGER, h INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quick_notes_user ON quick_notes(user_id,updated_at);
CREATE TABLE IF NOT EXISTS notification_templates (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
 created_by TEXT, updated_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS notification_logs (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL,
 recipients INTEGER NOT NULL, emailed INTEGER NOT NULL DEFAULT 0, template_id TEXT, sent_by TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notification_logs_at ON notification_logs(created_at);
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_email TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS support_tickets_status ON support_tickets(status, created_at);
`;
