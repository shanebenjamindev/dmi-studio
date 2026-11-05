# DM Workspace — Detailers Movement

Ứng dụng **full-stack** làm video bằng AI: gõ ý tưởng, AI viết kịch bản, các model video/ảnh tạo cảnh nền, AI đọc lời thoại. Trình duyệt dựng chữ, chuyển động, logo và nhạc, rồi xuất **MP4**. Bản cloud chạy trên Cloudflare Workers, dùng chung Cloudflare D1 và lưu video khách hàng trên Google Drive; xem [DEPLOY.md](DEPLOY.md). Local vẫn hỗ trợ SQLite.

## Chạy trên máy (macOS)

Yêu cầu **Node.js 22.13+**: `node -v` (nâng cấp bằng `brew install node`). Nếu có **ffmpeg** (`brew install ffmpeg`), file xuất sẽ tự chuyển sang MP4 chuẩn H.264.

```bash
cd ~/DMIStudio
npm install
npm start                   # build giao diện + chạy server → http://localhost:5173
```

- `npm run demo`: chạy với nhà cung cấp **demo** (không cần key), để thử toàn bộ quy trình.
- `npm run dev`: chế độ phát triển, tự build lại khi sửa code.

## Sửa video nhanh từ terminal (CLI)

Khi server đang chạy, có thể sửa dự án mà không cần mở trình duyệt:

```bash
npm run -s dms -- login                         # đăng nhập 1 lần (lưu ở ~/.dms)
npm run -s dms -- projects                      # danh sách dự án
npm run -s dms -- show 1                        # xem các cảnh của dự án số 1
npm run -s dms -- set 1 3 headline="Bóng như gương" duration=4
npm run -s dms -- set 1 all animation=zoom      # áp cho mọi cảnh
npm run -s dms -- refine 1 "rút còn 15 giây, CTA mạnh hơn"
npm run -s dms -- undo 1                        # hoàn tác lần ghi gần nhất
```

`npm run -s dms -- help` liệt kê đủ lệnh. Đặt `DMS_URL` để sửa trên server khác (vd. bản cloud). Đóng dự án trên trình duyệt trong lúc sửa bằng CLI, vì trình soạn thảo tự lưu có thể ghi đè.

**Dùng với Claude Code:** skill [`.claude/skills/dms-edit`](.claude/skills/dms-edit/SKILL.md) dạy Claude Code dùng CLI này, nên bạn chỉ cần nói kiểu *"dự án ceramic: rút cảnh 2 còn 3 giây, viết lại lời thoại cho tự nhiên hơn rồi tạo lại giọng đọc"*.

## Lọc source từ Google Drive

Trong **Trình dựng**, dán link thư mục Google Drive vào ô "Source từ Google Drive" rồi bấm **Quét**. App lấy mọi video và ảnh, kể cả trong thư mục con (tối đa 150 file). Khi bấm **Tạo video**, Claude xem thumbnail từng file, chỉ giữ những file khớp với mô tả và đặt mỗi clip làm nền cho cảnh phù hợp. Chat chỉnh sửa (ví dụ "cảnh kết dùng clip xe đang chạy") cũng lọc lại theo yêu cầu. Ở cột phải có thể chọn tay source cho từng cảnh.

Thư mục phải được chia sẻ cho một tài khoản Google đã kết nối trong trang Khách hàng. File được phát thẳng từ Drive qua server, không tải về máy, và mọi link đều có chữ ký. CLI: `npm run -s dms -- new "ý tưởng" --drive <link>` hoặc `npm run -s dms -- drive <dự án> <link>`.

## AI: chỉ dùng Claude CLI, không cần API key

Viết và chỉnh kịch bản chạy qua lệnh `claude` (Claude Code) bằng tài khoản Claude đã đăng nhập trên máy chủ. Model: Sonnet, Opus, Haiku. Server tự tìm `claude` trong PATH, `~/.claude/local` hoặc extension VS Code. Nếu không tìm thấy, đặt `CLAUDE_CLI_PATH`. Không có tạo clip, ảnh hay giọng đọc bằng AI, vì các dịch vụ đó đều cần API trả phí. Video dùng nền động, chữ chuyển động, logo, phụ đề và nhạc nền.

## Kiến trúc

```
server/                 Node + TypeScript (chạy bằng tsx), không framework
  index.ts              HTTP server local: REST API, /assets (hỗ trợ Range), phục vụ giao diện
  worker.ts             Cloudflare Workers: static assets + API, dùng D1 và Google Drive
  routes.ts             /api/projects, /api/ai/*, /api/jobs, /api/renders, /api/settings
  db.ts                 Cloudflare D1 / SQLite local qua node:sqlite: projects, jobs, assets, renders, settings, ai_calls
  jobs.ts               Worker nền: gửi job → poll → tải file về → gắn vào cảnh (vẫn chạy khi đóng trình duyệt)
  storyboard.ts         Schema JSON chung cho mọi model + bộ nhận diện thương hiệu Detailers Movement
  providers/
    registry.ts         Danh mục model (Claude CLI + bộ demo offline)
    llm.ts              Claude Code CLI (claude -p --json-schema): buộc trả JSON
    media.ts            Hàng đợi media, chỉ còn bộ demo offline
    mock.ts             Nhà cung cấp demo (ffmpeg)
web/                    React 19, đóng gói bằng esbuild → web/dist
  src/engine/           renderer (canvas), player (đồng bộ clip AI), audio (nhạc + giọng), exporter (MediaRecorder)
  src/components/       TopBar, LeftPanel, Stage/Timeline, Inspector (Cảnh, Toàn video, Thương hiệu, Bản xuất), Dialogs
data/                   studio.db + assets/ (tự tạo, đã nằm trong .gitignore)
```

**Quy trình:** ý tưởng → `POST /api/ai/storyboard` (model đã chọn) → storyboard JSON → chỉnh trên giao diện (tự lưu) → `POST /api/jobs` (video/ảnh/giọng) → worker poll nhà cung cấp và lưu file vào `data/assets` → canvas dựng hình nền AI, chữ, logo, phụ đề, nhạc và giọng → MediaRecorder → `POST /api/projects/:id/renders` → ffmpeg chuyển sang MP4.

## Nhận diện thương hiệu
- Màu: Deep Blue `#1539E1`, Movement Blue `#0B7DF2`, Cyan `#16C3F6`, Night `#050A1F`, đen và trắng.
- Font: Montserrat ExtraBold cho tiêu đề, Montserrat Light giãn chữ cho slogan, Inter cho phụ đề.
- Logo trong video: biểu tượng nhỏ ở góc mỗi cảnh, logo đầy đủ ở cảnh kết. Nền tối dùng logo chữ trắng.
- Bật ô „Theo nhận diện Detailers Movement“ thì AI bị buộc dùng đúng bảng màu, font và giọng văn thương hiệu.

## Lưu ý
- Video AI tính phí theo từng nhà cung cấp và thường mất 1–5 phút mỗi clip. Job chạy nền trên server, bạn có thể đóng trang.
- Dữ liệu được lưu trong database (Cloudflare D1 trên bản cloud, hoặc `data/studio.db` khi chạy local). Đừng chia sẻ thư mục `data/`.
- Mặc định server chỉ nghe trên `127.0.0.1`. Muốn mở cho máy khác trong mạng thì đặt `HOST=0.0.0.0`, mọi người vẫn phải đăng nhập và tuân theo quyền admin/member.
# dmi-studio
