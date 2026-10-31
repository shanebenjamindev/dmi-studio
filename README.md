# DM Studio — Detailers Movement

Ứng dụng **full-stack** làm video bằng AI: gõ ý tưởng, AI viết kịch bản, các model video/ảnh tạo cảnh nền, AI đọc lời thoại. Trình duyệt dựng chữ, chuyển động, logo và nhạc, rồi xuất **MP4**. Mọi thứ được lưu trên server của bạn.

## Chạy trên máy (macOS)

Yêu cầu **Node.js 22.13+**: `node -v` (nâng cấp bằng `brew install node`). Nếu có **ffmpeg** (`brew install ffmpeg`), file xuất sẽ tự chuyển sang MP4 chuẩn H.264.

```bash
cd ~/DMIStudio
npm install
cp .env.example .env        # điền key (hoặc nhập sau trong ⚙︎ Cài đặt)
npm start                   # build giao diện + chạy server → http://localhost:5173
```

- `npm run demo`: chạy với nhà cung cấp **demo** (không cần key), để thử toàn bộ quy trình.
- `npm run dev`: chế độ phát triển, tự build lại khi sửa code.

## Nền tảng AI được hỗ trợ

| Việc | Nền tảng | Biến môi trường |
|---|---|---|
| Viết kịch bản | **Claude** (Sonnet/Opus/Haiku 5.5, Fable 5.1) | `ANTHROPIC_API_KEY` |
| | **GPT** (GPT-5.5, GPT-6.1 Sol, GPT-6 Astra, 5.4 mini) | `OPENAI_API_KEY` |
| | **OpenRouter**: Gemini, DeepSeek, Llama… (dán model ID) | `OPENROUTER_API_KEY` |
| Clip video | **Seedance** 1.0 Pro/Lite (BytePlus ModelArk) | `ARK_API_KEY` |
| | **Higgsfield** (endpoint ID, vd. `alibaba/happy-horse/text-to-video`) | `HIGGSFIELD_API_KEY` = `KEY_ID:KEY_SECRET` |
| | **fal.ai**: Kling 2.1, Veo 3, Seedance… | `FAL_KEY` |
| Ảnh tĩnh | **GPT Image 2 / 1.5**, **FLUX** (fal.ai) | `OPENAI_API_KEY`, `FAL_KEY` |
| Giọng đọc | **OpenAI TTS** `gpt-4o-mini-tts` (11 giọng) | `OPENAI_API_KEY` |

Mỗi nền tảng đều có mục **„＋ Model khác…“** để dán model hoặc endpoint ID mới, không cần sửa code. Ví dụ: Seedance 2.x, các endpoint khác của Higgsfield, hay model mới trên fal.ai và OpenRouter. Danh sách mặc định nằm trong `server/providers/registry.ts`.

## Kiến trúc

```
server/                 Node + TypeScript (chạy bằng tsx), không framework
  index.ts              HTTP server: REST API, /assets (hỗ trợ Range), phục vụ giao diện
  routes.ts             /api/projects, /api/ai/*, /api/jobs, /api/renders, /api/settings
  db.ts                 SQLite tích hợp sẵn của Node (node:sqlite): projects, jobs, assets, renders, settings, ai_calls
  jobs.ts               Worker nền: gửi job → poll → tải file về → gắn vào cảnh (vẫn chạy khi đóng trình duyệt)
  storyboard.ts         Schema JSON chung cho mọi model + bộ nhận diện thương hiệu Detailers Movement
  providers/
    registry.ts         Danh mục nền tảng/model, quản lý API key (không bao giờ gửi về trình duyệt)
    llm.ts              Claude (tool use) + chuẩn OpenAI (GPT, OpenRouter): buộc trả JSON
    media.ts            Seedance, Higgsfield, fal.ai, GPT Image, OpenAI TTS
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
- API key được lưu dạng văn bản trong `data/studio.db` trên máy bạn. Đừng chia sẻ thư mục `data/`.
- Mặc định server chỉ nghe trên `127.0.0.1`. Muốn mở cho máy khác trong mạng thì đặt `HOST=0.0.0.0`, nhưng app **chưa có đăng nhập**.
# dmi-studio
