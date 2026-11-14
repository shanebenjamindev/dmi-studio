# MCP_TOOL_REGISTRY: DMI MCP Server

> Audit ngày 14/11/2026. **[Hiện có]**: công cụ đã viết trong [server/mcp.ts](../../server/mcp.ts) và [server/video-mcp.ts](../../server/video-mcp.ts). **[Đề xuất]**: công cụ mới, **mỗi cái gọi một route đã có** trong [API_INVENTORY.md](API_INVENTORY.md) (trừ khi ghi "cần API mới").

## 1. Nguyên tắc chung (đã áp dụng cho công cụ hiện có)

1. **Không có logic nghiệp vụ riêng**: mỗi công cụ là một (hoặc vài) request API được gọi **như chính người đã kết nối** (`callAs`, [server/mcp.ts](../../server/mcp.ts)). Request đi qua đúng `guard()`, quyền theo bản ghi, validate của handler và `withTrail()`. Công cụ không bao giờ chạm database trực tiếp, trừ hai ngoại lệ có kiểm quyền trước, ghi ở mục 3.
2. **Lược đồ đầu vào chặt**: JSON Schema với `required` và `enum`; giá trị được chuẩn hoá trước khi gọi API (ngày ISO hoặc `YYYY-MM-DD` → mili giây, giờ Việt Nam, `when()` trong [server/mcp-kit.ts](../../server/mcp-kit.ts)); id được `encodeURIComponent` (`seg()`).
3. **Đầu ra gọn và ổn định**: chỉ trả các trường cần thiết (ví dụ `brief()` cho công việc), thời gian dạng `YYYY-MM-DD HH:mm` giờ Việt Nam.
4. **Lỗi**: lỗi nghiệp vụ trả `isError: true` kèm thông điệp tiếng Việt của API (403, 404, 409…); lỗi hệ thống trả câu chung, không lộ chi tiết.
5. **Nhật ký**: mọi thay đổi ghi `audit_logs` với tên người dùng, user-agent `Claude (MCP)`.
6. **Chú thích công cụ**: `readOnlyHint` cho công cụ đọc, `destructiveHint: false` cho công cụ ghi. Client Claude dựa vào đây để hỏi người dùng trước khi chạy công cụ ghi.
7. **Không có công cụ xoá, khoá tài khoản, phân quyền, cấu hình hệ thống, chạy SQL.**

## 2. Công cụ hiện có [Hiện có]

### 2.1 Công việc, khách hàng, nhân sự (cloud và Mac)

| Công cụ | Loại | Input (bắt buộc in đậm) | Gọi API | Quyền thực thi |
|---|---|---|---|---|
| `whoami` | đọc | (không) | `GET /api/auth/me` | đăng nhập |
| `search` | đọc | **query**, type | `GET /api/search` | lọc theo quyền của người dùng |
| `list_tasks` | đọc | scope (`mine/team/all`), relation, state, query, service_id, limit (≤200) | `GET /api/tasks` | `scope=team`: trưởng nhóm/trưởng phòng/admin; `all`: cần `service_id` có quyền |
| `get_task` | đọc | **task_id** | `GET /api/tasks/:id` | guard theo dịch vụ/khách/thẻ của công việc |
| `create_task` | ghi | **title**, service_id, description, due, start, assignee_user_id, reviewer_user_id, parent_task_id | `POST /api/tasks` | validate `taskInput` (một người, không tự giao, ngày hợp lệ, quyền dịch vụ) |
| `update_task` | ghi | **task_id**, title, description, result, due, start, service_id, assignee_user_id | `PUT /api/tasks/:id` | `writable()`; người viết mô tả |
| `comment_task` | ghi | **task_id**, **text** | `POST /api/tasks/:id/comments` | guard công việc |
| `task_workflow` | ghi | **task_id**, **action** (`start/submit/pass/redo/fail/reopen/back`), note, feedback, reason | `POST /api/tasks/:id/flow` | `applyFlow` (người duyệt mới PASS/REDO/FAIL) |
| `list_services` | đọc | query | `GET /api/tasks/meta` (`projects`) | dịch vụ được xem |
| `list_users` | đọc | query | `GET /api/tasks/meta` (`users`) | mọi người đăng nhập (xem rủi ro R-07) |
| `list_customers` | đọc | query | `GET /api/customers/directory` | khách được xem (`customerLevels`) |
| `get_customer` | đọc | **customer_id** | `GET /api/customers/:id/record`, `GET /api/customers/:id/tasks` | `requireCustomer(observer)` |

### 2.2 Trình dựng video (chỉ Mac, `CLOUD_STORAGE_ONLY` tắt)

| Công cụ | Loại | Input | Gọi API |
|---|---|---|---|
| `list_video_projects` | đọc | query | `GET /api/projects` |
| `get_video_project` | đọc | **project_id** | `GET /api/projects/:id`, `/hyperframes`, `/renders` |
| `view_footage` | đọc (ảnh) | **project_id**, labels (≤16) | `GET /api/projects/:id` rồi ảnh thu nhỏ Drive (ngoại lệ 1) |
| `prepare_hyperframes` | ghi (đĩa Mac) | **project_id**, labels | `POST /api/projects/:id/hyperframes/prepare` |
| `publish_render` | ghi | **project_id**, **file** | `POST /api/projects/:id/hyperframes/publish` (file phải nằm trong thư mục dự án) |

## 3. Ngoại lệ đọc trực tiếp [Hiện có]

1. `view_footage` lấy ảnh thu nhỏ bằng `G.thumbBuffer` **sau khi** `GET /api/projects/:id` xác nhận quyền xem dự án. Danh sách footage là dữ liệu server đã ký khi quét.
2. Xác thực token MCP đọc `mcp_tokens` và `users` để biết người dùng (tầng auth, không phải nghiệp vụ).

## 4. Công cụ đề xuất theo nhóm [Đề xuất]

Ký hiệu: **A** = cần duyệt của người dùng trong DMI (xem [AI_AGENT_DESIGN.md](AI_AGENT_DESIGN.md#duyệt)); **I** = cần khoá idempotency (mục 5).

### 4.1 Quản lý khách hàng

| Công cụ | Gọi route có sẵn | Quyền (do API kiểm) | Ghi chú |
|---|---|---|---|
| `create_customer` (I) | `POST /api/customers` với `databaseOnly: true` ([workspace.ts:677](../../server/workspace.ts#L677)) | đăng nhập; `customers.create` cho người không có trang Drive | Không tạo thư mục Drive từ AI |
| `update_customer_record` | `PUT /api/customers/:id/record` ([workspace.ts:901](../../server/workspace.ts#L901)) | `requireCustomer(admin)` | Trường theo `customerFields`, `customerClassification` |
| `set_customer_member` | `PUT /api/customers/:id/members/:userId` ([workspace.ts:786](../../server/workspace.ts#L786)) | mức khách hàng | |
| `customer_history` | `GET /api/customers/:id/history` ([customer-tabs.ts:27](../../server/customer-tabs.ts#L27)) | xem khách | |
| `customer_overview` | `GET /api/customer-flow` ([customer-tabs.ts:20](../../server/customer-tabs.ts#L20)) | khách được xem | Tổng quan quy trình theo khách |
| `archive_customer` (A) | `POST /api/admin/customers/:id/archive` ([admin/customers.ts:141](../../server/admin/customers.ts#L141)) | `customers.delete` | Ảnh hưởng dây chuyền (dịch vụ, báo cáo, board): luôn cần duyệt |

### 4.2 Quản lý công việc

| Công cụ | Gọi route | Quyền | Ghi chú |
|---|---|---|---|
| `set_task_labels`, `set_task_followers` | `PUT /api/tasks/:id` (`labels`, `followerUserIds`) | `writable()` | Mở rộng `update_task` |
| `set_task_priority` | `PUT /api/admin/tasks/:id/priority` ([admin/work.ts:94](../../server/admin/work.ts#L94)) | `tasks.update` (có phạm vi) | |
| `list_all_tasks` | `GET /api/admin/tasks` ([admin/work.ts:74](../../server/admin/work.ts#L74)) | `tasks.view` (không gồm mô tả, kết quả) | Cho quản lý xem toàn bộ trong phạm vi |
| `delete_task` (A) | `DELETE /api/tasks/:id` ([tasks.ts:791](../../server/tasks.ts#L791)) | người tạo hoặc admin | |
| `bulk_delete_tasks` (A) | `POST /api/tasks/bulk-delete` ([tasks.ts:797](../../server/tasks.ts#L797)) | từng công việc | Tối đa 500; chỉ qua duyệt |
| `create_task_from_template` (I) | **cần API mới** | | Mẫu (`task_templates`) chỉ có CRUD trong Quản trị, chưa có endpoint áp dụng |

### 4.3 Quản lý nhân viên

| Công cụ | Gọi route | Quyền | Ghi chú |
|---|---|---|---|
| `list_staff` | `GET /api/admin/staff` ([admin/staff.ts:91](../../server/admin/staff.ts#L91)) | `staff.view` (theo phạm vi) | Thay `list_users` cho người có quyền |
| `get_staff` | `GET /api/admin/staff/:id` ([admin/staff.ts:111](../../server/admin/staff.ts#L111)) | `staff.view` | Có lịch sử đăng nhập: lọc bớt trường trước khi trả AI |
| `staff_workload` | `GET /api/tasks?scope=team&team=…` | trưởng nhóm/phòng | Tính số việc mở, quá hạn mỗi người |
| `create_staff` (A, I) | `POST /api/admin/staff` ([admin/staff.ts:129](../../server/admin/staff.ts#L129)) | `staff.create` | |
| **Không đề xuất**: khoá, đăng xuất mọi thiết bị, đổi vai trò, đặt mật khẩu | | | Nhạy cảm, để con người làm trong Quản trị |

### 4.4 Quản lý dịch vụ khách (task_projects)

| Công cụ | Gọi route | Quyền |
|---|---|---|
| `create_customer_service` (I) | `POST /api/task-projects/for-service` ([tasks.ts:429](../../server/tasks.ts#L429)) hoặc `POST /api/customers/:id/projects` ([workspace.ts:830](../../server/workspace.ts#L830)) | quyền khách hàng |
| `set_service_member` | `PUT /api/task-projects/:project/members/:userId` ([tasks.ts:499](../../server/tasks.ts#L499)) | quản lý dịch vụ |
| `list_campaigns`, `create_campaign` | `GET/POST /api/task-projects/:project/campaigns` | quyền dịch vụ |

### 4.5 Báo cáo và phân tích

| Công cụ | Gọi route | Quyền |
|---|---|---|
| `org_stats` | `GET /api/admin/stats` ([admin/stats.ts:147](../../server/admin/stats.ts#L147)) | `stats.view` (theo phạm vi) |
| `list_reports`, `get_report` | `GET /api/reports`, `GET /api/reports/:id` | trang `editor` hoặc `ads`, quyền khách |
| `ads_summary` | `GET /api/ads/summary` ([ads-summary.ts:39](../../server/ads-summary.ts#L39)) | trang `ads` |
| `overdue_digest` | `list_tasks state=overdue` (đã có) | |

### 4.6 Toàn vẹn dữ liệu và kiểm tra

| Công cụ | Trạng thái | Ghi chú |
|---|---|---|
| `find_duplicate_customers` | **cần API mới** | So khớp tên, số điện thoại, email đã chuẩn hoá (có `normName` trong nhập khách hàng) |
| `tasks_missing_owner` | ghép từ `GET /api/tasks` | Việc chưa giao, không có người duyệt, quá hạn ở REVIEW |
| `validate_task_change` | **cần API mới** (`dryRun`) | Chạy validate `taskInput` mà không ghi; dùng để xem trước trong luồng duyệt |

### 4.7 Tự động hoá quy trình

| Công cụ | Gọi route | Ghi chú |
|---|---|---|
| `task_workflow` | đã có | |
| `send_notification` (A) | `POST /api/admin/notifications` ([admin/notify.ts:37](../../server/admin/notify.ts#L37)) | `notifications.create`; gửi email hàng loạt nên cần duyệt |
| `run_plan` (A) | **cần API mới** | Một kế hoạch nhiều bước do AI đề xuất, người dùng duyệt một lần, server chạy từng bước bằng các route trên |

## 5. API còn thiếu

| # | API đề xuất | Lý do | Độ khó |
|---|---|---|---|
| M1 | **Khoá idempotency** cho các route tạo (`Idempotency-Key` header hoặc trường `idempotencyKey`, bảng `idempotency_keys(key, user_id, route, response, created_at)`) | Client AI có thể gửi lại khi hết thời gian chờ: hiện tạo trùng công việc hoặc khách | M |
| M2 | **Hàng chờ duyệt**: `POST /api/ai/actions` (tạo đề xuất), `GET /api/ai/actions`, `POST /api/ai/actions/:id/approve`, `…/reject` (bảng `ai_actions`) | Duyệt trong DMI cho thao tác nhạy cảm, độc lập với client AI | L |
| M3 | **Quản lý kết nối Claude** của mỗi người: `GET /api/mcp/connections`, `DELETE /api/mcp/connections/:clientId` | Hiện chỉ khoá tài khoản mới cắt được token | S |
| M4 | **Giới hạn tần suất** cho `/api/mcp` và `/api/oauth/*` | Chưa có, xem [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | S–M |
| M5 | `dryRun` cho `POST/PUT /api/tasks` (và tạo khách) | Xem trước thay đổi để duyệt | M |
| M6 | Áp dụng mẫu công việc: `POST /api/task-templates/:id/apply` | Tự động hoá tạo bộ việc theo mẫu | M |
| M7 | Tìm khách trùng: `GET /api/customers/duplicates` | Toàn vẹn dữ liệu | S |
| M8 | Sửa nhiều công việc: `POST /api/tasks/bulk-update` (chỉ trường an toàn: hạn, nhãn, người theo dõi) | Hiện chỉ có xoá hàng loạt | M |
