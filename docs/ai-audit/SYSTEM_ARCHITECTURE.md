# SYSTEM_ARCHITECTURE: DMI Workspace

> Audit ngày 14/11/2026, nhánh `feat/sheet-to-timeline-editor` (gồm thay đổi chưa commit). Mọi khẳng định có dẫn file. **[Hiện có]** là chức năng đang có trong code; **[Đề xuất]** chỉ có trong tài liệu này.

## 1. Tổng quan

DMI Workspace là ứng dụng làm việc nội bộ của Detailers Movement: board kiểu Trello, công việc theo quy trình duyệt (ACCOUNT › EXECUTION › REVIEW › COMPLETED), khách hàng (CRM và thư mục Google Drive), dịch vụ của khách, báo cáo và Meta Ads, thông báo, chat nội bộ, quản trị (RBAC), trình dựng video (chỉ trên Mac).

Một codebase TypeScript chạy ở **hai môi trường**:

| | Cloud (production) | Local (máy Mac) |
|---|---|---|
| Entry | [server/worker.ts](../../server/worker.ts) (Cloudflare Workers) | [server/index.ts](../../server/index.ts) (Node `http`) |
| Database | Cloudflare D1 `dmi-studio-db` | SQLite `data/studio.db` qua `node:sqlite` |
| File | Google Drive (`CLOUD_STORAGE_ONLY=1`) | Ổ đĩa (`data/assets`) và Google Drive |
| Trình dựng video | Không có (`editor: false`) | Có (cần ffmpeg, HyperFrames) |
| URL | https://dmi-workspace.detailersmovement.workers.dev | http://localhost:5173 |

## 2. Frontend [Hiện có]

- **React 19**, không framework định tuyến; đóng gói bằng **esbuild** ([scripts/build.mjs](../../scripts/build.mjs)) ra `web/dist`, phục vụ như SPA (Cloudflare `assets`, `not_found_handling: single-page-application`, [wrangler.jsonc](../../wrangler.jsonc)).
- **State**: một store tự viết dùng `useSyncExternalStore` ([web/src/store.ts](../../web/src/store.ts)); địa chỉ hash quyết định trang (`HASH`, `viewOfHash`).
- **Trang tải lười** ([web/src/pages.ts](../../web/src/pages.ts)); quyền vào trang lấy từ `/api/auth/me` (`pages`, `admin.perms`).
- **API client**: [web/src/api.ts](../../web/src/api.ts) (`req()` gửi JSON, cookie phiên).
- **i18n**: tiếng Việt là nguồn, bảng dịch tiếng Anh [web/src/i18n/en.ts](../../web/src/i18n/en.ts).
- **Thiết kế**: một file CSS [web/src/styles.css](../../web/src/styles.css) với token màu (`--tint`, `--surface`, `--sep`…), sáng/tối.
- Các bề mặt nổi đã có, có thể tái dùng cho trợ lý AI: Messenger nổi ([web/src/components/Messenger.tsx](../../web/src/components/Messenger.tsx)), Ghi chú nhanh, Tìm kiếm toàn cục, Có gì mới, hộp thoại xác nhận của app (`askConfirm`, [web/src/components/AskDialog.tsx](../../web/src/components/AskDialog.tsx)).

## 3. Backend [Hiện có]

- **Không framework**: router tự viết `Router` (`/path/:param`, [server/http.ts](../../server/http.ts)), handler kiểu Node `(req, res)`.
- **Một pipeline cho mọi request API** ([server/app.ts](../../server/app.ts) trên Worker, tương đương trong [server/index.ts](../../server/index.ts)):
  1. `guard(req)` ([server/auth.ts:150](../../server/auth.ts)): người đăng nhập, khoá site, đường dẫn công khai, quyền theo bản ghi (khách hàng, báo cáo, dịch vụ, công việc), quyền trang, admin công ty, vai trò chỉ-xem.
  2. `api.match()` chọn handler.
  3. `withTrail()` ([server/audit.ts:118](../../server/audit.ts)) ghi `audit_logs` cho mọi thay đổi (snapshot trước/sau cho các bản ghi được khai báo).
  4. Lỗi: `HttpError(status, message)` → `{ error }`; 5xx được ghi `logError`.
- Trên Worker, Node handler chạy qua `httpServerHandler` (`cloudflare:node`) với cờ `nodejs_compat` và `enable_nodejs_http_server_modules`.
- **Kiểm tra Origin** cho request không phải GET: Worker ([server/worker.ts](../../server/worker.ts)) và local (`trustedRequest`, [server/index.ts](../../server/index.ts)); ngoại lệ là các endpoint token của connector (`/api/mcp`, `/api/oauth/token`, `/api/oauth/register`).
- **Tác vụ định kỳ** (cron `* * * * *`, [server/worker.ts](../../server/worker.ts) `scheduled`): mỗi phút gửi hàng đợi email (`drainNotifications`); mỗi 10 phút `repairData`, `settleStages`, `projectsAsServices`, `normalizeAllBoards`, `remindTasks`.
- **Quy mô**: 382 route ([API_INVENTORY.md](API_INVENTORY.md)), 89 bảng ([DATABASE_MAPPING.md](DATABASE_MAPPING.md)).

## 4. Dữ liệu [Hiện có]

Chi tiết: [DATABASE_MAPPING.md](DATABASE_MAPPING.md). Không có ORM; SQL viết tay (`all/get/run`, [server/db.ts](../../server/db.ts)). Schema áp ở mỗi lần khởi động; cột mới thêm bằng danh sách nâng cấp có kiểm tra (`PRAGMA table_info`).

### Các thực thể chính (đúng tên trong code)

| Khái niệm nghiệp vụ | Bảng | Ghi chú |
|---|---|---|
| Khách hàng | `customers` (+ `customer_members`, `customer_statuses`, `customer_categories`, `customer_sources`, `customer_tags`, `customer_needs`, `customer_interactions`) | Có thư mục Drive (`gloc`), người phụ trách (`manager_id`), người tạo (`created_by`), lưu trữ (`archived_at`) |
| Dịch vụ của khách (trước đây "Dự án") | `task_projects` (+ `task_project_members`, `task_campaigns`, `project_services`) | Mỗi dịch vụ thuộc một khách; quyền `admin/normal/observer` ([server/project-access.ts](../../server/project-access.ts)) |
| Danh mục dịch vụ | `services`, `service_categories`, `service_packages`, `service_package_items` | Quản trị › Dịch vụ |
| Công việc | `tasks` (+ `task_assignees`, `task_people`, `task_followers`, `task_comments`, `task_activity`, `task_reviews`, `task_labels`, `task_label_links`, `task_services`, `task_board_links`) | Quy trình duyệt: `stage`, `reviewer_id`, `revision` ([shared/task-flow.ts](../../shared/task-flow.ts), [server/task-flow.ts](../../server/task-flow.ts)); một người được giao |
| Nhân viên | `users` (+ `team_roles` = phòng ban, `dept_roles` = vai trò trong phòng, `teams`/`team_members` = nhóm, `user_roles`/`roles`/`role_permissions` = RBAC) | `users.role` là `admin` hoặc `member`; `manager_id` là quản lý trực tiếp |
| Board | `boards`, `board_lists`, `board_cards`, `card_*`, `workspaces` | Thẻ có thể là một công việc (`task_board_links`) |
| Báo cáo | `reports`, `report_images`, `ads_services` | Meta Ads lấy trực tiếp từ Graph API |
| Dự án video (trình dựng) | `projects`, `assets`, `renders` | **Khác** với "Dự án/Dịch vụ" ở trên; chỉ dùng trên Mac |
| Connector Claude | `mcp_clients`, `mcp_codes`, `mcp_tokens` | Token lưu dạng hash |

> Lưu ý thuật ngữ: chữ "project" trong code có **hai nghĩa**. `task_projects` (route `/api/task-projects`) là dịch vụ của khách. `projects` (route `/api/projects`) là dự án video của trình dựng. Công cụ AI phải đặt tên rõ để không nhầm.

## 5. Xác thực và phân quyền [Hiện có]

Chi tiết và rủi ro: [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

- **Phiên**: cookie `dms_sid` (`HttpOnly; SameSite=Lax; Secure` khi https), 30 ngày, lưu hash SHA-256 trong `sessions` ([server/auth.ts:32-58](../../server/auth.ts)). Đăng nhập bằng mật khẩu (scrypt) hoặc Google; Turnstile tuỳ chọn; giới hạn đăng nhập sai (`throttle`, 15 phút).
- **Ba tầng quyền**:
  1. **Admin công ty** (`users.role = 'admin'`): danh sách `ADMIN` trong guard.
  2. **RBAC có phạm vi** cho Quản trị: 10 nhóm quyền × hành động, phạm vi `personal/team/department/organization` ([shared/permissions.ts](../../shared/permissions.ts), [server/rbac.ts](../../server/rbac.ts), `need(req, 'perm')` trong [server/admin/common.ts](../../server/admin/common.ts)). Vai trò mặc định: Super Admin, Admin, Manager, Leader, Member.
  3. **Quyền theo bản ghi**: khách hàng ([server/customer-access.ts](../../server/customer-access.ts)), dịch vụ ([server/project-access.ts](../../server/project-access.ts)), board (`mustBoard`, [server/boards.ts](../../server/boards.ts)), công việc (`writable`, `mine`, [server/tasks.ts](../../server/tasks.ts)), mức `admin/normal/observer`.
- **Quyền trang** (`PAGE_OF`): `workspace` (Drive khách), `editor`, `ads`; vai trò phòng ở mức `observer` chỉ được xem.

## 6. Tích hợp bên ngoài [Hiện có]

| Dịch vụ | Dùng cho | Code | Bí mật |
|---|---|---|---|
| Google OAuth, Drive, Sheets | Thư mục khách, footage, sheet yêu cầu, đăng nhập Google | [server/google.ts](../../server/google.ts) | `GOOGLE_CLIENT_ID/SECRET` (env hoặc bảng `settings`), refresh token trong `settings.google_accounts` |
| Gmail API | Gửi email thông báo | [server/google.ts](../../server/google.ts) `sendNotificationMail` | `settings.notification_mail` |
| Meta Graph API | Báo cáo quảng cáo | [server/ads.ts](../../server/ads.ts), [server/meta.ts](../../server/meta.ts) | `settings.ads_config.metaToken` |
| Cloudflare API | Trang Hosting và chạy SQL trên database khác (Super Admin) | [server/admin/hosting.ts](../../server/admin/hosting.ts) | `CF_API_TOKEN` |
| Cloudflare Turnstile | Chống bot khi đăng nhập | [server/turnstile.ts](../../server/turnstile.ts) | `TURNSTILE_SECRET_KEY` |
| HyperFrames CLI (local) | Dựng và render video trên Mac | [server/hyperframes.ts](../../server/hyperframes.ts) | Không |
| Claude (qua MCP) | Trợ lý AI chạy trong app Claude của người dùng | [server/mcp.ts](../../server/mcp.ts) | Không có API key: OAuth với tài khoản DMI |

App **không** gọi model AI nào (đã gỡ provider Claude CLI và các provider media ngày 14/11/2026).

## 7. Cấu hình và triển khai [Hiện có]

- Biến môi trường (22, đọc trong `server/`): `PUBLIC_URL`, `PORT`, `HOST`, `DATA_DIR`, `DRIVE_DIR`, `CLOUD_STORAGE_ONLY`, `DMS_RUNTIME`, `ALLOWED_HOSTS`, `SETUP_CODE`, `SITE_LOCKED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_REQUIRED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `META_GRAPH_URL`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`, `EDITOR_URL`, `FFMPEG_PATH`, `HYPERFRAMES_DIR`.
- Triển khai: `npm run cf:deploy` (wrangler); bí mật qua `npm run cf:secrets` ([DEPLOY.md](../../DEPLOY.md)).
- Kiểm thử: `node:test` qua tsx ([tests/](../../tests)), 87 test pass ngày 14/11/2026. `tests/worker.test.mjs` (Miniflare) **không chạy được trên máy dev hiện tại** (Node 26 với Miniflare beta, lỗi khởi động cả với code gốc).

## 8. Trợ lý AI hiện có [Hiện có, chưa commit một phần]

- **Connector MCP** `/api/mcp` (Streamable HTTP, JSON không stream) với OAuth 2.1: đăng ký động, PKCE S256, trang "Cho phép", access token 1 giờ, refresh token 60 ngày có xoay vòng ([server/mcp.ts](../../server/mcp.ts)).
- **Công cụ chạy như request của chính người dùng**: `callAs()` gọi lại pipeline API với người dùng gắn qua symbol `ACTING` ([server/auth.ts](../../server/auth.ts)), nên dùng chung guard, quyền, validate và nhật ký (user-agent `Claude (MCP)`).
- 12 công cụ công việc và khách hàng (cloud và Mac), 5 công cụ trình dựng (chỉ Mac). Xem [MCP_TOOL_REGISTRY.md](MCP_TOOL_REGISTRY.md).
- Trạng thái triển khai: bản cloud đang chạy phiên bản `085bb279` gồm connector và 12 công cụ công việc. Phần trình dựng, lọc footage trùng và dọn code cũ **chưa commit, chưa deploy**.
