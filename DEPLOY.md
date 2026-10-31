# Deploy DM Studio lên Render

App chạy trong một container Docker (xem `Dockerfile`). Dữ liệu (tài khoản, khách hàng, token Google) nằm trong SQLite ở `/var/data`, nên cần một ổ đĩa lưu trữ (persistent disk).

## 1. Đưa code lên GitHub
1. Tạo repo **private** mới trên GitHub, ví dụ `dm-studio` (không tick README).
2. Trong thư mục dự án:
   ```sh
   git remote add origin https://github.com/<tài-khoản>/dm-studio.git
   git push -u origin main
   ```
   `data/` và `.env` đã được loại khỏi git, nên không có token hay mật khẩu nào bị đẩy lên.

## 2. Tạo dịch vụ trên Render
1. Vào https://dashboard.render.com → **New → Blueprint** → kết nối GitHub và chọn repo `dm-studio`.
2. Render đọc `render.yaml` và tạo:
   - web service Docker gói **Starter** (~7 USD/tháng; cần gói trả phí mới có ổ đĩa);
   - ổ đĩa 1 GB ở vùng Singapore.
3. Bấm **Apply** và đợi build xong. Bạn sẽ có địa chỉ dạng `https://dm-studio-xxxx.onrender.com`.

## 3. Tạo tài khoản quản trị
1. Trong Render → service → **Environment**, copy giá trị `SETUP_CODE`. Render tự tạo mã này.
2. Mở địa chỉ app, nhập mã cài đặt, tên, email và mật khẩu.

Không có mã thì không ai tạo được tài khoản quản trị đầu tiên, kể cả khi họ vào trang trước bạn.

## 4. Kết nối lại Google
Máy chủ mới chưa có dữ liệu trên máy của bạn, nên cần kết nối lại:
1. Google Cloud Console → **Clients** → mở OAuth client đang dùng → **Authorized redirect URIs** → thêm
   `https://<địa-chỉ-app>/api/google/callback`. Giữ nguyên dòng `localhost` nếu vẫn chạy trên máy.
2. Trong app: **Khách hàng → ⋯ → Tài khoản Google Drive…** → dán Client ID và Client secret → **Kết nối tài khoản Google**.
3. **⋯ → Chọn thư mục gốc…** → chọn `My Drive › DMI › 1. CLIENTS`. Các khách hàng sẽ tự hiện ra.
4. Link và ghi chú của khách cần nhập lại. Nếu muốn chuyển nguyên dữ liệu cũ, hãy hỏi Claude.

## Lưu ý
- Trên máy chủ cloud chỉ dùng được **Google Drive qua đăng nhập Google**. Chế độ "Drive (app trên máy)" không có.
- Video tải lên đi thẳng từ trình duyệt tới Google. Khi xem, video đi qua máy chủ, nên chọn vùng gần người dùng (đang đặt Singapore).
- Cập nhật app: `git push`, Render tự build lại; dữ liệu trên ổ đĩa được giữ nguyên.
- Dùng Railway, Fly.io hoặc VPS cũng được với cùng `Dockerfile`, miễn là:
  - gắn volume vào `/var/data`;
  - đặt biến `SETUP_CODE`;
  - đặt `PUBLIC_URL=https://<tên-miền>`.
