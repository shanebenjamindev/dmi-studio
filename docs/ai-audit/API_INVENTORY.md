# API_INVENTORY — DMI Workspace

> Sinh tự động từ mã nguồn (quét tĩnh `server/**/*.ts`, ngày 14/11/2026) rồi rà tay. **Mọi dòng là route có thật** trong code hiện tại (gồm thay đổi chưa commit của nhánh `feat/sheet-to-timeline-editor`). Không có route nào được đoán.

## Cách đọc

- **Tầng guard**: kết quả của `guard()` ([server/auth.ts](../../server/auth.ts)) áp cho đường dẫn, trước handler:
  - `public`: không cần đăng nhập (đăng nhập, OAuth, MCP tự kiểm token, health).
  - `signed-in`: cần phiên đăng nhập (cookie `dms_sid`, hoặc token MCP qua `ACTING`); guard còn tự kiểm quyền theo bản ghi khi đường dẫn chứa id khách hàng, báo cáo, dịch vụ (`task-projects`), công việc (`tasks/tk_…`).
  - `company-admin`: chỉ `users.role = 'admin'`; `(delegable)`: một vai trò có quyền tương ứng trong Phân quyền cũng được (`DELEGATED`).
- **Trang**: quyền vào trang (`PAGE_OF` / `CRM`): `workspace` (Drive khách hàng), `editor` (trình dựng), `ads`; `crm` = trang Khách hàng (ai cũng vào, lọc theo bản ghi).
- **Kiểm tra trong handler**: dấu hiệu tìm thấy trong thân handler: `perm:x.y` (RBAC phạm vi, `need()`), `customer-level`, `project-level`, `board:<mức>`, `task-writable`, `admin-role-check`, `403-path` (có nhánh trả 403), `turnstile`, `rate-limit`, `custom-audit`.
- **Input**: các trường `b.<x>` đọc trực tiếp từ JSON body; **cận dưới**, vì nhiều route đọc thêm qua hàm phụ (ví dụ `taskInput` của `POST/PUT /api/tasks` đọc `title, status, startAt, dueAt, projectId, parentId, campaignId, assigneeIds, assigneeUserIds, followerUserIds, labels, description, result`, [server/tasks.ts:290](../../server/tasks.ts#L290)). **Query**: `req.query.get()`; **Status**: mã trả về ghi rõ trong handler (200 là mặc định khi trống).
- **Bảng**: các bảng xuất hiện trong SQL của handler (FROM/INTO/UPDATE/JOIN). Hàm phụ ở module khác có thể đụng thêm bảng: đây là cận dưới.
- **Phản hồi**: JSON (`json(res, status, body)`, [server/http.ts](../../server/http.ts)); lỗi luôn là `{ "error": "<tiếng Việt>", "need"?: "<trường thiếu>" }` với mã 4xx/5xx ([server/app.ts](../../server/app.ts)). Hình dạng body thành công: xem handler tại file:dòng.
- **Nhật ký**: mọi request không phải GET của người đã đăng nhập đi qua `withTrail` ([server/audit.ts:118](../../server/audit.ts)) và ghi `audit_logs` (trừ danh sách `QUIET`).
- Route sinh trong vòng lặp/hàm phụ đã được viết ra: 5 danh mục × 5 route của `registerDict`, 2 × 4 route file khách hàng (`files` và bí danh cũ `videos`), 4 địa chỉ `.well-known`.

Tổng: **382 route**.


## Connector Claude (MCP + OAuth) (13)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| GET | `/.well-known/oauth-authorization-server` | [mcp.ts:106](../../server/mcp.ts#L106) | public |  | OAuth metadata |  |  | 200 |
| GET | `/.well-known/oauth-authorization-server/api/mcp` | [mcp.ts:106](../../server/mcp.ts#L106) | public |  | OAuth metadata |  |  | 200 |
| GET | `/.well-known/oauth-protected-resource` | [mcp.ts:95](../../server/mcp.ts#L95) | public |  |  |  |  |  |
| GET | `/.well-known/oauth-protected-resource/api/mcp` | [mcp.ts:96](../../server/mcp.ts#L96) | public |  |  |  |  | 200 |
| GET | `/.well-known/openid-configuration` | [mcp.ts:106](../../server/mcp.ts#L106) | public |  | OAuth metadata |  |  | 200 |
| GET | `/.well-known/openid-configuration/api/mcp` | [mcp.ts:106](../../server/mcp.ts#L106) | public |  | OAuth metadata |  |  | 200 |
| DELETE | `/api/mcp` | [mcp.ts:188](../../server/mcp.ts#L188) | public |  |  |  |  |  |
| GET | `/api/mcp` | [mcp.ts:179](../../server/mcp.ts#L179) | public |  |  |  |  |  |
| POST | `/api/mcp` | [mcp.ts:163](../../server/mcp.ts#L163) | public |  |  |  | mcp_tokens | 400, 200 |
| GET | `/api/oauth/authorize` | [mcp.ts:120](../../server/mcp.ts#L120) | public |  |  |  |  |  |
| POST | `/api/oauth/authorize` | [mcp.ts:129](../../server/mcp.ts#L129) | public |  | 403-path | body: get | mcp_codes |  |
| POST | `/api/oauth/register` | [mcp.ts:109](../../server/mcp.ts#L109) | public |  |  | body: redirect_uris, token_endpoint_auth_method, client_name | mcp_clients | 201 |
| POST | `/api/oauth/token` | [mcp.ts:142](../../server/mcp.ts#L142) | public |  |  | body: grant_type, code, redirect_uri, code_verifier, refresh_token | mcp_codes, mcp_tokens, users | 200 |

## Đăng nhập, tài khoản, hồ sơ (34)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/access` | [auth.ts:330](../../server/auth.ts#L330) | signed-in |  |  |  |  | 200 |
| PUT | `/api/access` | [auth.ts:331](../../server/auth.ts#L331) | company-admin (delegable) |  |  | body: member |  | 200 |
| DELETE | `/api/auth/avatar` | [auth.ts:316](../../server/auth.ts#L316) | public |  |  |  | user_avatars, users | 200 |
| PUT | `/api/auth/avatar` | [auth.ts:305](../../server/auth.ts#L305) | public |  |  |  | user_avatars, users | 200 |
| GET | `/api/auth/config` | [auth.ts:262](../../server/auth.ts#L262) | public |  |  |  |  | 200 |
| POST | `/api/auth/forgot` | [auth.ts:394](../../server/auth.ts#L394) | public |  | turnstile | body: turnstileToken, email | users, password_resets | 200 |
| GET | `/api/auth/google` | [auth.ts:424](../../server/auth.ts#L424) | public |  |  |  |  |  |
| POST | `/api/auth/login` | [auth.ts:359](../../server/auth.ts#L359) | public |  | 403-path, turnstile, rate-limit | body: turnstileToken, email, password |  | 200 |
| POST | `/api/auth/logout` | [auth.ts:375](../../server/auth.ts#L375) | public |  |  |  | sessions | 200 |
| GET | `/api/auth/me` | [auth.ts:263](../../server/auth.ts#L263) | public |  |  |  |  | 200 |
| PUT | `/api/auth/password` | [auth.ts:381](../../server/auth.ts#L381) | public |  |  | body: current, next | users, sessions | 200 |
| PUT | `/api/auth/prefs` | [auth.ts:269](../../server/auth.ts#L269) | public |  |  |  | user_prefs | 200 |
| PUT | `/api/auth/profile` | [auth.ts:290](../../server/auth.ts#L290) | public |  |  |  | users | 200 |
| POST | `/api/auth/reset` | [auth.ts:410](../../server/auth.ts#L410) | public |  |  | body: token, password | password_resets, users, sessions | 200 |
| POST | `/api/auth/setup` | [auth.ts:339](../../server/auth.ts#L339) | public |  | 403-path, turnstile | body: turnstileToken, code, email, name, password | users | 201 |
| GET | `/api/avatars` | [auth.ts:324](../../server/auth.ts#L324) | signed-in |  |  |  | users | 200 |
| GET | `/api/avatars/:id` | [admin/staff.ts:206](../../server/admin/staff.ts#L206) | signed-in |  |  |  | user_avatars |  |
| DELETE | `/api/google/accounts/:email` | [workspace.ts:598](../../server/workspace.ts#L598) | company-admin |  |  |  |  | 200 |
| GET | `/api/google/callback` | [workspace.ts:583](../../server/workspace.ts#L583) | public |  |  | query: error, state, code |  |  |
| PUT | `/api/google/config` | [workspace.ts:576](../../server/workspace.ts#L576) | company-admin |  |  | body: clientId, clientSecret |  | 200 |
| GET | `/api/google/login` | [workspace.ts:581](../../server/workspace.ts#L581) | company-admin |  |  |  |  |  |
| GET | `/api/google/status` | [workspace.ts:572](../../server/workspace.ts#L572) | signed-in |  |  |  |  | 200 |
| DELETE | `/api/positions/:id` | [boards.ts:433](../../server/boards.ts#L433) | company-admin (delegable) |  |  |  | users, dept_roles, workspaces, customers | 200 |
| PUT | `/api/positions/:id` | [boards.ts:425](../../server/boards.ts#L425) | company-admin (delegable) |  |  | body: name, level | dept_roles | 200 |
| GET | `/api/profiles/:id` | [auth.ts:282](../../server/auth.ts#L282) | signed-in |  | admin-role-check |  | team_roles | 200 |
| GET | `/api/roles` | [boards.ts:379](../../server/boards.ts#L379) | signed-in |  |  |  | users, dept_roles, team_roles | 200 |
| POST | `/api/roles` | [boards.ts:390](../../server/boards.ts#L390) | company-admin (delegable) |  |  | body: name, color, pages | team_roles | 201 |
| DELETE | `/api/roles/:id` | [boards.ts:409](../../server/boards.ts#L409) | company-admin (delegable) |  |  |  | users, boards, dept_roles, team_roles | 200 |
| PUT | `/api/roles/:id` | [boards.ts:400](../../server/boards.ts#L400) | company-admin (delegable) |  |  | body: name, color, pages | team_roles | 200 |
| POST | `/api/roles/:id/positions` | [boards.ts:417](../../server/boards.ts#L417) | company-admin (delegable) |  |  | body: name, level | team_roles, dept_roles | 201 |
| GET | `/api/users` | [auth.ts:427](../../server/auth.ts#L427) | company-admin |  |  |  |  | 200 |
| POST | `/api/users` | [auth.ts:428](../../server/auth.ts#L428) | company-admin |  | admin-role-check | body: email, role, password, teamRole, name, deptRole, notifyEmail | users | 201 |
| DELETE | `/api/users/:id` | [auth.ts:471](../../server/auth.ts#L471) | company-admin |  | admin-role-check, 403-path |  | users | 200 |
| PUT | `/api/users/:id` | [auth.ts:444](../../server/auth.ts#L444) | company-admin |  | admin-role-check | body: role, disabled, email, password, teamRole, deptRole, name, notifyEmail | users, sessions | 200 |

## Khách hàng (CRM, Drive) (50)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/customer-flow` | [customer-tabs.ts:20](../../server/customer-tabs.ts#L20) | signed-in |  |  |  |  | 200 |
| GET | `/api/customer-tasks` | [boards.ts:1578](../../server/boards.ts#L1578) | signed-in | workspace |  | body: id, name; query: customer | board_cards, board_lists, card_attachments | 200 |
| GET | `/api/customers` | [workspace.ts:661](../../server/workspace.ts#L661) | signed-in | workspace |  | query: fresh | customers | 200 |
| POST | `/api/customers` | [workspace.ts:677](../../server/workspace.ts#L677) | signed-in | workspace | 403-path | body: databaseOnly, managerId, existingFolder, notes, name, links | customers, customer_members | 201 |
| DELETE | `/api/customers/:id` | [workspace.ts:972](../../server/workspace.ts#L972) | signed-in | crm | guard:MANAGE (admin công ty / admin phòng / quản lý khách), 403-path |  |  | 200 |
| GET | `/api/customers/:id` | [workspace.ts:916](../../server/workspace.ts#L916) | signed-in | workspace |  | query: fresh |  | 200 |
| PUT | `/api/customers/:id` | [workspace.ts:917](../../server/workspace.ts#L917) | signed-in | workspace | 403-path | body: name, links, notes | customers, boards | 200 |
| GET | `/api/customers/:id/browse` | [workspace.ts:1030](../../server/workspace.ts#L1030) | signed-in | workspace |  | query: folder |  | 200 |
| DELETE | `/api/customers/:id/files/:key` | [workspace.ts:1131](../../server/workspace.ts#L1131) | signed-in | workspace | guard:MANAGE (admin công ty / admin phòng / quản lý khách) |  |  | 200 |
| GET | `/api/customers/:id/files/:key` | [workspace.ts:1111](../../server/workspace.ts#L1111) | signed-in | workspace |  |  |  |  |
| POST | `/api/customers/:id/files/:key/share` | [workspace.ts:1123](../../server/workspace.ts#L1123) | signed-in | workspace |  |  |  | 200 |
| GET | `/api/customers/:id/files/:key/thumb` | [workspace.ts:1116](../../server/workspace.ts#L1116) | signed-in | workspace |  |  |  |  |
| DELETE | `/api/customers/:id/folder` | [workspace.ts:950](../../server/workspace.ts#L950) | signed-in | workspace | guard:MANAGE (admin công ty / admin phòng / quản lý khách) |  | customers, projects, task_projects, reports, board_cards, boards, card_attachments, customer_tags, customer_needs, customer_members | 200 |
| PUT | `/api/customers/:id/folder` | [workspace.ts:930](../../server/workspace.ts#L930) | signed-in | workspace | guard:MANAGE (admin công ty / admin phòng / quản lý khách) | body: link, loc | customers | 200 |
| POST | `/api/customers/:id/folders` | [workspace.ts:1000](../../server/workspace.ts#L1000) | signed-in | workspace | guard:MANAGE (admin công ty / admin phòng / quản lý khách) |  |  | 201 |
| DELETE | `/api/customers/:id/folders/:fkey` | [workspace.ts:1043](../../server/workspace.ts#L1043) | signed-in | workspace | guard:MANAGE (admin công ty / admin phòng / quản lý khách) |  |  | 200 |
| PUT | `/api/customers/:id/folders/:fkey` | [workspace.ts:1017](../../server/workspace.ts#L1017) | signed-in | workspace | guard:MANAGE (admin công ty / admin phòng / quản lý khách) |  |  | 200 |
| GET | `/api/customers/:id/history` | [customer-tabs.ts:27](../../server/customer-tabs.ts#L27) | signed-in | crm |  |  |  | 200 |
| GET | `/api/customers/:id/members` | [workspace.ts:779](../../server/workspace.ts#L779) | signed-in | crm | customer-level |  | users, customer_members | 200 |
| DELETE | `/api/customers/:id/members/:userId` | [workspace.ts:797](../../server/workspace.ts#L797) | signed-in | crm | customer-level |  | customer_members | 200 |
| PUT | `/api/customers/:id/members/:userId` | [workspace.ts:786](../../server/workspace.ts#L786) | signed-in | crm | customer-level |  | users, customer_members | 200 |
| GET | `/api/customers/:id/projects` | [workspace.ts:823](../../server/workspace.ts#L823) | signed-in | crm |  |  | task_campaigns, tasks, task_projects | 200 |
| POST | `/api/customers/:id/projects` | [workspace.ts:830](../../server/workspace.ts#L830) | signed-in | crm | customer-level, project-level | body: name, projectId, services | task_projects, services, customer_needs | 200, 201 |
| PUT | `/api/customers/:id/projects/:project` | [workspace.ts:856](../../server/workspace.ts#L856) | signed-in | crm | customer-level, project-level | body: unlink, name | task_projects | 200 |
| GET | `/api/customers/:id/record` | [workspace.ts:900](../../server/workspace.ts#L900) | signed-in | crm |  |  |  | 200 |
| PUT | `/api/customers/:id/record` | [workspace.ts:901](../../server/workspace.ts#L901) | signed-in | crm | customer-level |  | customers, customer_members, boards | 200 |
| POST | `/api/customers/:id/reveal` | [workspace.ts:991](../../server/workspace.ts#L991) | signed-in | workspace |  |  |  | 200 |
| GET | `/api/customers/:id/tasks` | [customer-tabs.ts:12](../../server/customer-tabs.ts#L12) | signed-in | crm |  | body: dueAt |  | 200 |
| POST | `/api/customers/:id/transfer-owner` | [workspace.ts:802](../../server/workspace.ts#L802) | signed-in | workspace | admin-role-check, 403-path |  | users, customer_members, customers | 200 |
| POST | `/api/customers/:id/videos` | [workspace.ts:1077](../../server/workspace.ts#L1077) | signed-in | workspace |  | query: folder, name | customers | 201 |
| DELETE | `/api/customers/:id/videos/:key` | [workspace.ts:1131](../../server/workspace.ts#L1131) | signed-in | workspace | guard:MANAGE (admin công ty / admin phòng / quản lý khách), bí danh cũ của /files/ |  |  | 200 |
| GET | `/api/customers/:id/videos/:key` | [workspace.ts:1111](../../server/workspace.ts#L1111) | signed-in | workspace | bí danh cũ của /files/ |  |  |  |
| POST | `/api/customers/:id/videos/:key/share` | [workspace.ts:1123](../../server/workspace.ts#L1123) | signed-in | workspace | bí danh cũ của /files/ |  |  | 200 |
| GET | `/api/customers/:id/videos/:key/thumb` | [workspace.ts:1116](../../server/workspace.ts#L1116) | signed-in | workspace | bí danh cũ của /files/ |  |  |  |
| POST | `/api/customers/:id/videos/session` | [workspace.ts:1060](../../server/workspace.ts#L1060) | signed-in | workspace |  | query: folder, name, size, mime |  | 200 |
| POST | `/api/customers/:id/videos/session/check` | [workspace.ts:1071](../../server/workspace.ts#L1071) | signed-in | workspace |  | body: url, size |  | 200 |
| GET | `/api/customers/all` | [workspace.ts:730](../../server/workspace.ts#L730) | signed-in | crm |  |  | customers | 200 |
| POST | `/api/customers/bulk-delete` | [workspace.ts:978](../../server/workspace.ts#L978) | signed-in | crm |  | body: ids | customers | 200 |
| GET | `/api/customers/classifications` | [workspace.ts:875](../../server/workspace.ts#L875) | signed-in | crm |  |  | customer_categories | 200 |
| GET | `/api/customers/directory` | [workspace.ts:732](../../server/workspace.ts#L732) | signed-in | crm | admin-role-check |  | customer_members, users, task_projects, task_campaigns, tasks, customers, customer_categories, customer_sources | 200 |
| POST | `/api/customers/import` | [workspace.ts:753](../../server/workspace.ts#L753) | signed-in | workspace | 403-path | body: text, linkProjects | customers, task_projects | 200 |
| GET | `/api/customers/managers` | [workspace.ts:890](../../server/workspace.ts#L890) | signed-in | crm |  |  | users, customer_members, customer_categories, customer_sources | 200 |
| GET | `/api/customers/sources` | [workspace.ts:876](../../server/workspace.ts#L876) | signed-in | crm |  |  | customer_sources | 200 |
| POST | `/api/customers/sources` | [workspace.ts:879](../../server/workspace.ts#L879) | signed-in | crm | admin-role-check, 403-path |  | customer_sources | 200, 201 |
| GET | `/api/customers/statuses` | [workspace.ts:874](../../server/workspace.ts#L874) | signed-in | crm |  |  |  | 200 |
| GET | `/api/workspace` | [workspace.ts:605](../../server/workspace.ts#L605) | signed-in | workspace |  |  |  | 200 |
| PUT | `/api/workspace` | [workspace.ts:607](../../server/workspace.ts#L607) | company-admin | workspace |  |  | customers | 200 |
| POST | `/api/workspace/browse` | [workspace.ts:628](../../server/workspace.ts#L628) | signed-in | workspace |  | body: name |  | 200 |
| POST | `/api/workspace/folders` | [workspace.ts:644](../../server/workspace.ts#L644) | signed-in | workspace | guard:MANAGE (admin công ty / admin phòng / quản lý khách) | body: name, loc |  | 201 |
| GET | `/api/workspace/places` | [workspace.ts:619](../../server/workspace.ts#L619) | signed-in | workspace |  |  |  | 200 |

## Công việc, dịch vụ khách (32)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| POST | `/api/task-people` | [tasks.ts:875](../../server/tasks.ts#L875) | signed-in |  | admin-role-check, 403-path |  | task_people | 201 |
| PUT | `/api/task-people/:id` | [tasks.ts:887](../../server/tasks.ts#L887) | signed-in |  | admin-role-check, 403-path |  | task_people, users | 200 |
| POST | `/api/task-projects` | [tasks.ts:408](../../server/tasks.ts#L408) | signed-in |  | customer-level |  | services, team_roles, task_projects, customer_needs | 201 |
| DELETE | `/api/task-projects/:project` | [tasks.ts:469](../../server/tasks.ts#L469) | signed-in |  | project-level |  |  | 200 |
| PUT | `/api/task-projects/:project` | [tasks.ts:434](../../server/tasks.ts#L434) | signed-in |  | customer-level, project-level |  | task_projects, team_roles | 200 |
| GET | `/api/task-projects/:project/campaigns` | [tasks.ts:523](../../server/tasks.ts#L523) | signed-in |  |  |  | task_projects, tasks, task_campaigns | 200 |
| POST | `/api/task-projects/:project/campaigns` | [tasks.ts:527](../../server/tasks.ts#L527) | signed-in |  | 403-path | body: name | task_projects, task_campaigns | 201 |
| DELETE | `/api/task-projects/:project/campaigns/:id` | [tasks.ts:538](../../server/tasks.ts#L538) | signed-in |  | 403-path |  | tasks, task_campaigns | 200 |
| PUT | `/api/task-projects/:project/campaigns/:id` | [tasks.ts:533](../../server/tasks.ts#L533) | signed-in |  | 403-path | body: name | task_campaigns | 200 |
| GET | `/api/task-projects/:project/members` | [tasks.ts:487](../../server/tasks.ts#L487) | signed-in |  | project-level |  | task_projects, users, task_project_members, team_roles | 200 |
| DELETE | `/api/task-projects/:project/members/:userId` | [tasks.ts:516](../../server/tasks.ts#L516) | signed-in |  | project-level |  | task_projects, task_project_members | 200 |
| PUT | `/api/task-projects/:project/members/:userId` | [tasks.ts:499](../../server/tasks.ts#L499) | signed-in |  | project-level, admin-role-check |  | task_projects, users, task_project_members | 200 |
| PUT | `/api/task-projects/:project/team` | [tasks.ts:493](../../server/tasks.ts#L493) | signed-in |  | project-level |  | team_roles, task_projects | 200 |
| POST | `/api/task-projects/bulk-delete` | [tasks.ts:474](../../server/tasks.ts#L474) | signed-in |  | admin-role-check | body: ids |  | 200 |
| POST | `/api/task-projects/for-service` | [tasks.ts:429](../../server/tasks.ts#L429) | signed-in |  |  | body: customerId, serviceId |  |  |
| GET | `/api/tasks` | [tasks.ts:572](../../server/tasks.ts#L572) | signed-in |  | admin-role-check, 403-path |  | team_members, teams, users, task_board_links, card_members | 200 |
| POST | `/api/tasks` | [tasks.ts:743](../../server/tasks.ts#L743) | signed-in |  |  | body: services, reviewerUserId | task_people, users, tasks | 201 |
| DELETE | `/api/tasks/:id` | [tasks.ts:791](../../server/tasks.ts#L791) | signed-in |  | task-writable, 403-path |  |  | 200 |
| GET | `/api/tasks/:id` | [tasks.ts:689](../../server/tasks.ts#L689) | signed-in |  | board:viewer | body: name, id | tasks, task_projects, task_board_links, board_cards, boards, board_lists, card_comments, users, task_comments, board_activity, task_activity | 200 |
| PUT | `/api/tasks/:id` | [tasks.ts:764](../../server/tasks.ts#L764) | signed-in |  | task-writable | body: status, services, assigneeIds, assigneeUserIds | task_board_links, tasks | 200 |
| DELETE | `/api/tasks/:id/card` | [tasks.ts:845](../../server/tasks.ts#L845) | signed-in |  | task-writable |  | task_board_links | 200 |
| POST | `/api/tasks/:id/card` | [tasks.ts:811](../../server/tasks.ts#L811) | signed-in |  | task-writable | body: cardId, listId | task_board_links, tasks, task_assignees, board_cards, card_members | 201 |
| POST | `/api/tasks/:id/comments` | [tasks.ts:897](../../server/tasks.ts#L897) | signed-in |  |  | body: text, replyToId | tasks, task_comments, task_board_links, board_cards, card_comments, task_activity | 201 |
| POST | `/api/tasks/:id/flow` | [tasks.ts:851](../../server/tasks.ts#L851) | signed-in |  |  | body: action | tasks, task_board_links | 200 |
| POST | `/api/tasks/bulk-delete` | [tasks.ts:797](../../server/tasks.ts#L797) | signed-in |  |  | body: ids | tasks | 200 |
| DELETE | `/api/tasks/comments/:id` | [tasks.ts:931](../../server/tasks.ts#L931) | signed-in |  | admin-role-check, 403-path |  | task_comments, card_comments | 200 |
| PUT | `/api/tasks/comments/:id` | [tasks.ts:919](../../server/tasks.ts#L919) | signed-in |  | admin-role-check, 403-path | body: text | task_comments, card_comments | 200 |
| POST | `/api/tasks/import` | [tasks.ts:861](../../server/tasks.ts#L861) | signed-in |  | admin-role-check, 403-path |  | users | 200 |
| GET | `/api/tasks/imports/:id/sheet` | [tasks.ts:674](../../server/tasks.ts#L674) | signed-in |  | admin-role-check, 403-path | query: page | task_imports, task_import_sheets, task_import_sheet_parts, tasks | 200 |
| POST | `/api/tasks/master` | [tasks.ts:543](../../server/tasks.ts#L543) | signed-in |  | admin-role-check, 403-path | body: projectId, keys, campaignId, assigneeIds, assigneeUserIds, startAt, dueAt | task_projects, tasks | 200 |
| GET | `/api/tasks/meta` | [tasks.ts:625](../../server/tasks.ts#L625) | signed-in |  |  |  | task_projects, task_assignees, tasks, task_people, users, customers, task_campaigns, team_roles, team_members, teams, task_labels, task_imports, task_import_sheets | 200 |
| POST | `/api/tasks/sync-board` | [tasks.ts:565](../../server/tasks.ts#L565) | signed-in |  | admin-role-check, 403-path |  |  | 200 |

## Board, workspace, thẻ (61)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| DELETE | `/api/attachments/:id` | [boards.ts:1281](../../server/boards.ts#L1281) | signed-in |  |  |  | card_attachments | 200 |
| GET | `/api/boards` | [boards.ts:567](../../server/boards.ts#L567) | signed-in |  | customer-level, admin-role-check, 403-path | body: id, customer_id, pos, created_by, cards | board_stars, board_cards, boards, customers, users, board_members, team_roles | 200 |
| POST | `/api/boards` | [boards.ts:599](../../server/boards.ts#L599) | signed-in |  | 403-path | body: roleId, workspaceId, customerId, services, name, bg, lists, private, view, startAt, id | boards | 201 |
| GET | `/api/boards-customers` | [boards.ts:1518](../../server/boards.ts#L1518) | signed-in |  |  |  | customers | 200 |
| GET | `/api/boards-search` | [boards.ts:1597](../../server/boards.ts#L1597) | signed-in |  |  | body: level, id, name, description; query: q | board_cards, board_lists | 200 |
| DELETE | `/api/boards/:id` | [boards.ts:671](../../server/boards.ts#L671) | signed-in |  | board:admin | body: id |  | 200 |
| GET | `/api/boards/:id` | [boards.ts:616](../../server/boards.ts#L616) | signed-in |  | board:viewer | body: id, task_count, about | board_labels, board_lists, board_cards, board_stars | 200 |
| PUT | `/api/boards/:id` | [boards.ts:637](../../server/boards.ts#L637) | signed-in |  | customer-level, 403-path | body: startAt, services, memberEdit, editorShare, customerId, roleId, private, workspaceId, view, name, bg, about, labelText | boards, customers | 200 |
| GET | `/api/boards/:id/activity` | [boards.ts:759](../../server/boards.ts#L759) | signed-in |  | board:viewer | body: id |  | 200 |
| GET | `/api/boards/:id/archived` | [boards.ts:760](../../server/boards.ts#L760) | signed-in |  | board:viewer | body: id | board_lists | 200 |
| PUT | `/api/boards/:id/background` | [boards.ts:683](../../server/boards.ts#L683) | signed-in |  |  | body: id | boards | 200 |
| POST | `/api/boards/:id/labels` | [boards.ts:769](../../server/boards.ts#L769) | signed-in |  |  | body: id | board_labels | 201 |
| POST | `/api/boards/:id/lists` | [boards.ts:793](../../server/boards.ts#L793) | signed-in |  |  | body: id | board_lists | 201 |
| GET | `/api/boards/:id/members` | [boards.ts:691](../../server/boards.ts#L691) | signed-in |  | board:viewer, 403-path | body: level |  | 200 |
| DELETE | `/api/boards/:id/members/:userId` | [boards.ts:719](../../server/boards.ts#L719) | signed-in |  |  | body: created_by, id | board_members, card_members, board_cards | 200 |
| PUT | `/api/boards/:id/members/:userId` | [boards.ts:703](../../server/boards.ts#L703) | signed-in |  | board:admin | body: created_by, id, name | users, board_members | 200 |
| PUT | `/api/boards/:id/star` | [boards.ts:676](../../server/boards.ts#L676) | signed-in |  | board:viewer | body: id | board_stars | 200 |
| POST | `/api/boards/:id/transfer-owner` | [boards.ts:733](../../server/boards.ts#L733) | signed-in |  | board:admin, admin-role-check, 403-path | body: created_by, level, id, name | users, board_members, boards | 200 |
| DELETE | `/api/cards/:id` | [boards.ts:1091](../../server/boards.ts#L1091) | signed-in |  |  |  |  | 200 |
| GET | `/api/cards/:id` | [boards.ts:968](../../server/boards.ts#L968) | signed-in |  |  |  |  | 200 |
| PUT | `/api/cards/:id` | [boards.ts:971](../../server/boards.ts#L971) | signed-in |  | customer-level, project-level, 403-path | body: title, description, result, startAt, dueAt, done, cover, customerId, projectId, linkTask, archived, listId, index | customers, task_projects, task_board_links, tasks, task_people, board_lists, board_cards, task_assignees, task_followers, card_members | 200 |
| POST | `/api/cards/:id/attachments` | [boards.ts:1270](../../server/boards.ts#L1270) | signed-in |  |  | body: url, name | card_attachments | 201 |
| POST | `/api/cards/:id/checklists` | [boards.ts:1195](../../server/boards.ts#L1195) | signed-in |  |  |  | card_checklists | 201 |
| POST | `/api/cards/:id/comments` | [boards.ts:1240](../../server/boards.ts#L1240) | signed-in |  |  | body: text, replyToId | card_comments, card_members | 201 |
| POST | `/api/cards/:id/copy` | [boards.ts:1119](../../server/boards.ts#L1119) | signed-in |  |  |  | board_cards, card_labels, card_checklists, checklist_items | 201 |
| POST | `/api/cards/:id/files` | [boards.ts:1288](../../server/boards.ts#L1288) | signed-in |  | admin-role-check, 403-path |  | card_attachments, inbox_cards | 201 |
| PUT | `/api/cards/:id/labels` | [boards.ts:1135](../../server/boards.ts#L1135) | signed-in |  |  | body: labelId, on | board_labels, card_labels | 200 |
| PUT | `/api/cards/:id/members` | [boards.ts:1144](../../server/boards.ts#L1144) | signed-in |  |  | body: userId, on | boards, task_board_links, users, tasks, board_members, card_members, task_assignees, task_people | 200 |
| POST | `/api/cards/bulk-delete` | [boards.ts:1098](../../server/boards.ts#L1098) | signed-in |  | admin-role-check | body: ids | board_cards, boards | 200 |
| DELETE | `/api/checklists/:id` | [boards.ts:1208](../../server/boards.ts#L1208) | signed-in |  |  |  | checklist_items, card_checklists | 200 |
| PUT | `/api/checklists/:id` | [boards.ts:1202](../../server/boards.ts#L1202) | signed-in |  |  |  | card_checklists | 200 |
| POST | `/api/checklists/:id/items` | [boards.ts:1215](../../server/boards.ts#L1215) | signed-in |  |  |  | checklist_items | 201 |
| GET | `/api/client-work` | [boards.ts:1524](../../server/boards.ts#L1524) | signed-in |  |  | body: workspace_id, id, customer_id, name; query: workspace, all | board_cards, board_lists, boards, workspaces, customers, task_board_links, tasks, card_labels, board_labels, card_members, users, task_assignees, task_people, task_services, services | 200 |
| DELETE | `/api/comments/:id` | [boards.ts:1262](../../server/boards.ts#L1262) | signed-in |  | 403-path |  | card_comments | 200 |
| PUT | `/api/comments/:id` | [boards.ts:1252](../../server/boards.ts#L1252) | signed-in |  | 403-path |  | card_comments | 200 |
| GET | `/api/inbox` | [boards.ts:1314](../../server/boards.ts#L1314) | signed-in |  |  |  | inbox_cards | 200 |
| POST | `/api/inbox` | [boards.ts:1315](../../server/boards.ts#L1315) | signed-in |  |  | body: title, top | inbox_cards | 201 |
| DELETE | `/api/inbox/:id` | [boards.ts:1329](../../server/boards.ts#L1329) | signed-in |  |  |  | inbox_cards | 200 |
| PUT | `/api/inbox/:id` | [boards.ts:1322](../../server/boards.ts#L1322) | signed-in |  |  | body: title, done, index | inbox_cards | 200 |
| POST | `/api/inbox/:id/to-list` | [boards.ts:1334](../../server/boards.ts#L1334) | signed-in |  |  | body: listId, index | board_cards, inbox_cards, chat_reads | 201 |
| DELETE | `/api/items/:id` | [boards.ts:1233](../../server/boards.ts#L1233) | signed-in |  |  |  | checklist_items | 200 |
| PUT | `/api/items/:id` | [boards.ts:1223](../../server/boards.ts#L1223) | signed-in |  |  | body: text, done | checklist_items | 200 |
| DELETE | `/api/labels/:id` | [boards.ts:783](../../server/boards.ts#L783) | signed-in |  |  |  | board_labels, card_labels | 200 |
| PUT | `/api/labels/:id` | [boards.ts:775](../../server/boards.ts#L775) | signed-in |  |  |  | board_labels | 200 |
| DELETE | `/api/lists/:id` | [boards.ts:822](../../server/boards.ts#L822) | signed-in |  | 403-path |  | board_cards, board_lists | 200 |
| PUT | `/api/lists/:id` | [boards.ts:803](../../server/boards.ts#L803) | signed-in |  |  | body: folded, color, name, index, archived | board_lists, board_cards | 200 |
| POST | `/api/lists/:id/archive-cards` | [boards.ts:860](../../server/boards.ts#L860) | signed-in |  |  |  | board_cards | 200 |
| POST | `/api/lists/:id/cards` | [boards.ts:886](../../server/boards.ts#L886) | signed-in |  | project-level | body: title, kind, projectCardId, customerCardId, customerId, projectId, top, syncTask | board_cards, task_projects, customers, customer_members, boards, task_people, tasks, task_board_links | 201 |
| POST | `/api/lists/:id/copy` | [boards.ts:870](../../server/boards.ts#L870) | signed-in |  |  |  | board_lists, board_cards, card_labels | 201 |
| POST | `/api/lists/:id/move-cards` | [boards.ts:845](../../server/boards.ts#L845) | signed-in |  |  |  | board_cards | 200 |
| POST | `/api/lists/:id/sort` | [boards.ts:832](../../server/boards.ts#L832) | signed-in |  |  | body: created_at, title, due_at | board_cards | 200 |
| GET | `/api/planner` | [boards.ts:1501](../../server/boards.ts#L1501) | signed-in |  |  | body: id, level, name; query: from, to | board_cards, board_lists, card_members | 200 |
| GET | `/api/workspaces` | [boards.ts:448](../../server/boards.ts#L448) | signed-in |  |  |  | workspace_members, users, settings | 200 |
| POST | `/api/workspaces` | [boards.ts:461](../../server/boards.ts#L461) | signed-in |  |  | body: customerId, name, about, visibility | workspaces | 201 |
| DELETE | `/api/workspaces/:id` | [boards.ts:495](../../server/boards.ts#L495) | signed-in |  | admin-role-check, 403-path |  | workspace_members, settings, workspaces, users | 200 |
| PUT | `/api/workspaces/:id` | [boards.ts:467](../../server/boards.ts#L467) | signed-in |  | customer-level | body: customerId, name, about, visibility | workspaces | 200 |
| PUT | `/api/workspaces/:id/avatar` | [boards.ts:479](../../server/boards.ts#L479) | signed-in |  | admin-role-check, 403-path |  | settings | 200 |
| GET | `/api/workspaces/:id/members` | [boards.ts:512](../../server/boards.ts#L512) | signed-in |  |  |  |  | 200 |
| DELETE | `/api/workspaces/:id/members/:userId` | [boards.ts:529](../../server/boards.ts#L529) | signed-in |  |  |  | workspace_members | 200 |
| PUT | `/api/workspaces/:id/members/:userId` | [boards.ts:519](../../server/boards.ts#L519) | signed-in |  |  |  | users, workspace_members | 200 |
| POST | `/api/workspaces/:id/transfer-owner` | [boards.ts:536](../../server/boards.ts#L536) | signed-in |  | admin-role-check, 403-path |  | users, workspace_members, workspaces, board_members, boards | 200 |

## Danh mục dịch vụ và cấu hình (4)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/services` | [workspace.ts:915](../../server/workspace.ts#L915) | signed-in |  |  |  | services, service_categories | 200 |
| GET | `/api/settings/ads` | [ads.ts:132](../../server/ads.ts#L132) | signed-in |  |  |  |  | 200 |
| PUT | `/api/settings/ads` | [ads.ts:138](../../server/ads.ts#L138) | company-admin |  |  | body: metaVersion, metaToken |  | 200 |
| PUT | `/api/settings/editor-link` | [routes.ts:78](../../server/routes.ts#L78) | company-admin |  |  |  |  | 200 |

## Báo cáo và Meta Ads (24)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/ads/meta/accounts` | [ads.ts:123](../../server/ads.ts#L123) | signed-in | ads |  | query: fresh |  | 200 |
| GET | `/api/ads/meta/report` | [ads.ts:124](../../server/ads.ts#L124) | signed-in | ads | admin-role-check, 403-path | query: account, since, until, fresh |  | 200 |
| GET | `/api/ads/services` | [ads-summary.ts:26](../../server/ads-summary.ts#L26) | signed-in | ads |  |  |  | 200 |
| POST | `/api/ads/services` | [ads-summary.ts:27](../../server/ads-summary.ts#L27) | signed-in | ads |  |  | ads_services | 201 |
| DELETE | `/api/ads/services/:id` | [ads-summary.ts:38](../../server/ads-summary.ts#L38) | signed-in | ads |  |  | ads_services | 200 |
| PUT | `/api/ads/services/:id` | [ads-summary.ts:32](../../server/ads-summary.ts#L32) | signed-in | ads |  |  | ads_services | 200 |
| GET | `/api/ads/summary` | [ads-summary.ts:39](../../server/ads-summary.ts#L39) | signed-in | ads |  | query: until, fresh |  | 200 |
| GET | `/api/reports` | [reports.ts:614](../../server/reports.ts#L614) | signed-in | editor/ads |  | query: customer, project | reports, customers | 200 |
| POST | `/api/reports` | [reports.ts:627](../../server/reports.ts#L627) | signed-in | editor/ads | customer-level, admin-role-check, 403-path | body: meta, projectId, customerId | projects, customers, reports | 201 |
| DELETE | `/api/reports/:id` | [reports.ts:681](../../server/reports.ts#L681) | signed-in | editor/ads |  |  | reports, report_images | 200 |
| GET | `/api/reports/:id` | [reports.ts:654](../../server/reports.ts#L654) | signed-in | editor/ads |  |  |  | 200 |
| PUT | `/api/reports/:id` | [reports.ts:655](../../server/reports.ts#L655) | signed-in | editor/ads |  | body: title, data | reports | 200 |
| POST | `/api/reports/:id/autofill` | [reports.ts:661](../../server/reports.ts#L661) | signed-in | editor/ads | admin-role-check |  | reports | 200 |
| GET | `/api/reports/:id/drive-browse` | [reports.ts:730](../../server/reports.ts#L730) | signed-in | editor/ads |  | body: name, modifiedTime |  | 200 |
| GET | `/api/reports/:id/html` | [reports.ts:804](../../server/reports.ts#L804) | signed-in | editor/ads |  | query: download | report_images |  |
| POST | `/api/reports/:id/images` | [reports.ts:787](../../server/reports.ts#L787) | signed-in | editor/ads |  |  |  | 201 |
| GET | `/api/reports/:id/images/:file` | [reports.ts:794](../../server/reports.ts#L794) | signed-in | editor/ads |  |  | report_images |  |
| POST | `/api/reports/:id/link-videos` | [reports.ts:749](../../server/reports.ts#L749) | signed-in | editor/ads |  | body: videos, targetIndex | reports | 200 |
| POST | `/api/reports/:id/meta` | [reports.ts:697](../../server/reports.ts#L697) | signed-in | editor/ads | admin-role-check, 403-path | body: since, until, account | reports | 200 |
| POST | `/api/reports/:id/share-videos` | [reports.ts:776](../../server/reports.ts#L776) | signed-in | editor/ads |  |  |  | 200 |
| GET | `/api/reports/:id/video-library` | [reports.ts:710](../../server/reports.ts#L710) | signed-in | editor/ads |  | query: q, folder |  | 200 |
| GET | `/api/reports/:id/video-thumbnail/:file` | [reports.ts:743](../../server/reports.ts#L743) | signed-in | editor/ads |  | query: account |  |  |
| POST | `/api/reports/:id/videos` | [reports.ts:688](../../server/reports.ts#L688) | signed-in | editor/ads |  |  | reports | 200 |
| GET | `/api/reports/customers` | [reports.ts:610](../../server/reports.ts#L610) | signed-in | editor/ads |  |  | customers | 200 |

## Trình dựng video (Mac) (23)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/editor-link` | [routes.ts:74](../../server/routes.ts#L74) | signed-in | editor |  |  |  | 200 |
| GET | `/api/health` | [routes.ts:61](../../server/routes.ts#L61) | public |  |  |  |  | 200 |
| GET | `/api/projects` | [routes.ts:92](../../server/routes.ts#L92) | signed-in | editor |  |  | customers, projects | 200 |
| POST | `/api/projects` | [routes.ts:100](../../server/routes.ts#L100) | signed-in | editor | customer-level | body: customerId, title, aspect, sources, sheet | customers, projects | 201 |
| DELETE | `/api/projects/:id` | [routes.ts:160](../../server/routes.ts#L160) | signed-in | editor |  |  | assets, projects, renders, jobs | 200 |
| GET | `/api/projects/:id` | [routes.ts:110](../../server/routes.ts#L110) | signed-in | editor |  |  |  | 200 |
| PUT | `/api/projects/:id` | [routes.ts:111](../../server/routes.ts#L111) | signed-in | editor | customer-level | body: sources, sheet, status, note, customerId, title, aspect | customers, projects | 200 |
| POST | `/api/projects/:id/customer/auto` | [routes.ts:150](../../server/routes.ts#L150) | signed-in | editor |  |  |  | 200 |
| POST | `/api/projects/:id/drive` | [routes.ts:133](../../server/routes.ts#L133) | signed-in | editor |  |  | projects | 200 |
| POST | `/api/projects/:id/duplicate` | [routes.ts:154](../../server/routes.ts#L154) | signed-in | editor |  |  | projects | 201 |
| GET | `/api/projects/:id/hyperframes` | [hyperframes.ts:124](../../server/hyperframes.ts#L124) | signed-in | editor |  |  |  | 200 |
| POST | `/api/projects/:id/hyperframes/prepare` | [hyperframes.ts:125](../../server/hyperframes.ts#L125) | signed-in | editor |  | body: sources |  | 200 |
| POST | `/api/projects/:id/hyperframes/preview` | [hyperframes.ts:130](../../server/hyperframes.ts#L130) | signed-in | editor |  |  |  | 200 |
| POST | `/api/projects/:id/hyperframes/publish` | [hyperframes.ts:136](../../server/hyperframes.ts#L136) | signed-in | editor |  |  |  | 201 |
| GET | `/api/projects/:id/renders` | [routes.ts:180](../../server/routes.ts#L180) | signed-in | editor |  |  | renders, assets | 200 |
| DELETE | `/api/renders/:id` | [routes.ts:191](../../server/routes.ts#L191) | signed-in | editor |  |  | renders, assets | 200 |
| GET | `/api/renders/:id/download` | [routes.ts:185](../../server/routes.ts#L185) | signed-in | editor |  |  | renders, assets, projects |  |
| GET | `/api/sheets/progress/:token` | [sheets.ts:367](../../server/sheets.ts#L367) | signed-in | editor |  |  |  | 200 |
| POST | `/api/sheets/read` | [sheets.ts:355](../../server/sheets.ts#L355) | signed-in | editor |  |  |  | 200 |
| POST | `/api/sheets/tabs` | [sheets.ts:362](../../server/sheets.ts#L362) | signed-in | editor |  |  |  | 200 |
| GET | `/api/sources/:id` | [sources.ts:127](../../server/sources.ts#L127) | signed-in | editor |  | query: a, sig |  |  |
| GET | `/api/sources/:id/thumb` | [sources.ts:132](../../server/sources.ts#L132) | signed-in | editor |  | query: a, sig |  |  |
| POST | `/api/sources/scan` | [sources.ts:126](../../server/sources.ts#L126) | signed-in | editor |  |  |  | 200 |

## Thông báo, chat, ghi chú, hỗ trợ, tìm kiếm (26)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/chat/members` | [boards.ts:1484](../../server/boards.ts#L1484) | signed-in |  |  |  | users, chat_messages | 200 |
| DELETE | `/api/chat/messages` | [boards.ts:1466](../../server/boards.ts#L1466) | signed-in |  | admin-role-check, 403-path | query: channel, recipientId | chat_messages | 200 |
| GET | `/api/chat/messages` | [boards.ts:1349](../../server/boards.ts#L1349) | signed-in |  |  | query: channel, recipientId, since | chat_messages, users | 200 |
| POST | `/api/chat/messages` | [boards.ts:1432](../../server/boards.ts#L1432) | signed-in |  |  | body: message, channel, recipientId | chat_messages | 201 |
| DELETE | `/api/chat/messages/:id` | [boards.ts:1457](../../server/boards.ts#L1457) | signed-in |  | admin-role-check, 403-path |  | chat_messages | 200 |
| GET | `/api/chat/unread` | [boards.ts:1392](../../server/boards.ts#L1392) | signed-in |  |  | query: since | users, chat_reads, chat_messages | 200 |
| GET | `/api/notifications` | [notifications.ts:97](../../server/notifications.ts#L97) | signed-in |  | admin-role-check |  | notification_preferences, mail_outbox | 200 |
| PUT | `/api/notifications` | [notifications.ts:105](../../server/notifications.ts#L105) | signed-in |  |  |  | notification_preferences, mail_outbox | 200 |
| DELETE | `/api/notifications/email` | [notifications.ts:143](../../server/notifications.ts#L143) | signed-in |  |  |  | notification_preferences, mail_outbox | 200 |
| POST | `/api/notifications/email/request` | [notifications.ts:119](../../server/notifications.ts#L119) | signed-in |  |  |  | notification_preferences | 200 |
| POST | `/api/notifications/email/verify` | [notifications.ts:134](../../server/notifications.ts#L134) | signed-in |  |  |  | notification_preferences | 200 |
| GET | `/api/notifications/inbox` | [notifications.ts:159](../../server/notifications.ts#L159) | signed-in |  |  |  | notifications, tasks, task_projects, board_cards | 200 |
| GET | `/api/notifications/latest` | [notifications.ts:158](../../server/notifications.ts#L158) | signed-in |  |  |  | notifications | 200 |
| DELETE | `/api/notifications/mail` | [notifications.ts:118](../../server/notifications.ts#L118) | signed-in |  |  |  |  | 200 |
| GET | `/api/notifications/mail/connect` | [notifications.ts:113](../../server/notifications.ts#L113) | signed-in |  |  |  |  |  |
| POST | `/api/notifications/read` | [notifications.ts:175](../../server/notifications.ts#L175) | signed-in |  |  |  | notifications | 200 |
| POST | `/api/notifications/test` | [notifications.ts:147](../../server/notifications.ts#L147) | signed-in |  |  |  | notification_preferences, mail_outbox | 200 |
| GET | `/api/quick-notes` | [quick-notes.ts:25](../../server/quick-notes.ts#L25) | signed-in |  |  | query: q | quick_notes | 200 |
| POST | `/api/quick-notes` | [quick-notes.ts:34](../../server/quick-notes.ts#L34) | signed-in |  |  | body: color, x, y, w, h | quick_notes | 201 |
| DELETE | `/api/quick-notes/:id` | [quick-notes.ts:64](../../server/quick-notes.ts#L64) | signed-in |  |  |  | quick_notes | 200 |
| GET | `/api/quick-notes/:id` | [quick-notes.ts:33](../../server/quick-notes.ts#L33) | signed-in |  |  |  |  | 200 |
| PUT | `/api/quick-notes/:id` | [quick-notes.ts:54](../../server/quick-notes.ts#L54) | signed-in |  |  | body: body, color, open, x, y, w, h | quick_notes | 200 |
| POST | `/api/quick-notes/delete` | [quick-notes.ts:70](../../server/quick-notes.ts#L70) | signed-in |  |  | body: ids | quick_notes | 200 |
| PUT | `/api/quick-notes/order` | [quick-notes.ts:43](../../server/quick-notes.ts#L43) | signed-in |  |  | body: ids | quick_notes | 200 |
| GET | `/api/search` | [search.ts:27](../../server/search.ts#L27) | signed-in |  |  | body: id, created_by, title, updatedAt; query: q, type | users, team_roles, dept_roles, task_board_links, board_cards, boards, board_members, tasks, customers, task_projects, quick_notes | 200 |
| POST | `/api/support` | [support.ts:26](../../server/support.ts#L26) | signed-in |  |  | body: message, images | support_tickets | 201 |

## Quản trị (/api/admin) (115)

| Method | Path | Code | Guard | Trang | Kiểm tra trong handler | Input / Query | Bảng | Status |
|---|---|---|---|---|---|---|---|---|
| GET | `/api/admin/admins` | [admin/roles.ts:113](../../server/admin/roles.ts#L113) | signed-in |  | perm:rbac.view | body: rank, name | user_roles, users | 200 |
| GET | `/api/admin/assignments` | [admin/roles.ts:103](../../server/admin/roles.ts#L103) | signed-in |  | perm:rbac.view |  |  | 200 |
| GET | `/api/admin/backups` | [admin/system.ts:543](../../server/admin/system.ts#L543) | signed-in |  | perm:settings.view | body: at |  | 200 |
| POST | `/api/admin/backups` | [admin/system.ts:551](../../server/admin/system.ts#L551) | signed-in |  | perm:settings.update |  |  | 201 |
| GET | `/api/admin/backups/:name` | [admin/system.ts:562](../../server/admin/system.ts#L562) | signed-in |  | perm:settings.update |  |  |  |
| GET | `/api/admin/customer-categories` | [admin/customers.ts:181](../../server/admin/customers.ts#L181) | signed-in |  | perm:customers.view, via registerDict (server/admin/common.ts:141) |  | customer_categories |  |
| POST | `/api/admin/customer-categories` | [admin/customers.ts:181](../../server/admin/customers.ts#L181) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_categories |  |
| DELETE | `/api/admin/customer-categories/:id` | [admin/customers.ts:181](../../server/admin/customers.ts#L181) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_categories |  |
| PUT | `/api/admin/customer-categories/:id` | [admin/customers.ts:181](../../server/admin/customers.ts#L181) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_categories |  |
| POST | `/api/admin/customer-categories/order` | [admin/customers.ts:181](../../server/admin/customers.ts#L181) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_categories |  |
| GET | `/api/admin/customer-sources` | [admin/customers.ts:182](../../server/admin/customers.ts#L182) | signed-in |  | perm:customers.view, via registerDict (server/admin/common.ts:141) |  | customer_sources |  |
| POST | `/api/admin/customer-sources` | [admin/customers.ts:182](../../server/admin/customers.ts#L182) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_sources |  |
| DELETE | `/api/admin/customer-sources/:id` | [admin/customers.ts:182](../../server/admin/customers.ts#L182) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_sources |  |
| PUT | `/api/admin/customer-sources/:id` | [admin/customers.ts:182](../../server/admin/customers.ts#L182) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_sources |  |
| POST | `/api/admin/customer-sources/order` | [admin/customers.ts:182](../../server/admin/customers.ts#L182) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_sources |  |
| GET | `/api/admin/customer-statuses` | [admin/customers.ts:180](../../server/admin/customers.ts#L180) | signed-in |  | perm:customers.view, via registerDict (server/admin/common.ts:141) |  | customer_statuses |  |
| POST | `/api/admin/customer-statuses` | [admin/customers.ts:180](../../server/admin/customers.ts#L180) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_statuses |  |
| DELETE | `/api/admin/customer-statuses/:id` | [admin/customers.ts:180](../../server/admin/customers.ts#L180) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_statuses |  |
| PUT | `/api/admin/customer-statuses/:id` | [admin/customers.ts:180](../../server/admin/customers.ts#L180) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_statuses |  |
| POST | `/api/admin/customer-statuses/order` | [admin/customers.ts:180](../../server/admin/customers.ts#L180) | signed-in |  | perm:customers.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | customer_statuses |  |
| GET | `/api/admin/customers` | [admin/customers.ts:92](../../server/admin/customers.ts#L92) | signed-in |  | perm:customers.view |  |  | 200 |
| POST | `/api/admin/customers` | [admin/customers.ts:116](../../server/admin/customers.ts#L116) | signed-in |  | perm:customers.create | body: managerId | customers, customer_tags | 201 |
| DELETE | `/api/admin/customers/:id` | [admin/customers.ts:160](../../server/admin/customers.ts#L160) | signed-in |  | perm:customers.delete |  |  | 200 |
| GET | `/api/admin/customers/:id` | [admin/customers.ts:105](../../server/admin/customers.ts#L105) | signed-in |  | perm:customers.view |  | customers, customer_members, users | 200 |
| PUT | `/api/admin/customers/:id` | [admin/customers.ts:126](../../server/admin/customers.ts#L126) | signed-in |  | perm:customers.update | body: managerId, categoryId | customers, customer_tags | 200 |
| POST | `/api/admin/customers/:id/archive` | [admin/customers.ts:141](../../server/admin/customers.ts#L141) | signed-in |  | perm:customers.delete |  | customers, projects, task_projects, reports, board_cards, boards, card_attachments, customer_tags, customer_needs, customer_members | 200 |
| POST | `/api/admin/customers/bulk-delete` | [admin/customers.ts:165](../../server/admin/customers.ts#L165) | signed-in |  | perm:customers.delete | body: ids |  | 200 |
| GET | `/api/admin/customers/export` | [admin/customers.ts:98](../../server/admin/customers.ts#L98) | signed-in |  | perm:customers.export, perm:customers.view | body: name |  |  |
| GET | `/api/admin/departments` | [admin/staff.ts:215](../../server/admin/staff.ts#L215) | signed-in |  | perm:org.view | body: role_id, name, about, color, departmentId | users, dept_roles, teams, boards, team_roles, team_members | 200 |
| GET | `/api/admin/hosting` | [admin/hosting.ts:144](../../server/admin/hosting.ts#L144) | signed-in |  | perm:settings.view |  |  | 200 |
| GET | `/api/admin/logs` | [admin/logs.ts:55](../../server/admin/logs.ts#L55) | signed-in |  | perm:logs.view | query: q |  | 200 |
| GET | `/api/admin/logs/export` | [admin/logs.ts:71](../../server/admin/logs.ts#L71) | signed-in |  | perm:logs.export, perm:logs.view | query: q |  |  |
| GET | `/api/admin/mail-log` | [admin/notify.ts:79](../../server/admin/notify.ts#L79) | signed-in |  | perm:notifications.view | body: title, test, name, id, body, link; query: state, q | mail_outbox, users, notification_templates | 200 |
| GET | `/api/admin/notification-templates` | [admin/notify.ts:102](../../server/admin/notify.ts#L102) | signed-in |  | perm:notifications.view |  |  | 200 |
| POST | `/api/admin/notification-templates` | [admin/notify.ts:103](../../server/admin/notify.ts#L103) | signed-in |  | perm:notifications.manage |  | notification_templates | 201 |
| DELETE | `/api/admin/notification-templates/:id` | [admin/notify.ts:115](../../server/admin/notify.ts#L115) | signed-in |  | perm:notifications.manage |  | notification_templates | 200 |
| PUT | `/api/admin/notification-templates/:id` | [admin/notify.ts:109](../../server/admin/notify.ts#L109) | signed-in |  | perm:notifications.manage |  | notification_templates | 200 |
| GET | `/api/admin/notifications` | [admin/notify.ts:62](../../server/admin/notify.ts#L62) | signed-in |  | perm:notifications.view | query: q | notifications, notification_logs, users | 200 |
| POST | `/api/admin/notifications` | [admin/notify.ts:37](../../server/admin/notify.ts#L37) | signed-in |  | perm:notifications.create, 403-path | body: title, body, link, audience, templateId | notifications, notification_preferences, mail_outbox, notification_logs | 201 |
| GET | `/api/admin/notifications/:id` | [admin/notify.ts:70](../../server/admin/notify.ts#L70) | signed-in |  | perm:notifications.view |  | notification_logs, users, notifications | 200 |
| GET | `/api/admin/permissions` | [admin/roles.ts:51](../../server/admin/roles.ts#L51) | signed-in |  | perm:rbac.view |  | role_permissions, roles | 200 |
| GET | `/api/admin/roles` | [admin/roles.ts:59](../../server/admin/roles.ts#L59) | signed-in |  | perm:rbac.view |  | roles | 200 |
| POST | `/api/admin/roles` | [admin/roles.ts:63](../../server/admin/roles.ts#L63) | signed-in |  | perm:rbac.manage | body: name, rank, perms, about | roles | 201 |
| DELETE | `/api/admin/roles/:id` | [admin/roles.ts:88](../../server/admin/roles.ts#L88) | signed-in |  | perm:rbac.manage, 403-path |  | user_roles, users, roles | 200 |
| PUT | `/api/admin/roles/:id` | [admin/roles.ts:73](../../server/admin/roles.ts#L73) | signed-in |  | perm:rbac.manage, 403-path | body: name, rank, about, perms | roles | 200 |
| GET | `/api/admin/service-categories` | [admin/services.ts:125](../../server/admin/services.ts#L125) | signed-in |  | perm:services.view, via registerDict (server/admin/common.ts:141) |  | service_categories |  |
| POST | `/api/admin/service-categories` | [admin/services.ts:125](../../server/admin/services.ts#L125) | signed-in |  | perm:services.update, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | service_categories |  |
| DELETE | `/api/admin/service-categories/:id` | [admin/services.ts:125](../../server/admin/services.ts#L125) | signed-in |  | perm:services.update, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | service_categories |  |
| PUT | `/api/admin/service-categories/:id` | [admin/services.ts:125](../../server/admin/services.ts#L125) | signed-in |  | perm:services.update, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | service_categories |  |
| POST | `/api/admin/service-categories/order` | [admin/services.ts:125](../../server/admin/services.ts#L125) | signed-in |  | perm:services.update, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | service_categories |  |
| GET | `/api/admin/service-packages` | [admin/services.ts:96](../../server/admin/services.ts#L96) | signed-in |  | perm:services.view |  |  | 200 |
| POST | `/api/admin/service-packages` | [admin/services.ts:100](../../server/admin/services.ts#L100) | signed-in |  | perm:services.create |  | service_packages | 201 |
| DELETE | `/api/admin/service-packages/:id` | [admin/services.ts:118](../../server/admin/services.ts#L118) | signed-in |  | perm:services.delete |  | service_packages | 200 |
| PUT | `/api/admin/service-packages/:id` | [admin/services.ts:109](../../server/admin/services.ts#L109) | signed-in |  | perm:services.update |  | service_packages | 200 |
| GET | `/api/admin/services` | [admin/services.ts:61](../../server/admin/services.ts#L61) | signed-in |  | perm:services.view |  |  | 200 |
| POST | `/api/admin/services` | [admin/services.ts:70](../../server/admin/services.ts#L70) | signed-in |  | perm:services.create |  | services | 201 |
| DELETE | `/api/admin/services/:id` | [admin/services.ts:89](../../server/admin/services.ts#L89) | signed-in |  | perm:services.delete |  | services | 200 |
| PUT | `/api/admin/services/:id` | [admin/services.ts:78](../../server/admin/services.ts#L78) | signed-in |  | perm:services.update |  | services, project_services | 200 |
| GET | `/api/admin/settings` | [admin/system.ts:38](../../server/admin/system.ts#L38) | signed-in |  | perm:settings.view |  |  | 200 |
| PUT | `/api/admin/settings` | [admin/system.ts:43](../../server/admin/system.ts#L43) | signed-in |  | perm:settings.update | body: logRetentionDays, siteUrl, taskWorkspaceAuto |  | 200 |
| GET | `/api/admin/site-lock` | [admin/system.ts:63](../../server/admin/system.ts#L63) | signed-in |  | perm:settings.view |  |  | 200 |
| PUT | `/api/admin/site-lock` | [admin/system.ts:67](../../server/admin/system.ts#L67) | signed-in |  | perm:settings.update, admin-role-check, 403-path | body: message, on |  | 200 |
| POST | `/api/admin/sql` | [admin/hosting.ts:152](../../server/admin/hosting.ts#L152) | signed-in |  | perm:settings.update | body: sql, allowWrite, database |  | 200 |
| GET | `/api/admin/staff` | [admin/staff.ts:91](../../server/admin/staff.ts#L91) | signed-in |  | perm:staff.view |  |  | 200 |
| POST | `/api/admin/staff` | [admin/staff.ts:129](../../server/admin/staff.ts#L129) | signed-in |  | perm:staff.create, perm:org.update, 403-path | body: email, name, phone, departmentId, password, positionId, managerId, teamIds, notifyEmail | users | 201 |
| GET | `/api/admin/staff/:id` | [admin/staff.ts:111](../../server/admin/staff.ts#L111) | signed-in |  | perm:staff.view |  | login_logs, sessions, task_assignees, task_people, tasks, task_projects, audit_logs | 200 |
| PUT | `/api/admin/staff/:id` | [admin/staff.ts:145](../../server/admin/staff.ts#L145) | signed-in |  | perm:staff.update, perm:org.update | body: email, departmentId, positionId, name, phone, managerId, teamIds, password, notifyEmail | users, sessions | 200 |
| DELETE | `/api/admin/staff/:id/avatar` | [admin/staff.ts:197](../../server/admin/staff.ts#L197) | signed-in |  | perm:staff.update |  | user_avatars, users | 200 |
| PUT | `/api/admin/staff/:id/avatar` | [admin/staff.ts:186](../../server/admin/staff.ts#L186) | signed-in |  | perm:staff.update |  | user_avatars, users | 200 |
| POST | `/api/admin/staff/:id/lock` | [admin/staff.ts:169](../../server/admin/staff.ts#L169) | signed-in |  | perm:staff.delete | body: locked | users, sessions | 200 |
| PUT | `/api/admin/staff/:id/roles` | [admin/roles.ts:120](../../server/admin/roles.ts#L120) | signed-in |  | perm:rbac.manage, admin-role-check, 403-path | body: roles | users, user_roles, roles | 200 |
| POST | `/api/admin/staff/:id/signout` | [admin/staff.ts:178](../../server/admin/staff.ts#L178) | signed-in |  | perm:staff.delete |  | sessions | 200 |
| GET | `/api/admin/staff/export` | [admin/staff.ts:103](../../server/admin/staff.ts#L103) | signed-in |  | perm:staff.export, perm:staff.view | body: name |  |  |
| GET | `/api/admin/stats` | [admin/stats.ts:147](../../server/admin/stats.ts#L147) | signed-in |  | perm:stats.view |  |  | 200 |
| GET | `/api/admin/stats/export` | [admin/stats.ts:148](../../server/admin/stats.ts#L148) | signed-in |  | perm:stats.export, perm:stats.view |  |  |  |
| GET | `/api/admin/storage` | [admin/system.ts:77](../../server/admin/system.ts#L77) | signed-in |  | perm:settings.view | body: bytes | user_avatars, users, report_images, task_import_sheet_parts, task_import_sheets, card_attachments, assets, sessions, audit_logs, login_logs, notifications, task_imports, board_cards, tasks, card_comments, task_comments, chat_messages, customers, task_projects, workspaces, boards, quick_notes, renders | 200 |
| GET | `/api/admin/storage/check` | [admin/system.ts:458](../../server/admin/system.ts#L458) | signed-in |  | perm:settings.view |  | sessions, audit_logs, login_logs, notifications, task_import_sheet_parts, task_imports, board_cards | 200 |
| POST | `/api/admin/storage/clean` | [admin/system.ts:489](../../server/admin/system.ts#L489) | signed-in |  | perm:settings.update | body: days, cleanSessions, cleanLogs, cleanNotifications, cleanSheetParts, cleanArchivedCards, optimize | sessions, audit_logs, login_logs, notifications, task_import_sheet_parts, task_imports, board_cards | 200 |
| GET | `/api/admin/support` | [support.ts:46](../../server/support.ts#L46) | signed-in |  | perm:settings.view | query: status, q | support_tickets | 200 |
| DELETE | `/api/admin/support/:id` | [support.ts:96](../../server/support.ts#L96) | signed-in |  | perm:settings.view |  | support_tickets | 200 |
| PUT | `/api/admin/support/:id` | [support.ts:84](../../server/support.ts#L84) | signed-in |  | perm:settings.view | body: status | support_tickets | 200 |
| GET | `/api/admin/support/:id/images` | [support.ts:76](../../server/support.ts#L76) | signed-in |  | perm:settings.view |  | support_tickets | 200 |
| GET | `/api/admin/system` | [admin/system.ts:21](../../server/admin/system.ts#L21) | signed-in |  | perm:settings.view |  | users, team_roles, teams, roles, tasks, task_projects, customers, boards, board_cards, services, sessions, audit_logs, login_logs | 200 |
| GET | `/api/admin/task-flow` | [admin/work.ts:185](../../server/admin/work.ts#L185) | signed-in |  | perm:tasks.view |  |  | 200 |
| PUT | `/api/admin/task-flow` | [admin/work.ts:187](../../server/admin/work.ts#L187) | signed-in |  | perm:tasks.manage |  | task_statuses, tasks | 200 |
| POST | `/api/admin/task-flow/apply` | [admin/work.ts:205](../../server/admin/work.ts#L205) | signed-in |  | perm:tasks.manage |  |  | 200 |
| POST | `/api/admin/task-flow/boards` | [admin/work.ts:213](../../server/admin/work.ts#L213) | signed-in |  | perm:tasks.manage |  | task_label_links, task_labels | 200 |
| GET | `/api/admin/task-labels` | [admin/work.ts:224](../../server/admin/work.ts#L224) | signed-in |  | perm:tasks.view |  | task_labels | 200 |
| POST | `/api/admin/task-labels` | [admin/work.ts:229](../../server/admin/work.ts#L229) | signed-in |  | perm:tasks.manage | body: name, color | task_labels | 201 |
| DELETE | `/api/admin/task-labels/:id` | [admin/work.ts:247](../../server/admin/work.ts#L247) | signed-in |  | perm:tasks.manage | body: name, id, checklist, labels, status, dueDays, about, title, priorityId | task_label_links, task_labels, task_templates, users, task_statuses | 200 |
| PUT | `/api/admin/task-labels/:id` | [admin/work.ts:237](../../server/admin/work.ts#L237) | signed-in |  | perm:tasks.manage | body: name, color | task_labels | 200 |
| GET | `/api/admin/task-priorities` | [admin/work.ts:255](../../server/admin/work.ts#L255) | signed-in |  | perm:tasks.view, via registerDict (server/admin/common.ts:141) |  | task_priorities |  |
| POST | `/api/admin/task-priorities` | [admin/work.ts:255](../../server/admin/work.ts#L255) | signed-in |  | perm:tasks.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | task_priorities |  |
| DELETE | `/api/admin/task-priorities/:id` | [admin/work.ts:255](../../server/admin/work.ts#L255) | signed-in |  | perm:tasks.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | task_priorities |  |
| PUT | `/api/admin/task-priorities/:id` | [admin/work.ts:255](../../server/admin/work.ts#L255) | signed-in |  | perm:tasks.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | task_priorities |  |
| POST | `/api/admin/task-priorities/order` | [admin/work.ts:255](../../server/admin/work.ts#L255) | signed-in |  | perm:tasks.manage, via registerDict (server/admin/common.ts:141) | body: name, color, active, ids | task_priorities |  |
| GET | `/api/admin/task-statuses` | [admin/work.ts:108](../../server/admin/work.ts#L108) | signed-in |  | perm:tasks.view |  | task_statuses | 200 |
| POST | `/api/admin/task-statuses` | [admin/work.ts:116](../../server/admin/work.ts#L116) | signed-in |  | perm:tasks.manage | body: name, color | task_statuses | 201 |
| DELETE | `/api/admin/task-statuses/:id` | [admin/work.ts:143](../../server/admin/work.ts#L143) | signed-in |  | perm:tasks.manage |  | task_templates, task_statuses, tasks | 200 |
| PUT | `/api/admin/task-statuses/:id` | [admin/work.ts:125](../../server/admin/work.ts#L125) | signed-in |  | perm:tasks.manage | body: name, active, color | task_statuses, tasks, task_templates | 200 |
| POST | `/api/admin/task-statuses/clear-unlisted` | [admin/work.ts:159](../../server/admin/work.ts#L159) | signed-in |  | perm:tasks.manage | body: name | tasks, task_templates | 200 |
| POST | `/api/admin/task-statuses/order` | [admin/work.ts:169](../../server/admin/work.ts#L169) | signed-in |  | perm:tasks.manage | body: ids | task_statuses, tasks | 200 |
| GET | `/api/admin/task-templates` | [admin/work.ts:274](../../server/admin/work.ts#L274) | signed-in |  | perm:tasks.view |  |  | 200 |
| POST | `/api/admin/task-templates` | [admin/work.ts:275](../../server/admin/work.ts#L275) | signed-in |  | perm:tasks.manage |  | task_templates | 201 |
| DELETE | `/api/admin/task-templates/:id` | [admin/work.ts:289](../../server/admin/work.ts#L289) | signed-in |  | perm:tasks.manage |  | task_templates | 200 |
| PUT | `/api/admin/task-templates/:id` | [admin/work.ts:282](../../server/admin/work.ts#L282) | signed-in |  | perm:tasks.manage |  | task_templates | 200 |
| GET | `/api/admin/tasks` | [admin/work.ts:74](../../server/admin/work.ts#L74) | signed-in |  | perm:tasks.view |  |  | 200 |
| GET | `/api/admin/tasks/:id` | [admin/work.ts:85](../../server/admin/work.ts#L85) | signed-in |  | perm:tasks.view |  |  | 200 |
| PUT | `/api/admin/tasks/:id/priority` | [admin/work.ts:94](../../server/admin/work.ts#L94) | signed-in |  | perm:tasks.update |  | tasks, task_statuses | 200 |
| GET | `/api/admin/tasks/export` | [admin/work.ts:79](../../server/admin/work.ts#L79) | signed-in |  | perm:tasks.export, perm:tasks.view | body: dueAt |  |  |
| GET | `/api/admin/teams` | [admin/staff.ts:238](../../server/admin/staff.ts#L238) | signed-in |  | perm:org.view |  | teams | 200 |
| POST | `/api/admin/teams` | [admin/staff.ts:242](../../server/admin/staff.ts#L242) | signed-in |  | perm:org.create |  | teams | 201 |
| DELETE | `/api/admin/teams/:id` | [admin/staff.ts:255](../../server/admin/staff.ts#L255) | signed-in |  | perm:org.delete |  | teams | 200 |
| PUT | `/api/admin/teams/:id` | [admin/staff.ts:248](../../server/admin/staff.ts#L248) | signed-in |  | perm:org.update |  | teams | 200 |
| PUT | `/api/admin/teams/:id/members` | [admin/staff.ts:261](../../server/admin/staff.ts#L261) | signed-in |  | perm:org.update | body: userIds, leaderIds | team_members | 200 |

## API còn thiếu cho trợ lý AI

Xem [MCP_TOOL_REGISTRY.md](MCP_TOOL_REGISTRY.md#api-còn-thiếu): danh sách thao tác chưa có endpoint (hoặc chưa an toàn để gọi từ AI) và đề xuất.
