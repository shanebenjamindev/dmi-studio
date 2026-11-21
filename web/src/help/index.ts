// Trợ giúp's articles in Vietnamese and English, in their groups and order: getting started, then the manual (made
// from the user manual by scripts/guide/help.mjs), Trang chủ, and Tự động hoá. An article has the same address in both
// languages; each is shown at #help/<slug> (components/Help.tsx). Only the language being read is downloaded.
import type { Article } from './types';

const HOME: Article = {
  slug: 'trang-chu', cat: 'Bắt đầu', title: 'Trang chủ và widget',
  html: `
<p><b>Trang chủ</b> (biểu tượng ngôi nhà, mục đầu tiên của menu) là trang mở ra sau khi đăng nhập: công việc của bạn trong ngày, gom thành các <b>widget</b> mà bạn tự chọn và sắp xếp. Cách bày trí được lưu theo tài khoản, mở máy khác vẫn giữ nguyên.</p>
<h3>Thêm widget</h3>
<ol>
  <li>Bấm <b>Thêm widget</b> ở góc trên bên phải.</li>
  <li>Chọn một loại: Công việc cần làm, Cần làm hôm nay, Cần làm trong tuần, Việc quá hạn, Chờ tôi duyệt, Công việc tôi giao, Việc tôi theo dõi, Tổng quan khách hàng, Tổng quan dịch vụ, Nhân viên của tôi (chỉ trưởng phòng / trưởng nhóm xem được).</li>
  <li>Cửa sổ <b>Sửa widget</b> mở ra: đặt tên, chọn một khách hàng để lọc, chọn <b>Kiểu hiển thị</b> (danh sách / bảng, hoặc biểu đồ: cột theo bước, cột theo hạn, lịch hạn 14 ngày, biểu đồ tròn, thanh theo khách hàng, thanh chồng, cột dọc, số liệu) và các trường hoặc cột muốn hiện. Bấm <b>Lưu</b>.</li>
</ol>
<h3>Trên mỗi widget</h3>
<ul>
  <li><b>⠿</b> (tay nắm): kéo để đổi chỗ. Khi kéo có <b>bóng xem trước</b> chỗ sẽ thả; thả cạnh một widget là vào chung hàng, thả vào khe giữa hai hàng là thành hàng mới. Các widget trong một hàng (tối đa 4) tự chia đều độ rộng.</li>
  <li><b>Đồng bộ</b> (mũi tên vòng): tải lại dữ liệu của widget ngay.</li>
  <li><b>Mở rộng</b>: xem widget toàn khung, hiện đủ mọi dòng; Esc hoặc ✕ để thu nhỏ.</li>
  <li><b>⋯</b>: Sửa widget hoặc Xoá widget.</li>
  <li>Bấm tên widget để mở trang đầy đủ (ví dụ trang Công việc).</li>
</ul>
<aside class="tip"><b>Khôi phục</b> — Trong cửa sổ Thêm widget có nút <b>Khôi phục mặc định</b> để đưa Trang chủ về như ban đầu.</aside>
<h3>Trên điện thoại</h3>
<p>Thanh dưới có năm ô: <b>Trang chủ</b>, <b>Workspace</b>, <b>Công việc</b>, <b>Nhắc việc</b> và <b>Thêm</b>. Khách hàng, Tin nhắn, Hộp thư, Báo cáo, Tools, Quản trị, Board Game, Trợ giúp và Hỗ trợ nằm trong <b>Thêm</b>. Widget xếp một cột.</p>`,
};

const HOME_EN: Article = {
  slug: 'trang-chu', cat: 'Getting started', title: 'Home and widgets',
  html: `
<p><b>Home</b> (the house icon, first in the menu) is the page that opens after signing in: your work of the day, in <b>widgets</b> you choose and arrange. The layout is saved with your account, so it looks the same on any device.</p>
<h3>Adding a widget</h3>
<ol>
  <li>Press <b>Add widget</b> at the top right.</li>
  <li>Pick a kind: Tasks to do, Due today, Due this week, Overdue tasks, Waiting for my review, Tasks I gave out, Tasks I follow, Clients overview, Services overview, My people (department and team heads only).</li>
  <li>The <b>Edit widget</b> window opens: give it a name, pick one client to filter by, choose its <b>Display</b> (a list / table, or a chart: columns by step, columns by due date, the next 14 days, donut, bars by client, stacked bars, columns, numbers) and the fields or columns to show. Press <b>Save</b>.</li>
</ol>
<h3>On each widget</h3>
<ul>
  <li><b>⠿</b> (handle): drag to move it. While dragging, a <b>shadow previews</b> where it lands; drop it beside a widget to share that row, or between rows for a row of its own. Widgets in a row (up to 4) share its width equally.</li>
  <li><b>Sync</b> (circular arrow): reload the widget now.</li>
  <li><b>Expand</b>: see the widget full size with every row; Esc or ✕ to close.</li>
  <li><b>⋯</b>: Edit widget or Remove widget.</li>
  <li>Click the widget's title to open the full page (for example Tasks).</li>
</ul>
<aside class="tip"><b>Reset</b> — The Add widget window has a <b>Restore defaults</b> button to put Home back as it was.</aside>
<h3>On a phone</h3>
<p>The bottom bar has five cells: <b>Home</b>, <b>Workspace</b>, <b>Tasks</b>, <b>Reminders</b> and <b>More</b>. Clients, Messages, Mailbox, Reports, Tools, Admin, Board Game, Help and Support are under <b>More</b>. Widgets stack in one column.</p>`,
};

const EDITIONS = {
  vi: async () => {
    const [{ MANUAL }, { AUTOMATION }] = await Promise.all([import('./manual'), import('./automation')]);
    return { order: ['Bắt đầu', 'Hướng dẫn theo mục', 'Tự động hoá', 'Việc thường làm', 'Dữ liệu, quyền, báo cáo', 'Hỏi đáp'], all: [...MANUAL.slice(0, 3), HOME, ...MANUAL.slice(3), ...AUTOMATION] };
  },
  en: async () => {
    const [{ MANUAL_EN }, { AUTOMATION_EN }] = await Promise.all([import('./manual-en'), import('./automation-en')]);
    return { order: ['Getting started', 'Feature by feature', 'Automation', 'Common tasks', 'Data, access, reports', 'FAQ'], all: [...MANUAL_EN.slice(0, 3), HOME_EN, ...MANUAL_EN.slice(3), ...AUTOMATION_EN] };
  },
};
/** The articles in one language, in order, and in their groups. */
export async function helpFor(lang: 'vi' | 'en') {
  const e = await EDITIONS[lang](), articles = e.order.flatMap((c) => e.all.filter((a) => a.cat === c));
  return { articles, groups: e.order.map((title) => ({ title, articles: articles.filter((a) => a.cat === title) })).filter((g) => g.articles.length) };
}
export type { Article };
