# DM Studio miễn phí: Render Free + Turso Free

Mọi người mở cùng một URL app. Tài khoản, phiên đăng nhập, khách hàng, ghi chú và cấu hình được lưu trong một database Turso chung. Video khách hàng lưu trên Google Drive qua API. Backend không sao chép database về ổ tạm và không tự chuyển về SQLite khi Turso lỗi.

- Turso Free: hiện có 5 GB lưu trữ tổng, cùng hạn mức đọc/ghi. Kiểm tra [bảng giá Turso](https://turso.tech/pricing) khi đăng ký.
- Render Free: ngủ sau 15 phút không có truy cập, lần mở lại có thể chậm. Không có persistent disk. Xem [giới hạn Render Free](https://render.com/docs/free).
- Dung lượng Google Drive và các API AI dùng hạn mức/gói riêng của bạn.

## 1. Tạo database Turso Free

1. Mở https://turso.tech và chọn đăng ký/đăng nhập, có thể dùng GitHub. Chọn gói **Free**.
2. Trong dashboard, tạo database, ví dụ `dmi-studio`. Chọn vùng gần người dùng nếu có lựa chọn.
3. Mở trang database và phần kết nối. Sao chép **Database URL** có dạng `libsql://...`.
4. Tạo **database auth token** có quyền đọc/ghi cho database đó; lưu riêng token. Không dùng token quản trị toàn bộ tài khoản.
5. Không gửi token trong chat, không đặt trong `web/`, không commit vào Git. Token chỉ dùng ở backend.

Ứng dụng tự tạo bảng khi khởi động. Nếu muốn giữ tài khoản và ghi chú cũ, thực hiện mục 2 trước khi khởi động app cloud.

## 2. Chuyển dữ liệu local cũ (tùy chọn)

Bỏ qua mục này nếu muốn bắt đầu với database trống.

1. Dừng các server local đang ghi dữ liệu, sao lưu thư mục `data/` sau khi server đã dừng.
2. Thêm vào `.env` trên máy của bạn, mỗi biến một dòng, không thêm chú thích phía sau giá trị:
   ```dotenv
   TURSO_DATABASE_URL=libsql://your-database.turso.io
   TURSO_AUTH_TOKEN=your-database-token
   ```
3. Khi database Turso còn trống, chạy:
   ```sh
   npm run db:migrate:turso
   ```
   Có thể chỉ định file khác: `npm run db:migrate:turso -- /duong-dan/studio.db`.
4. Script đọc SQLite nguồn, chuyển các bảng ứng dụng trong một transaction và dừng nếu database đích đã có dữ liệu. Không ghi đè dữ liệu nguồn. Phiên đăng nhập cũ không được chuyển; mọi người đăng nhập lại.
5. Tài khoản, mật khẩu đã băm, khách hàng, link, ghi chú, cấu hình và token Google được chuyển. File video/media nằm trên ổ máy cũ không được tải lên. Các bản ghi asset/render cũ vẫn cần file media tương ứng để sử dụng.
6. Nếu đang dùng thư mục local/Drive for desktop, hãy tải file lên Google Drive và chọn lại thư mục gốc qua Google API trên bản cloud. Khách hàng còn dùng đường dẫn local được ẩn khỏi danh sách cloud. Các thư mục Drive sẽ được nhập khi duyệt; không tự ghép khách hàng theo tên. Muốn giữ ghi chú của bản ghi local, cần liên kết bản ghi đó với đúng Drive folder qua API trước khi sử dụng trên cloud.

Sau khi thêm hai biến Turso vào `.env`, cả app local cũng đọc/ghi database cloud thật. Xóa hai biến khỏi `.env` để quay lại database local độc lập; thay đổi local sau đó không tự nhập vào Turso.

## 3. Đẩy code lên GitHub

Repo hiện tại: `https://github.com/shanebenjamindev/dmi-studio.git`.

Review và commit các thay đổi cần triển khai, rồi đẩy nhánh lên GitHub:

```sh
git push -u origin main
```

`.env`, `data/` và các token không được đưa vào Git. Không nhúng token trong `render.yaml`.

## 4. Tạo app Render Free

1. Đăng nhập https://dashboard.render.com, chọn **New → Blueprint**.
2. Kết nối GitHub và chọn repo `shanebenjamindev/dmi-studio` cùng nhánh vừa push.
3. Render đọc `render.yaml`: Docker, gói **Free**, một instance, không có disk.
4. Nhập hai giá trị được yêu cầu:
   - `TURSO_DATABASE_URL`: URL database ở mục 1.
   - `TURSO_AUTH_TOKEN`: token database ở mục 1.
5. `SETUP_CODE` được Render tạo tự động; `CLOUD_STORAGE_ONLY=1` chỉ cho phép lưu file qua Google Drive.
6. Kiểm tra đúng gói **Free**, rồi triển khai. Sau khi build xong, mở URL `https://...onrender.com` do Render cấp.

Nếu sửa service Render cũ: lưu hai biến Turso, chuyển dữ liệu cần giữ trước, rồi mới chuyển sang gói Free và bỏ persistent disk. Việc xóa disk có thể mất dữ liệu trên disk đó; không làm trước khi sao lưu và kiểm tra dữ liệu đã chuyển.

## 5. Đăng nhập và kết nối Google Drive

- Database mới: lấy `SETUP_CODE` trong **Environment** của Render, mở app để tạo admin đầu tiên.
- Database đã nhập: đăng nhập bằng tài khoản cũ.
- Admin vào Quản trị để thêm email và mật khẩu cho thành viên.
- Trong Google Cloud Console, thêm `https://<dia-chi-app>/api/google/callback` vào Authorized redirect URIs của OAuth client. Giữ localhost nếu vẫn phát triển local.
- Trong Quản trị của app, cấu hình Google OAuth và kết nối tài khoản Google Drive, rồi chọn thư mục gốc chứa khách hàng.
- Mọi người mở cùng URL cloud; không cần chạy server trên từng máy.

## 6. Kiểm tra dùng chung và lưu bền vững

1. Admin tạo tài khoản thành viên trên cloud.
2. Mở cùng URL trên điện thoại hoặc trình duyệt khác, đăng nhập tài khoản thành viên.
3. Sửa ghi chú khách hàng và tải lại trên thiết bị còn lại để kiểm tra. Giao diện hiện chưa cập nhật realtime.
4. Restart service Render và kiểm tra tài khoản, ghi chú vẫn còn.
5. Log khởi động phải hiện `Database: Turso cloud (dùng chung)`. Nếu thiếu URL/token hoặc không kết nối được Turso, app dừng để tránh tạo một bộ dữ liệu local khác.

## Phạm vi của bản miễn phí

`CLOUD_STORAGE_ONLY=1` tắt lưu thư mục/file trên server, tạo media AI nền và lưu bản render vào `/assets`. Các tính năng này cần chỗ lưu file bền vững riêng trước khi bật lại. Luồng Khách hàng đang hiển thị trong app sử dụng Google Drive, hỗ trợ tải lên và xem video qua Drive.

Không đưa database token vào trình duyệt. Việc đăng nhập và kiểm tra quyền admin/member vẫn diễn ra ở backend. Database dùng chung không có nghĩa là thành viên được quyền quản trị.
