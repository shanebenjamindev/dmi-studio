// Builds the user guide package in docs/huong-dan-dmi-workspace from its sources (nguon/), the screenshots of
// shots.mjs and the scenes of video.mjs: the manual, quick start and FAQ as HTML and PDF, the video's narration script,
// storyboard and recording checklist, its cover picture, and the index.
//   PLAYWRIGHT=…/playwright-core node scripts/guide/build.mjs [video-workdir]
// With --en it builds the English edition in en/ instead (manual, quick start and FAQ; there is no English video):
//   PLAYWRIGHT=…/playwright-core node scripts/guide/build.mjs --en
import fs from 'node:fs';
import path from 'node:path';
import { SHOTS } from './shots.mjs';
import { SHOTS_EN } from './en.mjs';
import { SCENES, SHOW } from './video.mjs';

const ROOT = path.resolve('docs/huong-dan-dmi-workspace');
const VERSION = '2.0', DATE = '09/11/2026';
/** What differs between the two editions: where they live, and the few words the build itself writes. */
const LANGS = {
  vi: { root: ROOT, src: 'nguon', img: 'anh', plain: 'goc', lang: 'vi', date: DATE, contents: ['muc-luc', 'Mục lục'], version: 'phiên bản', page: ['Trang', '/'],
    shot: (id) => { const s = SHOTS.find((x) => x.id === id); return s && { title: s.title, notes: s.notes.map(([, text]) => text) }; } },
  en: { root: path.join(ROOT, 'en'), src: 'source', img: 'images', plain: 'plain', lang: 'en', date: '9 November 2026', contents: ['contents', 'Contents'], version: 'version', page: ['Page', 'of'],
    shot: (id) => SHOTS_EN[id] },
};
const VI = LANGS.vi, SRC = path.join(ROOT, VI.src);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const CSS = `
:root{--blue:#0b6fd8;--ink:#1d2433;--muted:#5d6678;--line:#dfe3ea;--soft:#f4f7fb;--orange:#F05A28}
*{box-sizing:border-box} body{margin:0;color:var(--ink);font:15px/1.6 -apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:#fff}
main{max-width:920px;margin:0 auto;padding:40px 28px 80px}
h2{margin:48px 0 14px;padding-bottom:8px;border-bottom:3px solid var(--blue);font-size:26px;color:#0c2d5e;page-break-before:always;break-before:page}
h3{margin:30px 0 10px;font-size:19px;color:#0c2d5e} h4{margin:22px 0 8px;font-size:16px}
p,li,dd{orphans:3;widows:3} h2,h3,h4,dt,p:has(+ figure),p:has(+ .pair){break-after:avoid} ul,ol{padding-left:22px} li{margin:3px 0}
code{padding:1px 5px;border-radius:4px;background:var(--soft);font-size:.92em}
table{width:100%;border-collapse:collapse;margin:12px 0 18px;font-size:14px;break-inside:avoid}
th,td{padding:7px 10px;border:1px solid var(--line);text-align:left;vertical-align:top} th{background:var(--soft);color:#0c2d5e}
figure{margin:18px 0 22px;break-inside:avoid} figure img{display:block;width:100%;border:1px solid var(--line);border-radius:8px;box-shadow:0 2px 10px rgba(16,40,80,.08)}
figcaption{margin-top:8px;font-weight:600;color:#0c2d5e} figcaption small{font-weight:400;color:var(--muted)}
ol.legend{list-style:none;margin:8px 0 0;padding:0;font-size:14px;columns:2;column-gap:28px}
ol.legend li{position:relative;min-height:24px;padding-left:32px;margin:0 0 6px;break-inside:avoid}
ol.legend li b{position:absolute;left:0;top:1px;width:22px;height:22px;border-radius:50%;background:var(--orange);color:#fff;font-size:12px;line-height:22px;text-align:center}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start} .pair ol.legend{columns:1}
.pair figure img{max-height:520px;object-fit:contain}
aside{margin:14px 0;padding:10px 14px 10px 16px;border-left:4px solid;border-radius:6px;font-size:14px;break-inside:avoid}
aside.tip{border-color:#1f9d55;background:#ecf8f1} aside.warn{border-color:#d9822b;background:#fff4e8} aside.note{border-color:var(--blue);background:#eaf3fe}
.task{margin:18px 0;padding:6px 18px 10px;border:1px solid var(--line);border-radius:10px;background:#fbfcfe;break-inside:avoid}
.task h3{margin-top:12px}
.flow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0;font-weight:600;color:var(--muted)}
.flow span{padding:6px 12px;border-radius:8px;background:var(--soft);border:1px solid var(--line);color:#0c2d5e}
dl.faq dt{margin-top:14px;font-weight:600;color:#0c2d5e} dl.faq dd{margin:4px 0 0}
dl.glossary{display:grid;grid-template-columns:180px 1fr;gap:6px 16px} dl.glossary dt{font-weight:600} dl.glossary dd{margin:0}
nav.toc{break-before:page;break-after:page} nav.toc h2{page-break-before:avoid;break-before:avoid}
nav.toc ol{list-style:none;padding:0} nav.toc li{margin:4px 0} nav.toc a{color:var(--ink);text-decoration:none} nav.toc ol ol{padding-left:22px;font-size:14px;color:var(--muted)}
nav.toc>ol>li{margin-top:10px;font-weight:600} nav.toc ol ol a{color:var(--muted);font-weight:400}
.cover{min-height:calc(297mm - 40mm);display:flex;flex-direction:column;justify-content:center;padding:40px;border-radius:18px;
  background:radial-gradient(900px 500px at 25% 15%,#2f8cff 0%,#0b5fd6 45%,#063a8c 100%);color:#fff;break-after:page}
.cover-logo{height:56px;filter:brightness(0) invert(1);align-self:flex-start;margin-bottom:60px}
.cover-kicker{margin:0;font-size:20px;letter-spacing:.2em;text-transform:uppercase;opacity:.85} .cover-title{margin:6px 0 10px;font-size:64px;border:0;padding:0;color:#fff;page-break-before:avoid;break-before:avoid}
.cover-sub{font-size:20px;opacity:.92;max-width:560px} .cover-meta{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin-top:70px;font-size:15px}
.cover-meta dt{opacity:.75} .cover-meta dd{margin:0;font-weight:600}
.front h2{page-break-before:avoid;break-before:avoid}
.doc-head{display:flex;align-items:center;gap:14px;margin-bottom:8px} .doc-head img{height:34px} .doc-head span{color:var(--muted)}
h1.doc-title{margin:6px 0 4px;font-size:32px;color:#0c2d5e} .lead{font-size:17px;color:var(--muted)}
ol.steps{list-style:none;counter-reset:s;padding:0} ol.steps>li{counter-increment:s;position:relative;padding-left:46px;margin:18px 0;break-inside:avoid}
ol.steps>li::before{content:counter(s);position:absolute;left:0;top:2px;width:32px;height:32px;border-radius:50%;background:var(--blue);color:#fff;font-weight:700;text-align:center;line-height:32px}
ol.steps h3{margin:4px 0 6px}
.single h2{page-break-before:auto;break-before:auto}
@media print{main{padding:0;max-width:none} a{color:inherit}}
`;

/** A screenshot with its title and the meaning of each number on it. */
function figure(L, id, plain = false) {
  const s = L.shot(id);
  if (!s) throw new Error(`No screenshot ${id}`);
  const legend = !plain && s.notes.length ? `<ol class="legend">${s.notes.map((text, i) => `<li><b>${i + 1}</b>${esc(text)}</li>`).join('')}</ol>` : '';
  return `<figure id="anh-${id}"><img src="${L.img}/${plain ? L.plain + '/' : ''}${id}.png" alt="${esc(s.title)}"><figcaption>${esc(s.title)}</figcaption>${legend}</figure>`;
}
const fill = (L, html) => html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<div data-include="([a-z-]+)"><\/div>/g, (_, f) => fs.readFileSync(path.join(L.root, L.src, `${f}.html`), 'utf8').replace(/<!--[\s\S]*?-->/g, ''))
  .replace(/<figure data-shot="([^"]+)"( data-plain)?><\/figure>/g, (_, id, plain) => figure(L, id, !!plain));

/** Headings get ids, and the table of contents lists the numbered sections and their parts. */
function toc(L, html) {
  const items = []; let cur = null;
  html = html.replace(/<h([23])(?![^>]*no-toc)([^>]*)>([\s\S]*?)<\/h\1>/g, (all, lvl, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    let id = attrs.match(/id="([^"]+)"/)?.[1];
    if (!id) { id = slug(text); attrs += ` id="${id}"`; }
    if (lvl === '2') { cur = { id, text, kids: [] }; items.push(cur); } else if (cur && !/class="[^"]*task/.test(attrs)) cur.kids.push({ id, text });
    return `<h${lvl}${attrs}>${inner}</h${lvl}>`;
  });
  const list = `<h2 class="no-toc" id="${L.contents[0]}">${L.contents[1]}</h2><ol>${items.map((i) => `<li><a href="#${i.id}">${esc(i.text)}</a>${i.kids.length ? `<ol>${i.kids.map((k) => `<li><a href="#${k.id}">${esc(k.text)}</a></li>`).join('')}</ol>` : ''}</li>`).join('')}</ol>`;
  return html.replace('<nav class="toc" data-toc></nav>', `<nav class="toc">${list}</nav>`);
}
const page = (L, title, body, cls = '') => `<!doctype html><html lang="${L.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main class="${cls}">${body}</main></body></html>`;
const header = (L, title) => `<div class="doc-head"><img src="${L.img}/logo.png" alt="DMI Workspace"><span>DMI Workspace · ${L.version} ${VERSION} · ${L.date}</span></div><h1 class="doc-title">${esc(title)}</h1>`;

async function pdf(L, browser, file, title) {
  const p = await browser.newPage();
  await p.goto('file://' + path.join(L.root, file), { waitUntil: 'load' });
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: path.join(L.root, file.replace(/\.html$/, '.pdf')), format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
    displayHeaderFooter: true, headerTemplate: '<div></div>',
    footerTemplate: `<div style="font:8px -apple-system,Segoe UI,sans-serif;width:100%;padding:0 16mm;display:flex;justify-content:space-between;color:#7a8394"><span>${esc(title)} · v${VERSION}</span><span>${L.page[0]} <span class="pageNumber"></span> ${L.page[1]} <span class="totalPages"></span></span></div>` });
  await p.close();
}

// ------------------------------------------------------------------------------------------------ video papers
const time = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function videoPapers(work) {
  const timing = {}; let at = 0;
  for (const s of SCENES) {
    const f = work && path.join(work, 'scenes', s.id, 'timeline.json');
    if (f && fs.existsSync(f)) { const t = JSON.parse(fs.readFileSync(f, 'utf8')); timing[s.id] = { start: at, length: t.end, cues: t.cues }; at += t.end; }
  }
  const when = (id) => (timing[id] ? `${time(timing[id].start)}–${time(timing[id].start + timing[id].length)}` : '—');
  const script = ['# Kịch bản lời đọc — Video hướng dẫn DMI Workspace', '', `Phiên bản ${VERSION} · ${DATE} · Giọng đọc: Linh (tiếng Việt, macOS), tốc độ 170 từ/phút.`, '',
    ...SCENES.flatMap((s, i) => [`## ${i + 1}. ${s.title} (${when(s.id)})`, '', ...s.beats.flatMap((b) => b.say.map((t) => `- ${t}`)), ''])].join('\n');
  const board = ['# Storyboard — Video hướng dẫn DMI Workspace', '', `Khung hình 1920 × 1080, 30 hình/giây. Quay thật trên công ty mẫu (dữ liệu giả), tài khoản quản trị viên “Nguyễn Văn An”. Hiệu ứng: con trỏ vẽ di chuyển mượt tới chỗ thao tác, vòng sáng khi bấm, khung cam tô sáng, phóng to vùng cần xem kỹ; chuyển cảnh mờ dần qua đen (0,45 giây) giữa các chương; phụ đề trắng trên nền đen mờ ở cuối khung.`, '',
    ...SCENES.flatMap((s, i) => [`## Cảnh ${i + 1} — ${s.title} (${when(s.id)})`, '', `Màn hình mở đầu: ${s.card ? 'thẻ tiêu đề' : s.user === null ? 'trang đăng nhập (chưa đăng nhập)' : s.start === 'board' ? 'board “Kế hoạch Marketing tháng 11”' : `trang ${s.start || 'đăng nhập'}`}`, '',
      '| Nhịp | Lời đọc | Trên màn hình |', '|---|---|---|',
      ...s.beats.map((b, k) => `| ${k + 1} | ${b.say.join(' ').replace(/\|/g, '/')} | ${(SHOW[s.id]?.[k] || '').replace(/\|/g, '/')} |`), ''])].join('\n');
  return { script, board, total: at };
}

const CHECKLIST = `# Checklist quay và dựng video

Video được quay tự động bằng script, nên “quay lại” nghĩa là chạy lại các lệnh dưới đây. Mọi thứ chạy trên một server thử với dữ liệu giả, **không bao giờ** trên server thật hay Google Drive thật.

## Trước khi quay
- [ ] Máy Mac có Google Chrome, giọng đọc tiếng Việt “Linh” (Cài đặt hệ thống › Trợ năng › Nội dung được đọc), và \`npm install\` đã chạy (có ffmpeg-static).
- [ ] Cài playwright-core vào một thư mục tạm (không cài vào project), ví dụ \`npm i playwright-core --prefix /tmp/pw\`.
- [ ] Khởi động server thử với thư mục dữ liệu và Drive tạm, ví dụ: \`DATA_DIR=/tmp/guide DRIVE_DIR=/tmp/guide/workspace PORT=5394 npx tsx server/index.ts\`.
- [ ] Tạo công ty mẫu: \`node scripts/guide/seed.mjs http://127.0.0.1:5394\` (chỉ chạy một lần trên thư mục dữ liệu mới).
- [ ] Tắt thông báo hệ thống, cắm sạc; lệnh quay chạy kèm \`caffeinate\` để máy không ngủ giữa chừng.

## Chụp ảnh và quay
- [ ] Ảnh: \`PLAYWRIGHT=/tmp/pw/node_modules/playwright-core/index.mjs node scripts/guide/shots.mjs http://127.0.0.1:5394 docs/huong-dan-dmi-workspace/anh\`. Mỗi dòng in ra phải là “x/x” (đủ số chú thích).
- [ ] Quay **sau** khi chụp ảnh (cảnh quay có thêm thẻ, khách, công việc vào dữ liệu mẫu): \`caffeinate -dimsu node scripts/guide/video.mjs record http://127.0.0.1:5394 /tmp/video-work\`. Không có dòng lỗi nào in ra trong lúc quay.
- [ ] Dựng: \`node scripts/guide/video.mjs build /tmp/video-work docs/huong-dan-dmi-workspace/video\`.
- [ ] Tài liệu: \`node scripts/guide/build.mjs /tmp/video-work\`.

## Kiểm tra trước khi phát hành
- [ ] Xem hết video: lời đọc khớp thao tác, không có khoảng lặng dài, phụ đề không che nút đang nói tới.
- [ ] Mở các mốc trong \`chuong.txt\`: mỗi mốc rơi đúng đầu chương.
- [ ] Không có dữ liệu thật (tên khách, email, số điện thoại) trong ảnh hay video.
- [ ] Tên nút trong lời đọc trùng với giao diện (Thêm mới, Tạo công việc, Di chuyển…).
- [ ] Sổ tay: mọi ảnh có số đều có danh sách giải thích; các mục “Chưa kiểm chứng” vẫn đúng.
- [ ] Khi giao diện thay đổi: sửa \`shots.mjs\` / \`video.mjs\` / \`nguon/*.html\`, rồi chạy lại toàn bộ.

## Bản tiếng Anh (en/)
- [ ] Dùng một server thử **khác** với dữ liệu tạm mới (mỗi tài khoản nhớ ngôn ngữ của nó, dùng chung sẽ chụp sai ngôn ngữ), rồi chạy \`seed.mjs\` như trên.
- [ ] Ảnh: \`node scripts/guide/shots.mjs --en http://127.0.0.1:5397 docs/huong-dan-dmi-workspace/en/images\` (chữ trên ảnh nằm trong \`scripts/guide/en.mjs\`).
- [ ] Tài liệu: \`node scripts/guide/build.mjs --en\` (nguồn ở \`en/source/\`).
`;

const THUMB = (logo) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:720px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:radial-gradient(900px 520px at 20% 20%,#2f8cff 0%,#0b5fd6 50%,#063a8c 100%);color:#fff;position:relative}
.t{position:absolute;left:64px;top:84px;width:560px} img.l{height:46px;filter:brightness(0) invert(1)} .k{margin-top:46px;font-size:24px;letter-spacing:.16em;text-transform:uppercase;opacity:.85}
h1{margin:10px 0 18px;font-size:84px;line-height:1;letter-spacing:-.02em} p{margin:0;font-size:28px;opacity:.95} .tag{display:inline-block;margin-top:34px;padding:10px 20px;border-radius:999px;background:#F05A28;font-weight:700;font-size:24px}
.shot{position:absolute;right:-60px;top:120px;width:680px;border-radius:14px;box-shadow:0 30px 70px rgba(0,0,0,.45);transform:rotate(-4deg)}</style></head>
<body><div class="t"><img class="l" src="${logo}"><div class="k">Hướng dẫn sử dụng</div><h1>DMI Workspace</h1><p>Board · Công việc · Dự án · Khách hàng</p><span class="tag">Từ A đến Z cho người mới</span></div>
<img class="shot" src="anh/05-board.png"></body></html>`;

// ------------------------------------------------------------------------------------------------ build
export async function buildAll(work) {
  fs.copyFileSync(path.resolve('web/public/brand/logo.png'), path.join(ROOT, 'anh', 'logo.png'));
  const manual = toc(VI, fill(VI, fs.readFileSync(path.join(SRC, 'so-tay.html'), 'utf8')));
  fs.writeFileSync(path.join(ROOT, 'so-tay-dmi-workspace.html'), page(VI, 'Sổ tay sử dụng DMI Workspace', manual));
  fs.writeFileSync(path.join(ROOT, 'bat-dau-nhanh.html'), page(VI, 'Bắt đầu nhanh với DMI Workspace', header(VI, 'Bắt đầu nhanh') + fill(VI, fs.readFileSync(path.join(SRC, 'bat-dau-nhanh.html'), 'utf8')), 'single'));
  fs.writeFileSync(path.join(ROOT, 'hoi-dap.html'), page(VI, 'Hỏi đáp và khắc phục sự cố — DMI Workspace', header(VI, 'Hỏi đáp và khắc phục sự cố') + fill(VI, fs.readFileSync(path.join(SRC, 'hoi-dap.html'), 'utf8')), 'single'));
  const v = videoPapers(work);
  fs.mkdirSync(path.join(ROOT, 'video'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'video', 'kich-ban-loi-doc.md'), v.script);
  fs.writeFileSync(path.join(ROOT, 'video', 'storyboard.md'), v.board);
  fs.writeFileSync(path.join(ROOT, 'video', 'checklist-quay.md'), CHECKLIST);
  fs.writeFileSync(path.join(ROOT, 'video', 'y-tuong-anh-bia.md'), `# Ý tưởng ảnh bìa video\n\nNền xanh thương hiệu (giống thẻ mở đầu video), logo trắng góc trên trái, chữ lớn “DMI Workspace” với dòng nhỏ “Hướng dẫn sử dụng” phía trên và “Board · Công việc · Dự án · Khách hàng” phía dưới; nhãn cam “Từ A đến Z cho người mới”. Bên phải: ảnh chụp thật của một board (cột Cần làm / Đang làm / Xong có màu), nghiêng nhẹ, đổ bóng. Kích thước 1280 × 720, chữ đọc được khi thu nhỏ còn 320 px.\n\nTệp: \`anh-bia.png\` (tạo bởi scripts/guide/build.mjs).\n`);
  const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  await pdf(VI, browser, 'so-tay-dmi-workspace.html', 'Sổ tay sử dụng DMI Workspace');
  await pdf(VI, browser, 'bat-dau-nhanh.html', 'Bắt đầu nhanh với DMI Workspace');
  await pdf(VI, browser, 'hoi-dap.html', 'Hỏi đáp và khắc phục sự cố');
  const t = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  fs.writeFileSync(path.join(ROOT, '.thumb.html'), THUMB('anh/logo.png'));
  await t.goto('file://' + path.join(ROOT, '.thumb.html')); await t.waitForTimeout(300);
  await t.screenshot({ path: path.join(ROOT, 'video', 'anh-bia.png') }); fs.rmSync(path.join(ROOT, '.thumb.html'));
  await browser.close();
  return { videoSeconds: v.total, shots: SHOTS.length };
}

/** The English edition: the manual, quick start and FAQ from en/source, with the English screenshots of en/images. */
export async function buildEnglish() {
  const L = LANGS.en, read = (f) => fs.readFileSync(path.join(L.root, L.src, f), 'utf8');
  fs.copyFileSync(path.resolve('web/public/brand/logo.png'), path.join(L.root, L.img, 'logo.png'));
  fs.writeFileSync(path.join(L.root, 'user-manual.html'), page(L, 'DMI Workspace User Manual', toc(L, fill(L, read('user-manual.html')))));
  fs.writeFileSync(path.join(L.root, 'quick-start.html'), page(L, 'DMI Workspace Quick Start', header(L, 'Quick start') + fill(L, read('quick-start.html')), 'single'));
  fs.writeFileSync(path.join(L.root, 'faq.html'), page(L, 'DMI Workspace Troubleshooting and FAQ', header(L, 'Troubleshooting and FAQ') + fill(L, read('faq.html')), 'single'));
  const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  await pdf(L, browser, 'user-manual.html', 'DMI Workspace User Manual');
  await pdf(L, browser, 'quick-start.html', 'DMI Workspace Quick Start');
  await pdf(L, browser, 'faq.html', 'DMI Workspace Troubleshooting and FAQ');
  await browser.close();
  return { shots: Object.keys(SHOTS_EN).length };
}

if (import.meta.url === `file://${process.argv[1]}`) (process.argv[2] === '--en' ? buildEnglish() : buildAll(process.argv[2])).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e); process.exit(1); });
