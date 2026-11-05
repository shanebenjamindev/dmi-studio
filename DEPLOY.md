# DM Workspace trên Cloudflare Workers + D1

App: https://dmi-workspace.detailersmovement.workers.dev

- **Cloudflare Workers** phục vụ giao diện React và API tại cùng một URL.
- **Cloudflare D1** lưu tài khoản, phiên đăng nhập, khách hàng, ghi chú và cấu hình.
- Video tiếp tục lưu trên **Google Drive**.
- Production không dùng Render, Turso hoặc database token bên ngoài Cloudflare.

## Database hiện tại

Binding: `DB` · database: `dmi-studio-db`.

Database đã được chuyển và kiểm tra toàn bộ giá trị từ bản cũ. Bản sao trước khi chuyển và bản export D1 nằm trong `data/backups/`, đã được loại khỏi Git. Các file này chứa dữ liệu riêng và có thể chứa token Google: không chia sẻ hoặc commit.

Xem tài khoản: Cloudflare Dashboard → Storage & databases → D1 → dmi-studio-db → Console:

```sql
SELECT id, email, name, role, disabled FROM users;
```

Mật khẩu được lưu dưới dạng băm scrypt, không thể xem lại mật khẩu gốc.

## Triển khai

```sh
npm ci
npm run cf:login
npm run typecheck
npm run test:worker
npm test
npm run cf:deploy
```

`wrangler.jsonc` đã khai báo D1 binding và database ID. Không cần URL hoặc auth token để Worker kết nối D1.

## Sao lưu

```sh
npm run db:backup
```

Lệnh tạo bản export remote tại `data/backups/d1-latest.sql`. Đổi tên file để giữ các phiên bản trước nếu cần. Với máy mới, tạo thư mục `data/backups` trước khi sao lưu.

## Turnstile — xác minh không phải người máy

1. Cloudflare → Turnstile → Add widget → **Managed**.
2. Hostname: `dmi-workspace.detailersmovement.workers.dev`.
3. Lưu Site Key vào `TURNSTILE_SITE_KEY` và Secret Key vào `TURNSTILE_SECRET_KEY` trong `.env`.
4. Chạy `npm run cf:secrets`, rồi `npm run cf:deploy`.

Hai key hiện chưa được cung cấp. `TURNSTILE_REQUIRED=0` giữ luồng đăng nhập hiện có trong lần chuyển database. Khi có key, xác minh tự bật và backend yêu cầu token hợp lệ; có thể đặt `TURNSTILE_REQUIRED=1` để bắt buộc cấu hình trước khi cho đăng nhập. Không dùng key thử nghiệm trên production.

Backend xác minh token qua Siteverify, kiểm tra hostname và action. Token hết hạn hoặc đã dùng phải xác minh lại. Secret chỉ ở backend, không đưa vào Git hay frontend.

## Google Drive

Google OAuth client cần Authorized redirect URI:

```text
https://dmi-workspace.detailersmovement.workers.dev/api/google/callback
```

Cookie thuộc từng domain. Người dùng đăng nhập bằng email và mật khẩu; kết nối Google Drive nằm trong trang Quản trị.

## Phát triển

- `npm run dev`: backend Node + database SQLite riêng tại `data/studio.db`, không tác động D1 production.
- `npm run cf:dev`: Worker + D1 local do Wrangler quản lý, không dùng dữ liệu production.
- `npm run cf:check`: kiểm tra bundle, không deploy.
- `npm run test:worker`: kiểm tra D1 thật trong Miniflare riêng, không gửi dữ liệu vào database production.

## Giới hạn

Workers không có ổ lưu trữ local bền vững hoặc ffmpeg. Video khách hàng đi thẳng tới Google Drive; tính năng lưu media/render trên ổ server bị tắt.

Gói D1 Free hiện giới hạn **500 MB cho mỗi database**, tối đa 5 GB tổng mỗi tài khoản. Xem [giới hạn D1](https://developers.cloudflare.com/d1/platform/limits/) và [hạn mức Workers](https://developers.cloudflare.com/workers/platform/limits/). Dữ liệu tài khoản/ghi chú của app hiện rất nhỏ; video không được lưu trong D1.
