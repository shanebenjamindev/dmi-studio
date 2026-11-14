# DMI Workspace — Detailers Movement

Ứng dụng làm việc của Detailers Movement: board, công việc theo quy trình, khách hàng, báo cáo và công cụ chuyển đổi file. Bản cloud chạy trên Cloudflare Workers, dùng Cloudflare D1 và lưu video khách hàng trên Google Drive; xem [DEPLOY.md](DEPLOY.md). Chạy local thì dùng SQLite.

App không tự gọi model AI nào và không dùng API trả phí. Claude làm việc **trên** DMI qua connector MCP, bằng gói Claude của từng người.

## Chạy trên máy (macOS)

Yêu cầu **Node.js 22.13+** (`brew install node`).

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

Công cụ: tìm kiếm, công việc (xem, tạo, sửa, bình luận, chuyển bước quy trình), dịch vụ, nhân sự, khách hàng. Mỗi người kết nối từ **Hồ sơ → Kết nối Claude** và thu hồi được ở đó.

## Trợ lý AI trong DMI

Nút ✦ trên thanh trên cùng (⌘J): chat với Claude, dùng chung bộ công cụ với connector MCP và đúng quyền của người đang chat; thay đổi nào cũng chờ người dùng Duyệt. Gọi Claude API (tính phí theo token, cần `ANTHROPIC_API_KEY`, xem [DEPLOY.md](DEPLOY.md)). Code: `server/assistant.ts`, `web/src/components/Assistant.tsx`.

## Kiến trúc

```
server/                 Node + TypeScript (chạy bằng tsx), không framework
  index.ts              HTTP server local: REST API, /assets (hỗ trợ Range), phục vụ giao diện
  worker.ts             Cloudflare Workers: static assets + API, dùng D1 và Google Drive
  app.ts / routes.ts    Pipeline API (guard, nhật ký) và đăng ký các module
  mcp.ts, mcp-kit.ts    Connector Claude: OAuth (đăng ký app, cho phép, token, thu hồi) và công cụ MCP
  drive-links.ts        Link Google Drive dán vào DMI: id và tài khoản Google mở được
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
