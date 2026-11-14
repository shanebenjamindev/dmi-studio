# DMI Workspace — Detailers Movement

Ứng dụng làm việc của Detailers Movement: board, công việc theo quy trình, khách hàng, báo cáo và trình dựng video. Bản cloud chạy trên Cloudflare Workers, dùng Cloudflare D1 và lưu video khách hàng trên Google Drive; xem [DEPLOY.md](DEPLOY.md). Chạy local thì dùng SQLite.

App không tự gọi model AI nào và không dùng API trả phí. Claude làm việc **trên** DMI qua connector MCP, bằng gói Claude của từng người.

## Chạy trên máy (macOS)

Yêu cầu **Node.js 22.13+** (`brew install node`) và **ffmpeg** (`brew install ffmpeg`, trình dựng cần).

```bash
cd ~/DMIStudio
npm install
npm start                   # build giao diện + chạy server → http://localhost:5173
```

`npm run dev`: chế độ phát triển, tự build lại khi sửa code.

## Claude với DMI (MCP)

`/api/mcp` là một MCP server (Streamable HTTP), đăng nhập bằng OAuth với tài khoản DMI. Mọi công cụ chạy như một request của chính người đã kết nối, nên Claude có đúng quyền của người đó và mọi thao tác vào nhật ký (nguồn "Claude (MCP)"). Code: `server/mcp.ts`.

- **claude.ai / app Claude:** Settings → Connectors → Add custom connector → `https://dmi-workspace.detailersmovement.workers.dev/api/mcp`. Gói Team: Owner thêm một lần cho tổ chức.
- **Claude Code:** `claude mcp add --transport http dmi https://dmi-workspace.detailersmovement.workers.dev/api/mcp`, rồi `/mcp` để đăng nhập.

Công cụ: tìm kiếm, công việc (xem, tạo, sửa, bình luận, chuyển bước quy trình), dịch vụ, nhân sự, khách hàng. Trên máy Mac có thêm công cụ của trình dựng (bên dưới).

## Trợ lý AI trong DMI

Nút ✦ trên thanh trên cùng (⌘J): chat với Claude, dùng chung bộ công cụ với connector MCP và đúng quyền của người đang chat; thay đổi nào cũng chờ người dùng Duyệt. Gọi Claude API (tính phí theo token, cần `ANTHROPIC_API_KEY`, xem [DEPLOY.md](DEPLOY.md)). Code: `server/assistant.ts`, `web/src/components/Assistant.tsx`.

## Trình dựng video: Claude Code + HyperFrames (chỉ trên Mac)

1. **Tools → Trình dựng → Tạo dự án** từ link sheet yêu cầu. Server đọc kịch bản theo mẫu form và tìm footage trên Drive (nhãn s1, s2…). Không gọi AI.
2. Kết nối Claude Code với DMI trên Mac (một lần): `claude mcp add --transport http --scope user dmi-mac http://localhost:5173/api/mcp`.
3. Tab **Làm với Claude** có lời nhắc để chép vào Claude Code. Claude dùng `get_video_project`, `view_footage`, `prepare_hyperframes` (tạo thư mục `~/DMI-HyperFrames/<dự án>/`, tải footage vào `assets/`, ghi `BRIEF.md`), dựng bằng [HyperFrames](https://hyperframes.heygen.com) và mở bản xem trước (hiện ngay trong trang).
4. Khi duyệt, Claude render trên máy (`npx hyperframes render`, miễn phí) rồi `publish_render`: bản MP4 hiện ở tab Bản render.

Đổi thư mục dự án bằng `HYPERFRAMES_DIR`. Code: `server/hyperframes.ts`, `server/video-mcp.ts`, `web/src/components/Editor.tsx`.

## Kiến trúc

```
server/                 Node + TypeScript (chạy bằng tsx), không framework
  index.ts              HTTP server local: REST API, /assets (hỗ trợ Range), phục vụ giao diện
  worker.ts             Cloudflare Workers: static assets + API, dùng D1 và Google Drive
  app.ts / routes.ts    API: dự án video, bản render, đăng ký các module
  mcp.ts, mcp-kit.ts    Connector Claude: OAuth (đăng ký app, cho phép, token) và công cụ MCP
  video-mcp.ts          Công cụ MCP của trình dựng
  hyperframes.ts        Thư mục HyperFrames của dự án: chuẩn bị, xem trước, gửi bản render
  sheets.ts, sources.ts Đọc sheet yêu cầu và footage trên Google Drive
  tasks.ts, boards.ts…  Công việc, board, khách hàng, báo cáo, thông báo, quản trị
web/                    React 19, đóng gói bằng esbuild → web/dist
data/                   studio.db + assets/ (tự tạo, đã nằm trong .gitignore)
```

## Nhận diện thương hiệu
- Màu: Deep Blue `#1539E1`, Movement Blue `#0B7DF2`, Cyan `#16C3F6`, Night `#050A1F`, đen và trắng.
- Font: Montserrat ExtraBold cho tiêu đề, Montserrat Light giãn chữ cho slogan, Inter cho phụ đề.
- Logo trong video: biểu tượng nhỏ ở góc mỗi cảnh, logo đầy đủ ở cảnh kết. Nền tối dùng logo chữ trắng.

## Lưu ý
- Dữ liệu được lưu trong database (Cloudflare D1 trên bản cloud, hoặc `data/studio.db` khi chạy local). Đừng chia sẻ thư mục `data/`.
- Mặc định server chỉ nghe trên `127.0.0.1`. Muốn mở cho máy khác trong mạng thì đặt `HOST=0.0.0.0`, mọi người vẫn phải đăng nhập và tuân theo quyền admin/member.
