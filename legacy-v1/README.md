# DMI Studio — làm video chỉ bằng một câu mô tả

Gõ ý tưởng → Claude viết kịch bản (cảnh, chữ, màu, hiệu ứng, nhạc) → xem trước & chỉnh → xuất file video MP4/WebM.

## Chạy

```bash
cd ~/DMIStudio
cp .env.example .env      # rồi dán Claude API key vào .env (hoặc nhập trong ⚙︎ Cài đặt)
npm start                 # không cần npm install — không có thư viện phụ thuộc
```

Mở http://localhost:5173 (nên dùng Chrome / Edge / Safari mới).

## Tính năng
- **Tạo từ mô tả**: chọn tỉ lệ 16:9 / 9:16 / 1:1 và độ dài 15–60 giây.
- **Chỉnh bằng lời**: “thêm cảnh số liệu”, “màu ấm hơn”, “dịch sang tiếng Anh”… Claude sửa toàn bộ storyboard.
- **Chỉnh tay**: 6 bố cục, 5 hiệu ứng chữ, 6 kiểu nền động, bảng màu, font, thời lượng từng cảnh, sắp xếp/nhân bản/xoá cảnh.
- **Nhạc nền tự tổng hợp** (nhẹ nhàng / sôi động / hùng tráng) — không vướng bản quyền.
- **Phụ đề** từ lời thoại; “Đọc thử” dùng giọng đọc của trình duyệt khi xem trước (không có trong file xuất).
- **Xuất video** 1080p/720p, có nhạc. Chrome/Safari cho MP4, trình duyệt khác cho WebM.
- Tự lưu trong trình duyệt; Lưu/Mở file dự án `.dmi.json`. Phím tắt: Space (phát), ⌘/Ctrl+Z (hoàn tác), ⌘/Ctrl+Enter (tạo).
- **Bản mẫu** chạy được ngay không cần API key.

## Cấu trúc
- `server.js` — server Node không phụ thuộc, gọi Claude Messages API với tool `create_storyboard` để nhận JSON chắc chắn.
- `public/renderer.js` — vẽ từng khung hình trên canvas từ storyboard.
- `public/music.js` — nhạc nền Web Audio.
- `public/app.js` — giao diện biên tập, timeline, xuất video (MediaRecorder).
