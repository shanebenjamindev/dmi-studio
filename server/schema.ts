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
  description TEXT, start_at INTEGER, due_at INTEGER, done INTEGER NOT NULL DEFAULT 0, cover TEXT, archived INTEGER NOT NULL DEFAULT 0, customer_id TEXT
);
CREATE TABLE IF NOT EXISTS board_stars (user_id TEXT NOT NULL, board_id TEXT NOT NULL, PRIMARY KEY (user_id, board_id));
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
`;

