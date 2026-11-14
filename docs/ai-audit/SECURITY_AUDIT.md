# SECURITY_AUDIT: DMI Workspace và trợ lý AI

> Audit ngày 14/11/2026 trên code (không thử xâm nhập hệ thống thật, không đọc dữ liệu production). Mức độ: **Cao / Trung bình / Thấp**. "Hiện có" là kiểm soát đã có; "Đề xuất" là việc nên làm.

## 1. Kiểm soát hiện có [Hiện có]

| Lớp | Kiểm soát | Code |
|---|---|---|
| Danh tính | Mật khẩu scrypt; đăng nhập Google; phiên 30 ngày, token ngẫu nhiên 32 byte, lưu hash SHA-256; cookie `HttpOnly; SameSite=Lax; Secure` (https) | [server/auth.ts:32-58](../../server/auth.ts) |
| Chống dò mật khẩu | `throttle()` theo email + IP, khoá 15 phút; ghi `login_logs` | [server/auth.ts:246](../../server/auth.ts) |
| Chống bot | Cloudflare Turnstile (có, **đang tắt**: `TURNSTILE_REQUIRED=0`, chưa có key) | [server/turnstile.ts](../../server/turnstile.ts), [DEPLOY.md](../../DEPLOY.md) |
| CSRF | Kiểm tra `Origin` cho mọi request không phải GET (Worker và local); trang "Cho phép" của OAuth có thêm token CSRF gắn với phiên | [server/worker.ts](../../server/worker.ts), [server/index.ts](../../server/index.ts) `trustedRequest`, [server/mcp.ts](../../server/mcp.ts) `csrfOf` |
| Phân quyền | `guard()` tập trung; RBAC có phạm vi; quyền theo bản ghi khách hàng, dịch vụ, board, công việc; vai trò chỉ-xem | [server/auth.ts:150](../../server/auth.ts), [shared/permissions.ts](../../shared/permissions.ts) |
| Khoá site | Super Admin khoá site; mọi request khác bị chặn | [server/site-lock.ts](../../server/site-lock.ts) |
| Nhật ký | `withTrail` cho mọi thay đổi, snapshot trước/sau; nhật ký đăng nhập, lỗi, phân quyền | [server/audit.ts](../../server/audit.ts) |
| File | Link Drive có chữ ký HMAC; file người dùng không bao giờ hiển thị như trang của site (`untrustedHeaders`) | [server/sources.ts](../../server/sources.ts), [server/http.ts](../../server/http.ts) |
| Header | `x-frame-options: SAMEORIGIN`, `nosniff`, `referrer-policy`, HSTS | [server/app.ts](../../server/app.ts) |
| Connector MCP | OAuth 2.1: PKCE S256 bắt buộc, `redirect_uri` khớp tuyệt đối, chỉ https hoặc loopback; mã một lần, 10 phút; access token 1 giờ, refresh 60 ngày có xoay vòng; token lưu hash; tài khoản bị khoá thì token hết dùng; trang "Cho phép" có CSP chặt, `frame-ancestors 'none'` | [server/mcp.ts](../../server/mcp.ts) |
| Công cụ AI | Chạy như request của chính người dùng (cùng guard, validate, nhật ký); không có công cụ xoá, phân quyền, cấu hình, SQL | [server/mcp.ts](../../server/mcp.ts) `callAs` |
| SQL trực tiếp | `POST /api/admin/sql` chỉ Super Admin, cần bật "cho phép sửa", ghi nhật ký **trước** khi chạy | [server/admin/hosting.ts:152](../../server/admin/hosting.ts) |

## 2. Phát hiện

| ID | Mức | Phát hiện | Bằng chứng | Đề xuất |
|---|---|---|---|---|
| S-01 | **Cao** | Bí mật lưu **dạng thường** trong bảng `settings`: Google OAuth client secret, refresh token Google (Drive, Gmail), token Meta Ads | [server/google.ts:20-26](../../server/google.ts), [server/ads.ts:151](../../server/ads.ts) | Mã hoá khi lưu (AES-GCM qua WebCrypto) bằng khoá trong Wrangler secret; bản sao lưu `data/backups/*.sql` cũng chứa các giá trị này (DEPLOY.md đã cảnh báo) |
| S-02 | Trung bình | Token Meta gửi trong **query string** (`access_token=`) | [server/ads.ts:45](../../server/ads.ts) | Gửi qua header `Authorization: Bearer`, tránh lộ trong log proxy hoặc trình duyệt |
| S-03 | Trung bình | **Không có giới hạn tần suất** cho API nói chung, `/api/mcp`, `/api/oauth/register`, `/api/oauth/token` | không có middleware nào ngoài `throttle` đăng nhập | Giới hạn theo token MCP và theo IP (bảng đếm D1 hoặc Rate Limiting binding của Cloudflare, cần xác minh có trên gói hiện tại) |
| S-04 | Trung bình | Đăng ký app OAuth **mở hoàn toàn**: ai cũng tạo được `mcp_clients`, không có dọn dẹp | [server/mcp.ts](../../server/mcp.ts) `/api/oauth/register` | Chỉ cho `redirect_uri` thuộc danh sách cho phép (claude.ai, claude.com, loopback); dọn client không có token sau 30 ngày; hiển thị host trả về rõ hơn trên trang "Cho phép" (đã có) |
| S-05 | Trung bình | **Prompt injection**: công cụ trả về nội dung do người dùng viết (bình luận, mô tả, ghi chú khách, CSV của sheet, tên file Drive). Nội dung độc có thể khiến Claude gọi công cụ ghi | [server/mcp.ts](../../server/mcp.ts) `get_task`, `get_customer`; [server/video-mcp.ts](../../server/video-mcp.ts) | (a) giữ công cụ ghi ở mức "cần xác nhận" của client; (b) **duyệt phía server** cho thao tác nhạy cảm (M2); (c) bọc trường không tin cậy trong khối đánh dấu và ghi trong `instructions` của server rằng dữ liệu không phải lệnh; (d) không thêm công cụ xoá hoặc gửi email hàng loạt khi chưa có (b) |
| S-06 | Trung bình | **Không thu hồi được kết nối Claude** theo từng app; refresh token cũ bị dùng lại chỉ bị từ chối, không thu hồi cả chuỗi | [server/mcp.ts](../../server/mcp.ts) `/api/oauth/token` | API và giao diện "Kết nối Claude" (M3); phát hiện dùng lại refresh token thì thu hồi mọi token của client đó cho người dùng đó |
| S-07 | Thấp–TB | `GET /api/tasks/meta` trả **mọi tài khoản đang hoạt động kèm email** cho mọi thành viên; công cụ `list_users` làm việc tra cứu này dễ hơn | [server/tasks.ts](../../server/tasks.ts) `users:` trong `/api/tasks/meta` | Bỏ email nếu không cần, hoặc chỉ trả cho người có `staff.view` |
| S-08 | Thấp | Nhật ký chỉ ghi user-agent `Claude (MCP)`, **không ghi app hay token** nào thực hiện | [server/mcp.ts](../../server/mcp.ts) `callAs` | Gắn `client_id` vào bản ghi `audit_logs` (cột mới hoặc trong `agent`) |
| S-09 | Thấp | **Không có idempotency**: client AI thử lại sẽ tạo trùng | các route `POST` tạo bản ghi | M1 trong [MCP_TOOL_REGISTRY.md](MCP_TOOL_REGISTRY.md#5-api-còn-thiếu) |
| S-10 | Thấp | `POST /api/admin/sql` tồn tại trên production (Super Admin) | [server/admin/hosting.ts:152](../../server/admin/hosting.ts) | Không bao giờ đưa vào công cụ AI; cân nhắc yêu cầu nhập lại mật khẩu khi bật "cho phép sửa" |
| S-11 | Thấp | Turnstile đang tắt trên production | [wrangler.jsonc](../../wrangler.jsonc) `TURNSTILE_REQUIRED: "0"` | Cấp key và bật |
| S-12 | Thấp | `PAGE_OF` còn tiền tố của route đã xoá (`proxies`, `capcut`, `outro`, `ai`, `jobs`, `templates`) | [server/auth.ts:127](../../server/auth.ts) | Dọn danh sách (không ảnh hưởng an toàn, chỉ gây hiểu lầm) |
| S-13 | Quy trình | **Test runtime Worker không chạy được** trên máy dev (Miniflare với Node 26); một lỗi khởi động Worker đã suýt lên production trong phiên này | `tests/worker.test.mjs` | Chạy test Worker trên CI với Node 22 trước mỗi deploy |
| S-14 | Thấp | Server local (Mac) dùng http; nếu đặt `HOST=0.0.0.0` thì phiên và token MCP đi qua mạng LAN không mã hoá | [server/config.ts](../../server/config.ts) | Giữ mặc định `127.0.0.1`; mở ra ngoài thì qua tunnel https |

## 3. Kiến trúc an toàn cho trợ lý AI

### 3.1 Danh tính và phiên
- [Hiện có] Mọi lời gọi công cụ mang danh tính một người (token OAuth gắn `user_id`). Không có "tài khoản dịch vụ" dùng chung.
- [Đề xuất, phương án B] Nếu có agent chạy trong app: agent dùng **phiên của người đang chat** (cookie), gọi cùng `callAs`. API key Anthropic chỉ nằm ở Wrangler secret (`ANTHROPIC_API_KEY`), không bao giờ gửi xuống trình duyệt.

### 3.2 Phân quyền
- [Hiện có] Quyền do API kiểm, không phải do mô tả công cụ. AI không thể vượt quyền của người dùng.
- [Đề xuất] Thêm một danh sách cho phép công cụ theo vai trò (ví dụ Member không thấy `list_staff`) để giảm bề mặt tấn công prompt injection; vẫn giữ kiểm quyền ở API.

### 3.3 Duyệt thao tác nhạy cảm
- Thao tác cần duyệt: xoá, lưu trữ khách, gửi thông báo hàng loạt, tạo tài khoản, thao tác > 10 bản ghi, mọi `run_plan`.
- Cơ chế: công cụ chỉ **tạo đề xuất** (`ai_actions`, trạng thái `pending`) kèm bản xem trước (`dryRun`). Người dùng duyệt trong DMI. Server chạy bằng chính quyền của **người duyệt**, ghi nhật ký cả đề xuất lẫn kết quả.

### 3.4 Thao tác hàng loạt an toàn
- Giới hạn cứng (đã có ở `bulk-delete`: 500). Đề xuất ≤ 50 cho AI.
- Xem trước danh sách id, chạy từng bản ghi, trả kết quả từng dòng; không dừng giữa chừng mà không báo.

### 3.5 Nhật ký
- [Hiện có] `audit_logs` cho mọi thay đổi.
- [Đề xuất] Thêm: client hoặc token thực hiện (S-08), id đề xuất (`ai_action_id`) cho thao tác qua duyệt, lý do do AI ghi.
