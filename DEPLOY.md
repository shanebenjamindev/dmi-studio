# DM Studio trên Cloudflare Workers + Turso

URL đang triển khai: https://dmi-studio.vophonggiang0205.workers.dev

Một Worker phục vụ cả React và API tại cùng một URL `https://dmi-studio.<subdomain>.workers.dev`. Turso lưu tài khoản, phiên đăng nhập, khách hàng, ghi chú và cấu hình. Video lưu trên Google Drive. Không cần backend Render.

## Triển khai từ máy này

```sh
npm ci
npm run cf:login
npm run typecheck
npm test
npm run test:worker
npm run cf:secrets
npm run cf:deploy
```

- `cf:login` mở luồng đăng nhập Cloudflare nếu chưa có phiên đăng nhập.
- Điền `TURSO_DATABASE_URL` và `TURSO_AUTH_TOKEN` trong `.env` trước khi chạy `cf:secrets`.
- `cf:secrets` gửi hai giá trị đó dưới dạng Cloudflare Secrets, cùng mã bảo vệ khởi tạo admin. Nếu Worker chưa tồn tại, Wrangler có thể hỏi tạo Worker; chọn tạo. Không in token và không đưa `.env` vào Git.
- `cf:deploy` build React, tải static assets và API lên Worker. Wrangler in URL sau khi hoàn tất.
- Không đặt token trong `wrangler.jsonc`, frontend hay GitHub. `.env` chỉ được Wrangler đọc khi phát triển local; production dùng Secrets riêng.

Nếu cấu hình secrets bằng dashboard: **Workers & Pages → dmi-studio → Settings → Variables and Secrets**, thêm `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` dưới loại Secret. Deploy lại sau khi lưu.

## Chuyển từ Render

1. Dùng lại đúng database Turso của Render. Không tạo database thứ hai.
2. Deploy Worker và cấu hình Secrets.
3. Mở URL Workers, đăng nhập bằng tài khoản cũ, kiểm tra danh sách khách hàng và ghi chú.
4. Thêm `https://dmi-studio.vophonggiang0205.workers.dev/api/google/callback` vào Authorized redirect URIs trong Google Cloud Console cho OAuth client đang dùng. Với custom domain, thêm callback của domain đó nữa.
5. Kết nối lại Google nếu cần và kiểm tra upload/xem video.
6. Sau khi xác nhận đầy đủ, mới ngừng service Render. Quá trình chuyển này không tự xóa dịch vụ hoặc ổ dữ liệu Render.

Mật khẩu cũ giữ nguyên định dạng scrypt. Cookie phiên thuộc từng domain nên cần đăng nhập lại trên domain Cloudflare. Trạng thái OAuth và giới hạn thử mật khẩu nằm trong Turso để hoạt động qua nhiều Worker.

## Nếu dữ liệu vẫn chỉ nằm ở SQLite local

Dừng ghi dữ liệu local, sao lưu `data/` rồi điền hai biến Turso vào `.env` và chạy:

```sh
npm run db:migrate:turso
```

Script chỉ nhập vào database trống, không ghi đè hoặc trộn dữ liệu đã có. Chuyển tài khoản, mật khẩu đã băm, ghi chú và cấu hình; không chuyển phiên đăng nhập và file video local. Giao diện chỉ có đăng nhập nên cần tài khoản được nhập sẵn hoặc được quản trị viên cấp.

Nếu khách hàng cũ dùng đường dẫn trên Mac/Drive for desktop, cần liên kết lại với Google Drive API. Không thể truy cập file trên máy Mac từ Workers. Các bản ghi dùng đường dẫn local vẫn được giữ trong database nhưng bị ẩn trên bản cloud.

## Phát triển và kiểm tra

- `npm run dev`: Node.js + SQLite local nếu chưa cấu hình Turso; nếu có hai biến Turso, dùng database cloud đó.
- `npm run cf:dev`: chạy Workers runtime local, đọc Secrets từ `.env`. Dùng database Turso riêng để thử nếu không muốn tác động dữ liệu thật.
- `npm run cf:check`: kiểm tra build/bundle Workers, không deploy.
- `npm test`: kiểm tra database và backend Node; worker tests chạy nếu đã có bundle test.
- `npm run test:worker`: build bundle mới và chạy kiểm tra Workers với database giả lập riêng, không dùng credentials production. Kiểm tra cookie HTTPS, đăng nhập, callback Google qua hai isolate, chống callback dùng lại, giới hạn thử mật khẩu và Origin.

## Giới hạn

- Workers Free có hạn mức request/CPU và Turso Free có hạn mức dung lượng/đọc/ghi; theo dõi dashboard khi dùng thực tế. [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Turso pricing](https://turso.tech/pricing).
- Workers không có ổ lưu trữ local bền vững hoặc ffmpeg. `CLOUD_STORAGE_ONLY=1` được bật bắt buộc: video khách hàng đi qua Google Drive; các tính năng tạo media nền và lưu render vào `/assets` bị tắt.
- Dùng upload trực tiếp lên Google Drive cho video lớn. Đường upload dự phòng qua Worker chịu giới hạn request của Cloudflare.
- Database được khởi tạo trong request đầu tiên, không thực hiện network I/O khi nạp module. Thiếu secrets hoặc mất kết nối Turso trả HTTP 503, không tạo database local thay thế.
- Static assets được Cloudflare phục vụ trực tiếp. `/api/*` luôn qua Worker và kiểm tra đăng nhập/phân quyền; không dùng SPA fallback cho API.

Cấu hình Render cũ được giữ trong `render.yaml`; hướng dẫn cũ ở [DEPLOY-RENDER.md](DEPLOY-RENDER.md).
