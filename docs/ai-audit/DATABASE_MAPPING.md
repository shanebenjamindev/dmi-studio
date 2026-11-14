# DATABASE_MAPPING — DMI Workspace

> Sinh tự động từ `SCHEMA` ([server/schema.ts](../../server/schema.ts)) và các bước nâng cấp trong [server/db.ts](../../server/db.ts) (`ALTER TABLE … ADD`), ngày 14/11/2026. Không có bảng hay cột nào được đoán.

## Nhà cung cấp

- **Cloud**: Cloudflare D1 (binding `DB`, database `dmi-studio-db`, [wrangler.jsonc](../../wrangler.jsonc)). Kết nối qua `initDatabase(env.DB)` ([server/worker.ts](../../server/worker.ts)).
- **Local**: SQLite qua `node:sqlite` (`data/studio.db`, [server/db.ts](../../server/db.ts)); Worker thay module này bằng [server/no-local-sqlite.ts](../../server/no-local-sqlite.ts).
- Schema áp mỗi lần khởi động (`CREATE TABLE IF NOT EXISTS`), nâng cấp theo bước có kiểm tra cột; dữ liệu được sửa định kỳ (`repairData`, cron 10 phút).
- **Không có ORM**: SQL viết tay qua `all/get/run`. Khoá ngoại khai báo ở một số bảng (`REFERENCES … ON DELETE CASCADE`); phần lớn quan hệ là cột `*_id` do code giữ.
- D1 giới hạn khoảng 100 tham số mỗi câu lệnh: code chia lô (ví dụ [server/tasks.ts](../../server/tasks.ts) `GET /api/tasks/:id`).

Tổng: **89 bảng**, **32 index**.

## Quan hệ chính (đọc từ cột và code)

```
customers 1─n task_projects (dịch vụ của khách) 1─n tasks ─n task_assignees n─1 task_people ─(user_id)→ users
customers 1─n customer_members n─1 users            tasks 1─n task_comments / task_activity / task_reviews / task_followers
tasks 1─1 task_board_links 1─1 board_cards n─1 board_lists n─1 boards n─1 workspaces
boards 1─n board_members n─1 users                   board_cards 1─n card_comments / card_members / card_labels / card_checklists
users n─1 team_roles (phòng ban) · users n─1 dept_roles (vai trò trong phòng) · users n─n roles (user_roles) · role_permissions
reports n─1 customers · projects (video) n─1 customers · renders n─1 projects · assets n─1 projects
mcp_tokens n─1 users · mcp_tokens n─1 mcp_clients · mcp_codes n─1 users
```

## Tài khoản, phiên, phân quyền

### `dept_roles`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `team_role_id` | TEXT NOT NULL |
| `name` | TEXT NOT NULL |
| `level` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `created_at` | INTEGER NOT NULL |

Route dùng trực tiếp (7): `GET /api/admin/departments`, `GET /api/roles`, `DELETE /api/roles/:id`, `POST /api/roles/:id/positions`, `PUT /api/positions/:id`, `DELETE /api/positions/:id`, `GET /api/search`

### `login_attempts`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `n` | INTEGER NOT NULL |
| `expires_at` | INTEGER NOT NULL |

Route dùng trực tiếp (0): _chỉ qua hàm phụ, cron hoặc không còn route nào_

### `login_logs`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT |
| `email` | TEXT |
| `ok` | INTEGER NOT NULL |
| `method` | TEXT NOT NULL |
| `reason` | TEXT |
| `ip` | TEXT |
| `agent` | TEXT |
| `created_at` | INTEGER NOT NULL |

Index: `login_logs_at`(created_at); `login_logs_user`(user_id,created_at)

Route dùng trực tiếp (5): `GET /api/admin/staff/:id`, `GET /api/admin/system`, `GET /api/admin/storage`, `GET /api/admin/storage/check`, `POST /api/admin/storage/clean`

### `oauth_states`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `redirect` | TEXT NOT NULL |
| `purpose` | TEXT NOT NULL |
| `expires_at` | INTEGER NOT NULL |
| `owner_id` | TEXT |

Route dùng trực tiếp (0): _chỉ qua hàm phụ, cron hoặc không còn route nào_

### `password_resets`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `expires_at` | INTEGER NOT NULL |
| `used_at` | INTEGER |
| `created_at` | INTEGER NOT NULL |

Route dùng trực tiếp (2): `POST /api/auth/forgot`, `POST /api/auth/reset`

### `role_permissions`

| Cột | Định nghĩa |
|---|---|
| `role_id` | TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE |
| `perm` | TEXT NOT NULL |
| `scope` | TEXT NOT NULL DEFAULT 'organization' |

Ràng buộc: `PRIMARY KEY(role_id,perm)`

Route dùng trực tiếp (1): `GET /api/admin/permissions`

### `roles`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `key` | TEXT UNIQUE |
| `name` | TEXT NOT NULL |
| `about` | TEXT NOT NULL DEFAULT '' |
| `rank` | INTEGER NOT NULL |
| `system` | INTEGER NOT NULL DEFAULT 0 |
| `created_by` | TEXT |
| `updated_by` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (7): `GET /api/admin/permissions`, `GET /api/admin/roles`, `POST /api/admin/roles`, `PUT /api/admin/roles/:id`, `DELETE /api/admin/roles/:id`, `PUT /api/admin/staff/:id/roles`, `GET /api/admin/system`

### `sessions`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `created_at` | INTEGER NOT NULL |
| `expires_at` | INTEGER NOT NULL |
| `ip` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `agent` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Route dùng trực tiếp (12): `GET /api/admin/staff/:id`, `PUT /api/admin/staff/:id`, `POST /api/admin/staff/:id/lock`, `POST /api/admin/staff/:id/signout`, `GET /api/admin/system`, `GET /api/admin/storage`, `GET /api/admin/storage/check`, `POST /api/admin/storage/clean`, `POST /api/auth/logout`, `PUT /api/auth/password`, `POST /api/auth/reset`, `PUT /api/users/:id`

### `team_members`

| Cột | Định nghĩa |
|---|---|
| `team_id` | TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `role` | TEXT NOT NULL DEFAULT 'member' |
| `added_by` | TEXT |
| `created_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY(team_id,user_id)`

Index: `team_members_user`(user_id)

Route dùng trực tiếp (4): `GET /api/admin/departments`, `PUT /api/admin/teams/:id/members`, `GET /api/tasks`, `GET /api/tasks/meta`

### `team_roles`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `color` | TEXT NOT NULL |
| `pages` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `created_at` | INTEGER NOT NULL |

Route dùng trực tiếp (15): `GET /api/admin/departments`, `GET /api/admin/system`, `GET /api/profiles/:id`, `GET /api/roles`, `POST /api/roles`, `PUT /api/roles/:id`, `DELETE /api/roles/:id`, `POST /api/roles/:id/positions`, `GET /api/boards`, `GET /api/search`, `POST /api/task-projects`, `PUT /api/task-projects/:project` … (+3)

### `teams`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `about` | TEXT NOT NULL DEFAULT '' |
| `color` | TEXT NOT NULL DEFAULT '#64748b' |
| `department_id` | TEXT REFERENCES team_roles(id) ON DELETE SET NULL |
| `created_by` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `deleted_at` | INTEGER |

Route dùng trực tiếp (8): `GET /api/admin/departments`, `GET /api/admin/teams`, `POST /api/admin/teams`, `PUT /api/admin/teams/:id`, `DELETE /api/admin/teams/:id`, `GET /api/admin/system`, `GET /api/tasks`, `GET /api/tasks/meta`

### `user_avatars`

| Cột | Định nghĩa |
|---|---|
| `user_id` | TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE |
| `mime` | TEXT NOT NULL |
| `data` | TEXT NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (6): `PUT /api/admin/staff/:id/avatar`, `DELETE /api/admin/staff/:id/avatar`, `GET /api/avatars/:id`, `GET /api/admin/storage`, `PUT /api/auth/avatar`, `DELETE /api/auth/avatar`

### `user_prefs`

| Cột | Định nghĩa |
|---|---|
| `user_id` | TEXT PRIMARY KEY |
| `data` | TEXT NOT NULL |

Route dùng trực tiếp (1): `PUT /api/auth/prefs`

### `user_roles`

| Cột | Định nghĩa |
|---|---|
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `role_id` | TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE |
| `scope` | TEXT |
| `granted_by` | TEXT |
| `created_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY(user_id,role_id)`

Index: `user_roles_role`(role_id)

Route dùng trực tiếp (3): `DELETE /api/admin/roles/:id`, `GET /api/admin/admins`, `PUT /api/admin/staff/:id/roles`

### `users`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `email` | TEXT NOT NULL UNIQUE |
| `name` | TEXT NOT NULL |
| `role` | TEXT NOT NULL DEFAULT 'member' |
| `pass` | TEXT |
| `disabled` | INTEGER NOT NULL DEFAULT 0 |
| `last_login` | INTEGER |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `team_role` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `dept_role` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `phone` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `manager_id` | TEXT REFERENCES users(id) ON DELETE SET NULL  /* thêm bằng nâng cấp (db.ts) */ |
| `avatar_at` | INTEGER  /* thêm bằng nâng cấp (db.ts) */ |

Route dùng trực tiếp (57): `GET /api/admin/customers/:id`, `GET /api/admin/notifications`, `GET /api/admin/notifications/:id`, `GET /api/admin/mail-log`, `DELETE /api/admin/roles/:id`, `GET /api/admin/admins`, `PUT /api/admin/staff/:id/roles`, `POST /api/admin/staff`, `PUT /api/admin/staff/:id`, `POST /api/admin/staff/:id/lock`, `PUT /api/admin/staff/:id/avatar`, `DELETE /api/admin/staff/:id/avatar` … (+45)

## Khách hàng

### `ads_services`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `reporting_key` | TEXT NOT NULL UNIQUE |
| `data` | TEXT NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (3): `POST /api/ads/services`, `PUT /api/ads/services/:id`, `DELETE /api/ads/services/:id`

### `customer_categories`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL UNIQUE |
| `color` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `active` | INTEGER NOT NULL DEFAULT 1 |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (8): `GET /api/customers/directory`, `GET /api/customers/classifications`, `GET /api/customers/managers`, `GET /api/admin/customer-categories`, `POST /api/admin/customer-categories`, `PUT /api/admin/customer-categories/:id`, `DELETE /api/admin/customer-categories/:id`, `POST /api/admin/customer-categories/order`

### `customer_interactions`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `customer_id` | TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE |
| `user_id` | TEXT |
| `kind` | TEXT NOT NULL |
| `summary` | TEXT NOT NULL |
| `happened_at` | INTEGER NOT NULL |
| `created_at` | INTEGER NOT NULL |
| `deleted_at` | INTEGER |

Index: `customer_interactions_customer`(customer_id,happened_at)

Route dùng trực tiếp (0): _chỉ qua hàm phụ, cron hoặc không còn route nào_

### `customer_members`

| Cột | Định nghĩa |
|---|---|
| `customer_id` | TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `role` | TEXT NOT NULL DEFAULT 'normal' |
| `added_by` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `via_board` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Ràng buộc: `PRIMARY KEY(customer_id,user_id)`

Route dùng trực tiếp (12): `GET /api/admin/customers/:id`, `POST /api/admin/customers/:id/archive`, `POST /api/lists/:id/cards`, `POST /api/customers`, `GET /api/customers/directory`, `GET /api/customers/:id/members`, `PUT /api/customers/:id/members/:userId`, `DELETE /api/customers/:id/members/:userId`, `POST /api/customers/:id/transfer-owner`, `GET /api/customers/managers`, `PUT /api/customers/:id/record`, `DELETE /api/customers/:id/folder`

### `customer_needs`

| Cột | Định nghĩa |
|---|---|
| `customer_id` | TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE |
| `service_id` | TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE |
| `added_by` | TEXT |
| `created_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY(customer_id,service_id)`

Index: `customer_needs_service`(service_id)

Route dùng trực tiếp (4): `POST /api/admin/customers/:id/archive`, `POST /api/task-projects`, `POST /api/customers/:id/projects`, `DELETE /api/customers/:id/folder`

### `customer_sources`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL UNIQUE |
| `color` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `active` | INTEGER NOT NULL DEFAULT 1 |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (9): `GET /api/customers/directory`, `GET /api/customers/sources`, `POST /api/customers/sources`, `GET /api/customers/managers`, `GET /api/admin/customer-sources`, `POST /api/admin/customer-sources`, `PUT /api/admin/customer-sources/:id`, `DELETE /api/admin/customer-sources/:id`, `POST /api/admin/customer-sources/order`

### `customer_statuses`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL UNIQUE |
| `color` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `active` | INTEGER NOT NULL DEFAULT 1 |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (5): `GET /api/admin/customer-statuses`, `POST /api/admin/customer-statuses`, `PUT /api/admin/customer-statuses/:id`, `DELETE /api/admin/customer-statuses/:id`, `POST /api/admin/customer-statuses/order`

### `customer_tags`

| Cột | Định nghĩa |
|---|---|
| `customer_id` | TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE |
| `tag_id` | TEXT NOT NULL REFERENCES customer_categories(id) ON DELETE CASCADE |
| `created_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY(customer_id,tag_id)`

Index: `customer_tags_tag`(tag_id)

Route dùng trực tiếp (4): `POST /api/admin/customers`, `PUT /api/admin/customers/:id`, `POST /api/admin/customers/:id/archive`, `DELETE /api/customers/:id/folder`

### `customers`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `contact` | TEXT |
| `phone` | TEXT |
| `email` | TEXT |
| `notes` | TEXT |
| `folder` | TEXT NOT NULL |
| `gloc` | TEXT |
| `links` | TEXT |
| `created_by` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `category_id` | TEXT REFERENCES customer_categories(id) ON DELETE SET NULL  /* thêm bằng nâng cấp (db.ts) */ |
| `source_id` | TEXT REFERENCES customer_sources(id) ON DELETE SET NULL  /* thêm bằng nâng cấp (db.ts) */ |
| `status` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `manager_id` | TEXT REFERENCES users(id) ON DELETE SET NULL  /* thêm bằng nâng cấp (db.ts) */ |
| `archived_at` | INTEGER  /* thêm bằng nâng cấp (db.ts) */ |
| `updated_by` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `code` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Route dùng trực tiếp (34): `GET /api/admin/customers/:id`, `POST /api/admin/customers`, `PUT /api/admin/customers/:id`, `POST /api/admin/customers/:id/archive`, `GET /api/admin/system`, `GET /api/admin/storage`, `DELETE /api/positions/:id`, `GET /api/boards`, `PUT /api/boards/:id`, `POST /api/lists/:id/cards`, `PUT /api/cards/:id`, `GET /api/boards-customers` … (+22)

## Dịch vụ

### `board_services`

| Cột | Định nghĩa |
|---|---|
| `board_id` | TEXT NOT NULL |
| `service_id` | TEXT NOT NULL |
| `added_by` | TEXT |
| `created_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY(board_id,service_id)`

Index: `board_services_service`(service_id)

Route dùng trực tiếp (0): _chỉ qua hàm phụ, cron hoặc không còn route nào_

### `project_services`

| Cột | Định nghĩa |
|---|---|
| `project_id` | TEXT NOT NULL REFERENCES task_projects(id) ON DELETE CASCADE |
| `service_id` | TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE |
| `added_by` | TEXT |
| `created_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY(project_id,service_id)`

Index: `project_services_service`(service_id)

Route dùng trực tiếp (1): `PUT /api/admin/services/:id`

### `service_categories`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL UNIQUE |
| `color` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `active` | INTEGER NOT NULL DEFAULT 1 |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (6): `GET /api/services`, `GET /api/admin/service-categories`, `POST /api/admin/service-categories`, `PUT /api/admin/service-categories/:id`, `DELETE /api/admin/service-categories/:id`, `POST /api/admin/service-categories/order`

### `service_package_items`

| Cột | Định nghĩa |
|---|---|
| `package_id` | TEXT NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE |
| `service_id` | TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE |
| `qty` | INTEGER NOT NULL DEFAULT 1 |

Ràng buộc: `PRIMARY KEY(package_id,service_id)`

Route dùng trực tiếp (0): _chỉ qua hàm phụ, cron hoặc không còn route nào_

### `service_packages`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `about` | TEXT NOT NULL DEFAULT '' |
| `price` | REAL |
| `currency` | TEXT NOT NULL DEFAULT 'VND' |
| `term` | TEXT NOT NULL DEFAULT '' |
| `status` | TEXT NOT NULL DEFAULT 'active' |
| `created_by` | TEXT |
| `updated_by` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `deleted_at` | INTEGER |

Route dùng trực tiếp (3): `POST /api/admin/service-packages`, `PUT /api/admin/service-packages/:id`, `DELETE /api/admin/service-packages/:id`

### `services`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `code` | TEXT |
| `category_id` | TEXT REFERENCES service_categories(id) ON DELETE SET NULL |
| `about` | TEXT NOT NULL DEFAULT '' |
| `image` | TEXT |
| `price` | REAL |
| `currency` | TEXT NOT NULL DEFAULT 'VND' |
| `unit` | TEXT NOT NULL DEFAULT '' |
| `status` | TEXT NOT NULL DEFAULT 'active' |
| `created_by` | TEXT |
| `updated_by` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `deleted_at` | INTEGER |

Route dùng trực tiếp (8): `POST /api/admin/services`, `PUT /api/admin/services/:id`, `DELETE /api/admin/services/:id`, `GET /api/admin/system`, `GET /api/client-work`, `POST /api/task-projects`, `POST /api/customers/:id/projects`, `GET /api/services`

## Công việc

### `task_activity`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `task_id` | TEXT NOT NULL |
| `user_id` | TEXT |
| `action` | TEXT NOT NULL |
| `data` | TEXT |
| `created_at` | INTEGER NOT NULL |

Index: `task_activity_task`(task_id, created_at)

Route dùng trực tiếp (2): `GET /api/tasks/:id`, `POST /api/tasks/:id/comments`

### `task_assignees`

| Cột | Định nghĩa |
|---|---|
| `task_id` | TEXT NOT NULL |
| `person_id` | TEXT NOT NULL |

Ràng buộc: `PRIMARY KEY (task_id, person_id)`

Route dùng trực tiếp (6): `GET /api/admin/staff/:id`, `PUT /api/cards/:id`, `PUT /api/cards/:id/members`, `GET /api/client-work`, `GET /api/tasks/meta`, `POST /api/tasks/:id/card`

### `task_board_links`

| Cột | Định nghĩa |
|---|---|
| `task_id` | TEXT PRIMARY KEY |
| `card_id` | TEXT NOT NULL UNIQUE |

Route dùng trực tiếp (12): `POST /api/lists/:id/cards`, `PUT /api/cards/:id`, `PUT /api/cards/:id/members`, `GET /api/client-work`, `GET /api/search`, `GET /api/tasks`, `GET /api/tasks/:id`, `PUT /api/tasks/:id`, `POST /api/tasks/:id/card`, `DELETE /api/tasks/:id/card`, `POST /api/tasks/:id/flow`, `POST /api/tasks/:id/comments`

### `task_campaigns`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `project_id` | TEXT NOT NULL |
| `name` | TEXT NOT NULL |
| `created_at` | INTEGER NOT NULL |

Index: `task_campaigns_project`(project_id)

Route dùng trực tiếp (7): `GET /api/task-projects/:project/campaigns`, `POST /api/task-projects/:project/campaigns`, `PUT /api/task-projects/:project/campaigns/:id`, `DELETE /api/task-projects/:project/campaigns/:id`, `GET /api/tasks/meta`, `GET /api/customers/directory`, `GET /api/customers/:id/projects`

### `task_comments`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `task_id` | TEXT NOT NULL |
| `user_id` | TEXT NOT NULL |
| `text` | TEXT NOT NULL |
| `reply_to_id` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Index: `task_comments_task`(task_id, created_at)

Route dùng trực tiếp (5): `GET /api/admin/storage`, `GET /api/tasks/:id`, `POST /api/tasks/:id/comments`, `PUT /api/tasks/comments/:id`, `DELETE /api/tasks/comments/:id`

### `task_followers`

| Cột | Định nghĩa |
|---|---|
| `task_id` | TEXT NOT NULL |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |

Ràng buộc: `PRIMARY KEY (task_id, user_id)`

Route dùng trực tiếp (1): `PUT /api/cards/:id`

### `task_import_sheet_parts`

| Cột | Định nghĩa |
|---|---|
| `import_id` | TEXT NOT NULL |
| `part` | INTEGER NOT NULL |
| `data` | TEXT NOT NULL |

Ràng buộc: `PRIMARY KEY(import_id,part)`

Route dùng trực tiếp (4): `GET /api/admin/storage`, `GET /api/admin/storage/check`, `POST /api/admin/storage/clean`, `GET /api/tasks/imports/:id/sheet`

### `task_import_sheets`

| Cột | Định nghĩa |
|---|---|
| `import_id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `headers` | TEXT NOT NULL |
| `row_count` | INTEGER NOT NULL |
| `parts` | INTEGER NOT NULL |
| `title_column` | INTEGER NOT NULL |

Route dùng trực tiếp (3): `GET /api/admin/storage`, `GET /api/tasks/meta`, `GET /api/tasks/imports/:id/sheet`

### `task_imports`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT |
| `rows` | INTEGER NOT NULL |
| `created` | INTEGER NOT NULL |
| `updated` | INTEGER NOT NULL |
| `created_at` | INTEGER NOT NULL |

Route dùng trực tiếp (5): `GET /api/admin/storage`, `GET /api/admin/storage/check`, `POST /api/admin/storage/clean`, `GET /api/tasks/meta`, `GET /api/tasks/imports/:id/sheet`

### `task_label_links`

| Cột | Định nghĩa |
|---|---|
| `task_id` | TEXT NOT NULL |
| `label_id` | TEXT NOT NULL |

Ràng buộc: `PRIMARY KEY (task_id, label_id)`

Route dùng trực tiếp (2): `POST /api/admin/task-flow/boards`, `DELETE /api/admin/task-labels/:id`

### `task_labels`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL UNIQUE |
| `color` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Route dùng trực tiếp (6): `POST /api/admin/task-flow/boards`, `GET /api/admin/task-labels`, `POST /api/admin/task-labels`, `PUT /api/admin/task-labels/:id`, `DELETE /api/admin/task-labels/:id`, `GET /api/tasks/meta`

### `task_people`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `user_id` | TEXT |
| `created_at` | INTEGER NOT NULL |

Route dùng trực tiếp (9): `GET /api/admin/staff/:id`, `POST /api/lists/:id/cards`, `PUT /api/cards/:id`, `PUT /api/cards/:id/members`, `GET /api/client-work`, `GET /api/tasks/meta`, `POST /api/tasks`, `POST /api/task-people`, `PUT /api/task-people/:id`

### `task_priorities`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL UNIQUE |
| `color` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `active` | INTEGER NOT NULL DEFAULT 1 |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (5): `GET /api/admin/task-priorities`, `POST /api/admin/task-priorities`, `PUT /api/admin/task-priorities/:id`, `DELETE /api/admin/task-priorities/:id`, `POST /api/admin/task-priorities/order`

### `task_project_members`

| Cột | Định nghĩa |
|---|---|
| `project_id` | TEXT NOT NULL REFERENCES task_projects(id) ON DELETE CASCADE |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `role` | TEXT NOT NULL DEFAULT 'normal' |
| `follows` | INTEGER NOT NULL DEFAULT 1  /* thêm bằng nâng cấp (db.ts) */ |
| `via_board` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Ràng buộc: `PRIMARY KEY(project_id,user_id)`

Route dùng trực tiếp (3): `GET /api/task-projects/:project/members`, `PUT /api/task-projects/:project/members/:userId`, `DELETE /api/task-projects/:project/members/:userId`

### `task_projects`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `customer_id` | TEXT |
| `created_by` | TEXT |
| `team_id` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `hold` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Route dùng trực tiếp (25): `POST /api/admin/customers/:id/archive`, `GET /api/admin/staff/:id`, `GET /api/admin/system`, `GET /api/admin/storage`, `POST /api/lists/:id/cards`, `PUT /api/cards/:id`, `GET /api/notifications/inbox`, `GET /api/search`, `POST /api/task-projects`, `PUT /api/task-projects/:project`, `GET /api/task-projects/:project/members`, `PUT /api/task-projects/:project/team` … (+13)

### `task_reminders`

| Cột | Định nghĩa |
|---|---|
| `task_id` | TEXT NOT NULL |
| `user_id` | TEXT NOT NULL |
| `kind` | TEXT NOT NULL |
| `day` | TEXT NOT NULL |

Ràng buộc: `PRIMARY KEY (task_id, user_id, kind, day)`

Route dùng trực tiếp (0): _chỉ qua hàm phụ, cron hoặc không còn route nào_

### `task_reviews`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `task_id` | TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE |
| `round` | INTEGER NOT NULL |
| `submitted_by` | TEXT |
| `submitted_at` | INTEGER NOT NULL |
| `note` | TEXT |
| `result` | TEXT |
| `reviewer_id` | TEXT |
| `reviewed_at` | INTEGER |
| `outcome` | TEXT |
| `feedback` | TEXT |

Index: `task_reviews_task`(task_id, round)

Route dùng trực tiếp (0): _chỉ qua hàm phụ, cron hoặc không còn route nào_

### `task_services`

| Cột | Định nghĩa |
|---|---|
| `task_id` | TEXT NOT NULL |
| `service_id` | TEXT NOT NULL |
| `added_by` | TEXT |
| `created_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY(task_id,service_id)`

Index: `task_services_service`(service_id)

Route dùng trực tiếp (1): `GET /api/client-work`

### `task_statuses`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL UNIQUE |
| `color` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `active` | INTEGER NOT NULL DEFAULT 1 |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (8): `PUT /api/admin/tasks/:id/priority`, `GET /api/admin/task-statuses`, `POST /api/admin/task-statuses`, `PUT /api/admin/task-statuses/:id`, `DELETE /api/admin/task-statuses/:id`, `POST /api/admin/task-statuses/order`, `PUT /api/admin/task-flow`, `DELETE /api/admin/task-labels/:id`

### `task_templates`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `about` | TEXT NOT NULL DEFAULT '' |
| `title` | TEXT NOT NULL |
| `status` | TEXT |
| `priority_id` | TEXT REFERENCES task_priorities(id) ON DELETE SET NULL |
| `labels` | TEXT NOT NULL DEFAULT '[]' |
| `due_days` | INTEGER |
| `created_by` | TEXT |
| `updated_by` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `deleted_at` | INTEGER |

Ràng buộc: `checklist TEXT NOT NULL DEFAULT '[]'`

Route dùng trực tiếp (7): `PUT /api/admin/task-statuses/:id`, `DELETE /api/admin/task-statuses/:id`, `POST /api/admin/task-statuses/clear-unlisted`, `DELETE /api/admin/task-labels/:id`, `POST /api/admin/task-templates`, `PUT /api/admin/task-templates/:id`, `DELETE /api/admin/task-templates/:id`

### `tasks`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `external_id` | TEXT |
| `title` | TEXT NOT NULL |
| `status` | TEXT NOT NULL DEFAULT '' |
| `start_at` | INTEGER |
| `due_at` | INTEGER |
| `done_at` | INTEGER |
| `project_id` | TEXT |
| `parent_id` | TEXT |
| `description` | TEXT |
| `result` | TEXT |
| `created_by` | TEXT |
| `source_updated_at` | INTEGER |
| `import_id` | TEXT |
| `stub` | INTEGER NOT NULL DEFAULT 0 |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `campaign_id` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `description_by` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `priority_id` | TEXT REFERENCES task_priorities(id) ON DELETE SET NULL  /* thêm bằng nâng cấp (db.ts) */ |
| `stage` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `reviewer_id` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `submitted_at` | INTEGER  /* thêm bằng nâng cấp (db.ts) */ |
| `reviewed_at` | INTEGER  /* thêm bằng nâng cấp (db.ts) */ |
| `revision` | INTEGER NOT NULL DEFAULT 0  /* thêm bằng nâng cấp (db.ts) */ |

Index: `tasks_external`(external_id) unique; `tasks_parent`(parent_id); `tasks_project`(project_id)

Route dùng trực tiếp (29): `GET /api/admin/staff/:id`, `GET /api/admin/system`, `GET /api/admin/storage`, `PUT /api/admin/tasks/:id/priority`, `PUT /api/admin/task-statuses/:id`, `DELETE /api/admin/task-statuses/:id`, `POST /api/admin/task-statuses/clear-unlisted`, `POST /api/admin/task-statuses/order`, `PUT /api/admin/task-flow`, `POST /api/lists/:id/cards`, `PUT /api/cards/:id`, `PUT /api/cards/:id/members` … (+17)

## Board và workspace

### `board_activity`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `board_id` | TEXT NOT NULL |
| `card_id` | TEXT |
| `user_id` | TEXT |
| `action` | TEXT NOT NULL |
| `data` | TEXT |
| `created_at` | INTEGER NOT NULL |

Index: `board_activity_board`(board_id, created_at)

Route dùng trực tiếp (1): `GET /api/tasks/:id`

### `board_backgrounds`

| Cột | Định nghĩa |
|---|---|
| `user_id` | TEXT NOT NULL |
| `board_id` | TEXT NOT NULL |
| `bg` | TEXT NOT NULL |

Ràng buộc: `PRIMARY KEY (user_id, board_id)`

Route dùng trực tiếp (0): _chỉ qua hàm phụ, cron hoặc không còn route nào_

### `board_cards`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `board_id` | TEXT NOT NULL |
| `list_id` | TEXT NOT NULL |
| `title` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `created_by` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `description` | TEXT |
| `start_at` | INTEGER |
| `due_at` | INTEGER |
| `done` | INTEGER NOT NULL DEFAULT 0 |
| `cover` | TEXT |
| `archived` | INTEGER NOT NULL DEFAULT 0 |
| `customer_id` | TEXT |
| `card_kind` | TEXT NOT NULL DEFAULT 'task' |
| `project_card_id` | TEXT |
| `work_project_id` | TEXT |
| `description_by` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `result` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Route dùng trực tiếp (29): `POST /api/admin/customers/:id/archive`, `GET /api/admin/system`, `GET /api/admin/storage`, `GET /api/admin/storage/check`, `POST /api/admin/storage/clean`, `GET /api/boards`, `GET /api/boards/:id`, `DELETE /api/boards/:id/members/:userId`, `PUT /api/lists/:id`, `DELETE /api/lists/:id`, `POST /api/lists/:id/sort`, `POST /api/lists/:id/move-cards` … (+17)

### `board_labels`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `board_id` | TEXT NOT NULL |
| `name` | TEXT NOT NULL |
| `color` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |

Route dùng trực tiếp (6): `GET /api/boards/:id`, `POST /api/boards/:id/labels`, `PUT /api/labels/:id`, `DELETE /api/labels/:id`, `PUT /api/cards/:id/labels`, `GET /api/client-work`

### `board_lists`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `board_id` | TEXT NOT NULL |
| `name` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `created_at` | INTEGER NOT NULL |
| `archived` | INTEGER NOT NULL DEFAULT 0 |
| `folded` | INTEGER NOT NULL DEFAULT 0  /* thêm bằng nâng cấp (db.ts) */ |
| `color` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Route dùng trực tiếp (12): `GET /api/boards/:id`, `GET /api/boards/:id/archived`, `POST /api/boards/:id/lists`, `PUT /api/lists/:id`, `DELETE /api/lists/:id`, `POST /api/lists/:id/copy`, `PUT /api/cards/:id`, `GET /api/planner`, `GET /api/client-work`, `GET /api/customer-tasks`, `GET /api/boards-search`, `GET /api/tasks/:id`

### `board_members`

| Cột | Định nghĩa |
|---|---|
| `board_id` | TEXT NOT NULL |
| `user_id` | TEXT NOT NULL |
| `role` | TEXT NOT NULL |
| `added_by` | TEXT |
| `created_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY (board_id, user_id)`

Route dùng trực tiếp (7): `POST /api/workspaces/:id/transfer-owner`, `GET /api/boards`, `PUT /api/boards/:id/members/:userId`, `DELETE /api/boards/:id/members/:userId`, `POST /api/boards/:id/transfer-owner`, `PUT /api/cards/:id/members`, `GET /api/search`

### `board_stars`

| Cột | Định nghĩa |
|---|---|
| `user_id` | TEXT NOT NULL |
| `board_id` | TEXT NOT NULL |

Ràng buộc: `PRIMARY KEY (user_id, board_id)`

Route dùng trực tiếp (3): `GET /api/boards`, `GET /api/boards/:id`, `PUT /api/boards/:id/star`

### `boards`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `bg` | TEXT NOT NULL |
| `role_id` | TEXT |
| `created_by` | TEXT |
| `pos` | REAL NOT NULL |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `about` | TEXT |
| `workspace_id` | TEXT |
| `private` | INTEGER NOT NULL DEFAULT 0 |
| `member_edit` | INTEGER NOT NULL DEFAULT 0  /* thêm bằng nâng cấp (db.ts) */ |
| `label_text` | INTEGER NOT NULL DEFAULT 0  /* thêm bằng nâng cấp (db.ts) */ |
| `customer_id` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `editor_share` | INTEGER NOT NULL DEFAULT 1  /* thêm bằng nâng cấp (db.ts) */ |
| `view` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |
| `start_at` | INTEGER  /* thêm bằng nâng cấp (db.ts) */ |

Route dùng trực tiếp (20): `POST /api/admin/customers/:id/archive`, `GET /api/admin/departments`, `GET /api/admin/system`, `GET /api/admin/storage`, `DELETE /api/roles/:id`, `POST /api/workspaces/:id/transfer-owner`, `GET /api/boards`, `POST /api/boards`, `PUT /api/boards/:id`, `PUT /api/boards/:id/background`, `POST /api/boards/:id/transfer-owner`, `POST /api/lists/:id/cards` … (+8)

### `card_attachments`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `card_id` | TEXT NOT NULL |
| `user_id` | TEXT |
| `name` | TEXT NOT NULL |
| `url` | TEXT NOT NULL |
| `created_at` | INTEGER NOT NULL |
| `customer_id` | TEXT |
| `file_key` | TEXT |

Route dùng trực tiếp (7): `POST /api/admin/customers/:id/archive`, `GET /api/admin/storage`, `POST /api/cards/:id/attachments`, `DELETE /api/attachments/:id`, `POST /api/cards/:id/files`, `GET /api/customer-tasks`, `DELETE /api/customers/:id/folder`

### `card_checklists`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `card_id` | TEXT NOT NULL |
| `title` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |

Route dùng trực tiếp (4): `POST /api/cards/:id/copy`, `POST /api/cards/:id/checklists`, `PUT /api/checklists/:id`, `DELETE /api/checklists/:id`

### `card_comments`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `card_id` | TEXT NOT NULL |
| `board_id` | TEXT NOT NULL |
| `user_id` | TEXT NOT NULL |
| `text` | TEXT NOT NULL |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `reply_to_id` | TEXT |

Route dùng trực tiếp (8): `GET /api/admin/storage`, `POST /api/cards/:id/comments`, `PUT /api/comments/:id`, `DELETE /api/comments/:id`, `GET /api/tasks/:id`, `POST /api/tasks/:id/comments`, `PUT /api/tasks/comments/:id`, `DELETE /api/tasks/comments/:id`

### `card_labels`

| Cột | Định nghĩa |
|---|---|
| `card_id` | TEXT NOT NULL |
| `label_id` | TEXT NOT NULL |

Ràng buộc: `PRIMARY KEY (card_id, label_id)`

Route dùng trực tiếp (5): `DELETE /api/labels/:id`, `POST /api/lists/:id/copy`, `POST /api/cards/:id/copy`, `PUT /api/cards/:id/labels`, `GET /api/client-work`

### `card_members`

| Cột | Định nghĩa |
|---|---|
| `card_id` | TEXT NOT NULL |
| `user_id` | TEXT NOT NULL |

Ràng buộc: `PRIMARY KEY (card_id, user_id)`

Route dùng trực tiếp (8): `DELETE /api/boards/:id/members/:userId`, `PUT /api/cards/:id`, `PUT /api/cards/:id/members`, `POST /api/cards/:id/comments`, `GET /api/planner`, `GET /api/client-work`, `GET /api/tasks`, `POST /api/tasks/:id/card`

### `checklist_items`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `card_id` | TEXT NOT NULL |
| `text` | TEXT NOT NULL |
| `done` | INTEGER NOT NULL DEFAULT 0 |
| `pos` | REAL NOT NULL |

Ràng buộc: `checklist_id TEXT NOT NULL`

Route dùng trực tiếp (5): `POST /api/cards/:id/copy`, `DELETE /api/checklists/:id`, `POST /api/checklists/:id/items`, `PUT /api/items/:id`, `DELETE /api/items/:id`

### `inbox_cards`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT NOT NULL |
| `title` | TEXT NOT NULL |
| `pos` | REAL NOT NULL |
| `done` | INTEGER NOT NULL DEFAULT 0 |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Index: `inbox_cards_user`(user_id, pos)

Route dùng trực tiếp (6): `POST /api/cards/:id/files`, `GET /api/inbox`, `POST /api/inbox`, `PUT /api/inbox/:id`, `DELETE /api/inbox/:id`, `POST /api/inbox/:id/to-list`

### `workspace_members`

| Cột | Định nghĩa |
|---|---|
| `workspace_id` | TEXT NOT NULL |
| `user_id` | TEXT NOT NULL |
| `role` | TEXT NOT NULL |
| `added_by` | TEXT |
| `created_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY (workspace_id, user_id)`

Route dùng trực tiếp (5): `GET /api/workspaces`, `DELETE /api/workspaces/:id`, `PUT /api/workspaces/:id/members/:userId`, `DELETE /api/workspaces/:id/members/:userId`, `POST /api/workspaces/:id/transfer-owner`

### `workspaces`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `about` | TEXT |
| `owner_id` | TEXT NOT NULL |
| `visibility` | TEXT NOT NULL DEFAULT 'private' |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `customer_id` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Route dùng trực tiếp (7): `GET /api/admin/storage`, `DELETE /api/positions/:id`, `POST /api/workspaces`, `PUT /api/workspaces/:id`, `DELETE /api/workspaces/:id`, `POST /api/workspaces/:id/transfer-owner`, `GET /api/client-work`

## Báo cáo

### `report_images`

| Cột | Định nghĩa |
|---|---|
| `report_id` | TEXT NOT NULL |
| `file` | TEXT NOT NULL |
| `mime` | TEXT NOT NULL |
| `data` | TEXT NOT NULL |

Ràng buộc: `PRIMARY KEY(report_id,file)`

Route dùng trực tiếp (4): `GET /api/admin/storage`, `DELETE /api/reports/:id`, `GET /api/reports/:id/images/:file`, `GET /api/reports/:id/html`

### `reports`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `customer_id` | TEXT |
| `project_id` | TEXT |
| `title` | TEXT NOT NULL |
| `data` | TEXT NOT NULL |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (10): `POST /api/admin/customers/:id/archive`, `GET /api/reports`, `POST /api/reports`, `PUT /api/reports/:id`, `POST /api/reports/:id/autofill`, `DELETE /api/reports/:id`, `POST /api/reports/:id/videos`, `POST /api/reports/:id/meta`, `POST /api/reports/:id/link-videos`, `DELETE /api/customers/:id/folder`

## Thông báo, email, chat, ghi chú, hỗ trợ

### `chat_messages`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `sender_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `recipient_id` | TEXT REFERENCES users(id) ON DELETE CASCADE |
| `channel` | TEXT NOT NULL DEFAULT 'general' |
| `message` | TEXT NOT NULL |
| `created_at` | INTEGER NOT NULL |

Index: `chat_messages_channel`(channel, created_at); `chat_messages_dm`(sender_id, recipient_id, created_at)

Route dùng trực tiếp (7): `GET /api/admin/storage`, `GET /api/chat/messages`, `GET /api/chat/unread`, `POST /api/chat/messages`, `DELETE /api/chat/messages/:id`, `DELETE /api/chat/messages`, `GET /api/chat/members`

### `chat_reads`

| Cột | Định nghĩa |
|---|---|
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `conversation` | TEXT NOT NULL |
| `read_at` | INTEGER NOT NULL |

Ràng buộc: `PRIMARY KEY(user_id, conversation)`

Route dùng trực tiếp (2): `POST /api/inbox/:id/to-list`, `GET /api/chat/unread`

### `mail_outbox`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `payload` | TEXT NOT NULL |
| `state` | TEXT NOT NULL DEFAULT 'pending' |
| `attempts` | INTEGER NOT NULL DEFAULT 0 |
| `created_at` | INTEGER NOT NULL |
| `sent_at` | INTEGER |
| `next_at` | INTEGER NOT NULL DEFAULT 0 |
| `locked_until` | INTEGER NOT NULL DEFAULT 0 |
| `error` | TEXT |

Index: `mail_outbox_pending`(state,next_at)

Route dùng trực tiếp (6): `POST /api/admin/notifications`, `GET /api/admin/mail-log`, `GET /api/notifications`, `PUT /api/notifications`, `DELETE /api/notifications/email`, `POST /api/notifications/test`

### `notification_logs`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `title` | TEXT NOT NULL |
| `body` | TEXT NOT NULL DEFAULT '' |
| `link` | TEXT NOT NULL DEFAULT '' |
| `audience` | TEXT NOT NULL |
| `recipients` | INTEGER NOT NULL |
| `emailed` | INTEGER NOT NULL DEFAULT 0 |
| `template_id` | TEXT |
| `sent_by` | TEXT |
| `created_at` | INTEGER NOT NULL |

Index: `notification_logs_at`(created_at)

Route dùng trực tiếp (3): `POST /api/admin/notifications`, `GET /api/admin/notifications`, `GET /api/admin/notifications/:id`

### `notification_preferences`

| Cột | Định nghĩa |
|---|---|
| `user_id` | TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE |
| `enabled` | INTEGER NOT NULL DEFAULT 0 |
| `updated_at` | INTEGER NOT NULL |
| `email` | TEXT |
| `verified_at` | INTEGER |
| `pending_email` | TEXT |
| `verification_hash` | TEXT |
| `verification_expires` | INTEGER |
| `verification_attempts` | INTEGER NOT NULL DEFAULT 0 |
| `verification_sent_at` | INTEGER |

Route dùng trực tiếp (7): `POST /api/admin/notifications`, `GET /api/notifications`, `PUT /api/notifications`, `POST /api/notifications/email/request`, `POST /api/notifications/email/verify`, `DELETE /api/notifications/email`, `POST /api/notifications/test`

### `notification_templates`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `title` | TEXT NOT NULL |
| `body` | TEXT NOT NULL DEFAULT '' |
| `link` | TEXT NOT NULL DEFAULT '' |
| `created_by` | TEXT |
| `updated_by` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `deleted_at` | INTEGER |

Route dùng trực tiếp (4): `GET /api/admin/mail-log`, `POST /api/admin/notification-templates`, `PUT /api/admin/notification-templates/:id`, `DELETE /api/admin/notification-templates/:id`

### `notifications`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `task_id` | TEXT |
| `payload` | TEXT NOT NULL |
| `created_at` | INTEGER NOT NULL |
| `read_at` | INTEGER |
| `broadcast_id` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Index: `notifications_user`(user_id,created_at); `notifications_broadcast`(broadcast_id)

Route dùng trực tiếp (9): `POST /api/admin/notifications`, `GET /api/admin/notifications`, `GET /api/admin/notifications/:id`, `GET /api/admin/storage`, `GET /api/admin/storage/check`, `POST /api/admin/storage/clean`, `GET /api/notifications/latest`, `GET /api/notifications/inbox`, `POST /api/notifications/read`

### `quick_notes`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `body` | TEXT NOT NULL DEFAULT '' |
| `color` | TEXT NOT NULL DEFAULT 'yellow' |
| `open` | INTEGER NOT NULL DEFAULT 0 |
| `x` | INTEGER |
| `y` | INTEGER |
| `w` | INTEGER |
| `h` | INTEGER |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `pos` | REAL  /* thêm bằng nâng cấp (db.ts) */ |

Index: `quick_notes_user`(user_id,updated_at)

Route dùng trực tiếp (8): `GET /api/admin/storage`, `GET /api/quick-notes`, `POST /api/quick-notes`, `PUT /api/quick-notes/order`, `PUT /api/quick-notes/:id`, `DELETE /api/quick-notes/:id`, `POST /api/quick-notes/delete`, `GET /api/search`

### `support_tickets`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `user_id` | TEXT NOT NULL |
| `user_name` | TEXT NOT NULL |
| `user_email` | TEXT |
| `message` | TEXT NOT NULL |
| `status` | TEXT NOT NULL DEFAULT 'pending' |
| `created_at` | INTEGER NOT NULL |
| `images` | TEXT  /* thêm bằng nâng cấp (db.ts) */ |

Index: `support_tickets_status`(status, created_at)

Route dùng trực tiếp (5): `POST /api/support`, `GET /api/admin/support`, `GET /api/admin/support/:id/images`, `PUT /api/admin/support/:id`, `DELETE /api/admin/support/:id`

## Nhật ký

### `audit_logs`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `kind` | TEXT NOT NULL |
| `action` | TEXT NOT NULL |
| `user_id` | TEXT |
| `user_name` | TEXT |
| `entity_type` | TEXT |
| `entity_id` | TEXT |
| `entity_label` | TEXT |
| `method` | TEXT |
| `path` | TEXT |
| `status` | INTEGER |
| `old_data` | TEXT |
| `new_data` | TEXT |
| `ip` | TEXT |
| `agent` | TEXT |
| `created_at` | INTEGER NOT NULL |

Index: `audit_logs_kind`(kind,created_at); `audit_logs_user`(user_id,created_at); `audit_logs_entity`(entity_type,entity_id,created_at)

Route dùng trực tiếp (5): `GET /api/admin/staff/:id`, `GET /api/admin/system`, `GET /api/admin/storage`, `GET /api/admin/storage/check`, `POST /api/admin/storage/clean`

## Trình dựng video

### `ai_calls`

| Cột | Định nghĩa |
|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `project_id` | TEXT |
| `provider` | TEXT |
| `model` | TEXT |
| `kind` | TEXT |
| `ms` | INTEGER |
| `ok` | INTEGER |
| `error` | TEXT |
| `created_at` | INTEGER NOT NULL |

Route dùng trực tiếp (0): _chỉ qua hàm phụ, cron hoặc không còn route nào_

### `assets`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `project_id` | TEXT |
| `kind` | TEXT NOT NULL |
| `mime` | TEXT |
| `file` | TEXT NOT NULL |
| `bytes` | INTEGER |
| `source` | TEXT |
| `meta` | TEXT |
| `created_at` | INTEGER NOT NULL |

Route dùng trực tiếp (5): `GET /api/admin/storage`, `DELETE /api/projects/:id`, `GET /api/projects/:id/renders`, `GET /api/renders/:id/download`, `DELETE /api/renders/:id`

### `jobs`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `project_id` | TEXT |
| `scene_id` | TEXT |
| `kind` | TEXT NOT NULL |
| `provider` | TEXT NOT NULL |
| `model` | TEXT |
| `input` | TEXT NOT NULL |
| `status` | TEXT NOT NULL |
| `remote_id` | TEXT |
| `remote_meta` | TEXT |
| `result` | TEXT |
| `error` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |
| `polled_at` | INTEGER DEFAULT 0 |

Index: `jobs_project`(project_id, created_at)

Route dùng trực tiếp (1): `DELETE /api/projects/:id`

### `projects`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `title` | TEXT NOT NULL |
| `aspect` | TEXT NOT NULL DEFAULT '16:9' |
| `data` | TEXT NOT NULL |
| `customer_id` | TEXT |
| `created_at` | INTEGER NOT NULL |
| `updated_at` | INTEGER NOT NULL |

Route dùng trực tiếp (10): `POST /api/admin/customers/:id/archive`, `POST /api/reports`, `GET /api/projects`, `POST /api/projects`, `PUT /api/projects/:id`, `POST /api/projects/:id/drive`, `POST /api/projects/:id/duplicate`, `DELETE /api/projects/:id`, `GET /api/renders/:id/download`, `DELETE /api/customers/:id/folder`

### `renders`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `project_id` | TEXT NOT NULL |
| `asset_id` | TEXT NOT NULL |
| `status` | TEXT NOT NULL DEFAULT 'ready' |
| `created_at` | INTEGER NOT NULL |

Route dùng trực tiếp (5): `GET /api/admin/storage`, `DELETE /api/projects/:id`, `GET /api/projects/:id/renders`, `GET /api/renders/:id/download`, `DELETE /api/renders/:id`

## Connector Claude (MCP)

### `mcp_clients`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `redirect_uris` | TEXT NOT NULL |
| `secret_hash` | TEXT |
| `created_at` | INTEGER NOT NULL |

Route dùng trực tiếp (1): `POST /api/oauth/register`

### `mcp_codes`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `client_id` | TEXT NOT NULL |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `redirect_uri` | TEXT NOT NULL |
| `challenge` | TEXT NOT NULL |
| `expires_at` | INTEGER NOT NULL |

Route dùng trực tiếp (2): `POST /api/oauth/authorize`, `POST /api/oauth/token`

### `mcp_tokens`

| Cột | Định nghĩa |
|---|---|
| `id` | TEXT PRIMARY KEY |
| `kind` | TEXT NOT NULL |
| `client_id` | TEXT NOT NULL |
| `user_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `expires_at` | INTEGER NOT NULL |
| `created_at` | INTEGER NOT NULL |

Index: `mcp_tokens_user`(user_id)

Route dùng trực tiếp (2): `POST /api/oauth/token`, `POST /api/mcp`

## Cấu hình

### `settings`

| Cột | Định nghĩa |
|---|---|
| `key` | TEXT PRIMARY KEY |
| `value` | TEXT NOT NULL |

Route dùng trực tiếp (3): `GET /api/workspaces`, `PUT /api/workspaces/:id/avatar`, `DELETE /api/workspaces/:id`
