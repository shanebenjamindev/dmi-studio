// The tutorial video, recorded on the demo company of seed.mjs (a scratch server, never the real one): each scene is
// the real app driven by Playwright, with a drawn cursor, highlights and zooms, narrated by macOS's Vietnamese voice
// (Linh), with burned-in subtitles, fades between chapters and chapter marks. The script, storyboard and subtitles are
// written from the same SCENES, so the video and its papers say the same thing.
//   PLAYWRIGHT=…/playwright-core node scripts/guide/video.mjs record http://127.0.0.1:5394 <workdir>
//   node scripts/guide/video.mjs build <workdir> docs/huong-dan-dmi-workspace/video
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const FFMPEG = createRequire(import.meta.url)('ffmpeg-static');
const W = 1600, H = 900, SCALE = 1.2; // 1920 × 1080 frames
const PASSWORD = 'demo-12345';
const VOICE = 'Linh', RATE = '170';

// ------------------------------------------------------------------------------------------------ the scenes
const tile = (name) => (p) => p.locator('.bd-tile', { hasText: name }).first();
const css = (s, has) => (p) => (has ? p.locator(s, { hasText: has }) : p.locator(s)).first();
const byText = (t) => (p) => p.getByText(t, { exact: true }).first();
const button = (name) => (p) => p.getByRole('button', { name }).first();

export const SCENES = [
  { id: 'mo-dau', title: 'Giới thiệu', card: { kicker: 'Hướng dẫn sử dụng', title: 'DMI Workspace', lines: ['Khách hàng · Dự án · Công việc', 'trên cùng một chỗ'] }, beats: [
    { say: ['Chào mừng bạn đến với DMI Workspace.', 'Đây là nơi cả công ty quản lý khách hàng, dự án và công việc hằng ngày trên cùng một hệ thống.'] },
    { say: ['Video này đi từ lúc đăng nhập, làm quen giao diện, đến những thao tác bạn sẽ dùng mỗi ngày.'] },
  ] },
  { id: 'dang-nhap', title: 'Đăng nhập', user: null, start: '', beats: [
    { say: ['Mở địa chỉ DMI Workspace mà công ty cung cấp.', 'Nhập email và mật khẩu quản trị viên đã cấp cho bạn.'], do: async (g) => {
      await g.type(css('.login-card input[type=email]'), 'an@demo.dmi'); await g.type(css('.login-pass input'), PASSWORD);
      await g.click(css('.login-pass .bd-icon')); await g.wait(700); await g.click(css('.login-pass .bd-icon')); } },
    { say: ['Nếu quên mật khẩu, bấm Quên mật khẩu, nhập email đăng nhập rồi bấm Gửi link đặt lại.', 'Link trong email chỉ dùng được một lần, trong ba mươi phút.'], do: async (g) => {
      await g.click(css('.login-switch')); await g.click(css('.login-card .btn-primary')); await g.wait(1600); await g.hl(css('.login-note'), 2200); await g.click(css('.login-switch')); } },
    { say: ['Quay lại trang đăng nhập và bấm Đăng nhập.'], do: async (g) => {
      await g.type(css('.login-pass input'), PASSWORD); await g.click(css('.login-card .btn-primary')); await g.wait(2200); } },
  ] },
  { id: 'giao-dien', title: 'Làm quen giao diện', user: 'an', start: '#boards', beats: [
    { say: ['Bên trái là menu chính: Workspace, Khách hàng, Công việc, Báo cáo, Tools và Quản trị.', 'Bạn chỉ thấy những mục mình được cấp quyền.'], do: async (g) => { await g.hl(css('.rail'), 4200); } },
    { say: ['Ô ở giữa thanh trên dùng để tìm mọi thứ: khách hàng, công việc, dự án, board và ghi chú.'], do: async (g) => { await g.hl(css('.app-search'), 3500); } },
    { say: ['Phía bên phải là Messenger để nhắn tin với đồng nghiệp, ghi chú nhanh, chuông thông báo, chế độ sáng tối, và tài khoản của bạn.'], do: async (g) => {
      for (const s of ['.app-head-right button', '[aria-label="Tạo ghi chú nhanh"]', '.notification-bell', '.tb-theme', '.tb-user']) await g.hl(css(s), 1300); } },
    { say: ['Ở góc dưới bên trái có nút Hỗ trợ để gửi câu hỏi cho lập trình viên, và nút Nhắc việc, nơi gom các việc mới được giao, trễ hạn và đến hạn hôm nay.'], do: async (g) => { await g.hl(css('.sp-button'), 2600); await g.hl(css('.rm-button'), 3000); } },
  ] },
  { id: 'board', title: 'Workspace và board', user: 'an', start: '#boards', beats: [
    { say: ['Mục Workspace hiển thị các board bạn được vào.', 'Mỗi ô cho biết tên board, quyền riêng tư và những người đang ở trong board.'], do: async (g) => { await g.zoom(tile('Kế hoạch Marketing'), 1.7); await g.wait(3200); await g.unzoom(); } },
    { say: ['Bấm vào một board để mở.', 'Mỗi cột là một bước trong quy trình của công việc: Cần làm, Đang làm và Xong.', 'Mỗi thẻ là một công việc.'], do: async (g) => {
      await g.click(tile('Kế hoạch Marketing')); await g.wait(1800); for (const n of ['Cần làm', 'Đang làm', 'Xong']) await g.hl(css('.bd-list', n), 1300); } },
    { say: ['Trên thẻ có nhãn màu, khách hàng, dự án, thời hạn, số việc cần làm đã xong, và người làm.'], do: async (g) => { await g.zoom(css('.bd-card', 'Chụp ảnh sản phẩm'), 1.8); await g.wait(4200); await g.unzoom(); } },
    { say: ['Để thêm công việc, bấm Thêm thẻ ở cuối cột, gõ tên rồi nhấn Enter.'], do: async (g) => {
      await g.click(css('.bd-list:has-text("Cần làm") .bd-add-card')); await g.page.keyboard.type('Chuẩn bị nội dung livestream', { delay: 45 }); await g.page.keyboard.press('Enter'); await g.wait(600); await g.page.keyboard.press('Escape'); } },
    { say: ['Bạn có thể tô màu cho cả cột: bấm nút ba chấm của cột, rồi chọn một màu trong mục Màu danh sách.'], do: async (g) => {
      await g.click((p) => p.locator('.bd-list', { hasText: 'Cần làm' }).first().locator('.bd-list-h .bd-icon').last()); await g.wait(500);
      await g.hl(css('.bk-colors'), 1200); await g.click(css('.bk-colors button[aria-label="Màu tím"]')); await g.wait(800); } },
  ] },
  { id: 'the', title: 'Làm việc với một thẻ', user: 'an', start: 'board', beats: [
    { say: ['Bấm vào thẻ để xem chi tiết.', 'Ở đây có khách hàng, dự án, người làm, nhãn và thời hạn của công việc.'], do: async (g) => {
      await g.click(css('.bd-card', 'Chụp ảnh sản phẩm')); await g.wait(1200); await g.hl(css('.cm div:has(> h4:text-is("Khách hàng"))'), 1400); await g.hl(css('.cm div:has(> h4:text-is("Thành viên"))'), 1400); await g.hl(css('.cm div:has(> h4:text-is("Ngày"))'), 1400); } },
    { say: ['Danh sách việc cần làm giúp chia nhỏ công việc.', 'Tích vào một mục khi bạn làm xong.'], do: async (g) => { await g.click(css('input.cm-check[aria-label="Danh sách góc chụp"]')); await g.wait(800); } },
    { say: ['Khung bên phải là bình luận và hoạt động.', 'Gõ bình luận rồi bấm Lưu, những người trong thẻ sẽ nhận được thông báo.'], do: async (g) => {
      await g.click(css('#card-comments .cm-comment-start')); await g.wait(500); await g.page.keyboard.type('Đã chuẩn bị xong danh sách góc chụp.', { delay: 45 }); await g.click(css('#card-comments .btn-primary', 'Lưu')); await g.wait(900); } },
    { say: ['Khi xong việc, bấm vào tên cột ở góc trên, chọn cột Xong, rồi bấm Di chuyển.', 'Trạng thái công việc tự chuyển thành Hoàn thành.'], do: async (g) => {
      await g.click(css('.cm-list-b')); await g.wait(500); const sel = g.page.locator('.bk-field select').first(); const to = await sel.locator('option', { hasText: 'Xong' }).first().getAttribute('value');
      await g.move(css('.bk-field select')); await sel.selectOption(to); await g.wait(600); await g.click(button('Di chuyển')); await g.wait(1400); } },
  ] },
  { id: 'cong-viec', title: 'Công việc của tôi', user: 'an', start: '#tasks', beats: [
    { say: ['Mục Công việc gom mọi việc liên quan đến bạn.', 'Giao cho tôi là việc của bạn; Tôi giao đi là việc bạn giao cho người khác; Đang theo dõi là việc bạn theo dõi.'], do: async (g) => {
      await g.hl(css('.tk-head .reading-tabs'), 1600); await g.click(byText('Tôi giao đi')); await g.wait(1300); await g.click(byText('Đang theo dõi')); await g.wait(1300); await g.click(byText('Giao cho tôi')); } },
    { say: ['Danh sách được nhóm theo thời hạn: trước đây, hôm nay, ngày mai, bảy ngày tới.', 'Bạn có thể lọc theo trạng thái, theo dự án, hoặc đổi cách nhóm.'], do: async (g) => { await g.hl(css('.gl-group-h', 'Hôm nay'), 2200); await g.hl(css('.tk-toolbar'), 3200); } },
    { say: ['Để giao việc mới, bấm Thêm mới.', 'Nhập tên, chọn người làm, dự án và thời hạn, rồi bấm Tạo công việc.'], do: async (g) => {
      await g.click(css('.tk-new')); await g.wait(700); await g.type(css('.task-editor-back input[placeholder="Tên công việc"]'), 'Viết bài giới thiệu gói phủ ceramic');
      await g.click(css('.task-editor-back .employee-picker-add')); await g.wait(500); await g.click(css('.bk-pop .bk-opt[aria-label="Thêm Phạm Thu Hà"]')); await g.click(css('.bk-pop .bk-x')); await g.wait(300);
      const project = g.page.locator('.task-editor-back select').first(); await g.move(css('.task-editor-back select')); const v = await project.locator('option', { hasText: 'Chiến dịch Tết 2027' }).first().getAttribute('value'); await project.selectOption(v);
      await g.click(css('.tk-quick-due button', 'Ngày mai')); await g.click(css('.task-editor-back .btn-primary')); await g.wait(1500); } },
    { say: ['Bấm vào một công việc để xem chi tiết ngay bên cạnh danh sách.', 'Kéo khe giữa hai khung để đổi độ rộng; bấm đúp để về như cũ.'], do: async (g) => {
      await g.click(css('.gl-row, .tk-reading-row', 'Chụp ảnh sản phẩm Ceramic')); await g.wait(1500); await g.drag(css('.tk-mailbox > .resize-handle'), 160); await g.wait(800); } },
  ] },
  { id: 'du-an', title: 'Dự án', user: 'an', start: '#projects', beats: [
    { say: ['Mỗi dự án có quy trình riêng.', 'Trạng thái tự đi theo công việc: Chưa bắt đầu, Đang thực hiện, rồi Hoàn thành.', 'Con số màu đỏ là số việc đang quá hạn.'], do: async (g) => {
      await g.hl(css('.gl-row:has-text("Video giới thiệu") .tk-badge'), 1800); await g.hl(css('.gl-row:has-text("Website mới") .tk-badge'), 1800); await g.hl(css('.gl-row:has-text("Chiến dịch Tết") .tk-badge.bad'), 2000); } },
    { say: ['Người quản lý dự án có thể đặt Tạm dừng hoặc Đã huỷ trong phần chi tiết của dự án.', 'Chọn lại Theo tiến độ công việc để trạng thái tự cập nhật như trước.'], do: async (g) => {
      await g.click(css('.gl-row', 'Website mới')); await g.wait(1400); const s = g.page.locator('select[aria-label="Trạng thái dự án"]');
      await g.move(css('select[aria-label="Trạng thái dự án"]')); await s.selectOption('paused'); await g.wait(1800); await g.hl(css('.reading-header .tk-badge'), 1500); await s.selectOption(''); await g.wait(1200); } },
  ] },
  { id: 'khach-hang', title: 'Khách hàng', user: 'an', start: '#customers', beats: [
    { say: ['Mục Khách hàng chứa hồ sơ khách.', 'Mỗi người chỉ thấy những khách mình phụ trách hoặc đang làm việc cùng.'], do: async (g) => { await g.hl(css('.gl'), 3800); } },
    { say: ['Có ba cách xem: Danh sách, Kanban và Thẻ.', 'Ở Kanban, kéo một khách sang cột khác để đổi trạng thái.'], do: async (g) => {
      await g.click((p) => p.getByRole('tab', { name: 'Kanban' })); await g.wait(2600); await g.click((p) => p.getByRole('tab', { name: 'Danh sách' })); } },
    { say: ['Bấm Thêm mới để tạo khách hàng.', 'Trạng thái ban đầu đã được chọn sẵn, và hệ thống cảnh báo nếu tên giống một khách đã có.'], do: async (g) => {
      await g.click(css('.tk-new')); await g.wait(900); await g.type(css('.crm-new input[required]'), 'Garage Minh Phat'); await g.wait(500); await g.hl(css('.crm-new .note.warn'), 2200);
      await g.page.fill('.crm-new input[required]', ''); await g.type(css('.crm-new input[required]'), 'Garage Thành Công'); } },
    { say: ['Điền người liên hệ, điện thoại, rồi bấm Tạo khách hàng.'], do: async (g) => {
      const f = g.page.locator('.crm-new label', { hasText: 'Người liên hệ' }).locator('input'); await g.click(() => f); await g.page.keyboard.type('Anh Thành', { delay: 45 });
      await g.click(css('.crm-new footer .btn-primary')); await g.wait(1800); } },
    { say: ['Trang chi tiết khách hàng có tổng quan, dự án, công việc, Drive, báo cáo, thành viên và lịch sử thay đổi.'], do: async (g) => { await g.hl(css('.crm-side'), 2600); await g.hl(css('.crm-detail-stages'), 2400); } },
  ] },
  { id: 'nhac-viec', title: 'Thông báo, Nhắc việc, Tìm kiếm', user: 'an', start: '#tasks', beats: [
    { say: ['Chuông thông báo cho biết khi bạn được giao việc, có bình luận mới hay công việc đổi trạng thái.', 'Bấm vào một thông báo để mở đúng công việc.'], do: async (g) => { await g.click(css('.notification-bell')); await g.wait(3600); await g.page.keyboard.press('Escape'); } },
    { say: ['Nhắc việc gom những việc cần chú ý: mới được giao, trễ hạn, và đến hạn hôm nay.'], do: async (g) => { await g.click(css('.rm-button')); await g.wait(1200); await g.hl(css('.rm-alert'), 2400); await g.page.keyboard.press('Escape'); } },
    { say: ['Tìm kiếm không cần gõ dấu.', 'Gõ anh duong vẫn ra khách hàng Rửa xe Ánh Dương, cùng các công việc liên quan.'], do: async (g) => {
      await g.click(css('.app-search')); await g.page.waitForSelector('.gs input'); await g.page.keyboard.type('anh duong', { delay: 70 }); await g.wait(2500); await g.page.keyboard.press('Escape'); } },
    { say: ['Ghi chú nhanh là sổ tay riêng của bạn.', 'Bấm biểu tượng ghi chú, gõ nội dung, mọi thứ tự động được lưu.'], do: async (g) => {
      await g.click(css('[aria-label="Tạo ghi chú nhanh"]')); await g.wait(900); await g.page.keyboard.type('Gọi lại anh Thành chiều thứ Sáu', { delay: 45 }); await g.wait(1200); await g.click(css('.qn-win [aria-label="Đóng ghi chú"]')); } },
  ] },
  { id: 'bao-cao-quan-tri', title: 'Báo cáo, Tools, Quản trị', user: 'an', start: '#reports', beats: [
    { say: ['Mục Báo cáo dùng để tạo báo cáo cho khách hàng, và xem số liệu Meta Ads khi đã kết nối tài khoản quảng cáo.'], do: async (g) => { await g.hl(css('.sec-nav'), 2200); await g.click(byText('Meta Ads')); await g.wait(1800); } },
    { say: ['Mục Tools có công cụ chuyển đổi định dạng file ngay trên máy của bạn, và Trình dựng video.'], do: async (g) => { await g.click(css('a.rail-item[href="#tools"]')); await g.wait(1600); await g.hl(byText('Kéo thả file vào đây'), 2200); } },
    { say: ['Quản trị viên quản lý nhân viên, phân quyền, danh mục, và xem thống kê trong mục Quản trị.'], do: async (g) => { await g.click(css('a.rail-item[href="#admin"]')); await g.wait(2200); await g.hl(css('.ax-kpis'), 2400); } },
  ] },
  { id: 'ket', title: 'Mẹo và hỗ trợ', card: { kicker: 'Cần trợ giúp?', title: 'Bấm Hỗ trợ', lines: ['ở góc dưới bên trái màn hình', 'hoặc xem Sổ tay sử dụng DMI Workspace'] }, beats: [
    { say: ['Một vài mẹo nhỏ: kéo khe giữa các khung để đổi độ rộng, bấm đúp để về như cũ.', 'Trên điện thoại, các mục còn lại nằm trong nút Thêm ở thanh dưới.'] },
    { say: ['Nếu cần trợ giúp, bấm Hỗ trợ ở góc dưới bên trái, hoặc xem Sổ tay sử dụng DMI Workspace.', 'Chúc bạn làm việc hiệu quả!'] },
  ] },
];

/** What the screen shows in each beat, for the storyboard (in the order of SCENES' beats). */
export const SHOW = {
  'mo-dau': ['Thẻ tiêu đề nền xanh thương hiệu: logo, “Hướng dẫn sử dụng · DMI Workspace”.', 'Giữ thẻ tiêu đề, mờ dần sang cảnh đăng nhập.'],
  'dang-nhap': ['Trang đăng nhập. Con trỏ bấm ô Email, gõ email; bấm ô Mật khẩu, gõ; bấm biểu tượng con mắt để hiện rồi ẩn mật khẩu.', 'Bấm “Quên mật khẩu?” → màn Quên mật khẩu; bấm “Gửi link đặt lại”; khung cam tô sáng thông báo đã gửi; bấm “Quay lại đăng nhập”.', 'Gõ lại mật khẩu, bấm “Đăng nhập” → vào Workspace.'],
  'giao-dien': ['Khung cam tô sáng menu bên trái.', 'Tô sáng ô “Tìm mọi thứ” trên thanh trên.', 'Tô sáng lần lượt: Messenger, Ghi chú nhanh, chuông Thông báo, sáng/tối, tên tài khoản.', 'Tô sáng nút Hỗ trợ rồi nút Nhắc việc (góc dưới bên trái).'],
  'board': ['Phóng to ô board “Kế hoạch Marketing tháng 11” (tên, Riêng tư, ảnh thành viên), rồi thu về.', 'Bấm ô board → board mở; tô sáng lần lượt các cột Cần làm, Đang làm, Xong.', 'Phóng to thẻ “Chụp ảnh sản phẩm Ceramic”: nhãn, khách hàng, dự án, hạn, việc cần làm, người làm.', 'Bấm “Thêm thẻ” ở cột Cần làm, gõ “Chuẩn bị nội dung livestream”, Enter → thẻ mới xuất hiện.', 'Bấm nút ⋯ của cột Cần làm → menu; tô sáng mục Màu danh sách; chọn màu tím → cả cột đổi màu.'],
  'the': ['Bấm thẻ “Chụp ảnh sản phẩm Ceramic” → cửa sổ thẻ; tô sáng Khách hàng/Dự án, Thành viên, Ngày.', 'Tích mục “Danh sách góc chụp” → thanh tiến độ lên 100%.', 'Gõ bình luận ở khung bên phải, bấm Lưu → bình luận hiện trong danh sách.', 'Bấm tên cột “Đang làm” ở góc trên → hộp Di chuyển thẻ; chọn Xong; bấm Di chuyển.'],
  'cong-viec': ['Trang Công việc của tôi; tô sáng các tab; bấm Tôi giao đi, Đang theo dõi, rồi về Giao cho tôi.', 'Tô sáng nhóm “Hôm nay”, rồi thanh lọc và nhóm.', 'Bấm Thêm mới → form; gõ tên; bấm + chọn Phạm Thu Hà; chọn dự án Chiến dịch Tết 2027; bấm Ngày mai; bấm Tạo công việc.', 'Bấm dòng “Chụp ảnh sản phẩm Ceramic” → chi tiết mở bên phải; kéo khe giữa hai khung sang phải.'],
  'du-an': ['Trang Dự án; tô sáng nhãn Chưa bắt đầu, Đang thực hiện và nhãn đỏ “quá hạn”.', 'Bấm dự án Website mới → chi tiết; chọn Tạm dừng ở ô Trạng thái dự án, tô sáng nhãn Tạm dừng; chọn lại Theo tiến độ công việc.'],
  'khach-hang': ['Trang Khách hàng (danh sách nhóm theo trạng thái); tô sáng bảng.', 'Bấm tab Kanban → các cột trạng thái; về tab Danh sách.', 'Bấm Thêm mới → form; gõ “Garage Minh Phat” → cảnh báo “Có thể trùng với…” được tô sáng; xoá, gõ “Garage Thành Công”.', 'Gõ người liên hệ “Anh Thành”, bấm Tạo khách hàng → mở trang chi tiết khách mới.', 'Tô sáng cột các tab của khách, rồi thanh quy trình trạng thái.'],
  'nhac-viec': ['Bấm chuông → danh sách thông báo; đóng.', 'Bấm Nhắc việc → bảng Nhắc việc; tô sáng phần “cần chú ý”; đóng.', 'Bấm ô tìm kiếm, gõ “anh duong” → kết quả gồm công việc và khách Rửa xe Ánh Dương; đóng.', 'Bấm biểu tượng ghi chú → tờ ghi chú mới; gõ “Gọi lại anh Thành chiều thứ Sáu”.'],
  'bao-cao-quan-tri': ['Trang Tất cả báo cáo; tô sáng cột mục; bấm Meta Ads → màn “Chưa kết nối Meta Ads”.', 'Bấm Tools → Chuyển đổi định dạng; tô sáng vùng kéo thả file.', 'Bấm Quản trị → Thống kê tổng quan; tô sáng các chỉ số.'],
  'ket': ['Thẻ kết “Cần trợ giúp? · Bấm Hỗ trợ”.', 'Giữ thẻ kết, mờ dần.'],
};

// ------------------------------------------------------------------------------------------------ narration
const tts = (dir) => (text) => {
  const key = crypto.createHash('sha1').update(`${VOICE}|${RATE}|${text}`).digest('hex').slice(0, 12), file = path.join(dir, `${key}.aiff`);
  if (!fs.existsSync(file)) execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', file, text]);
  const info = execFileSync('afinfo', [file]).toString();
  return { file, seconds: Number(info.match(/estimated duration: ([\d.]+)/)[1]) };
};
const GAP = 0.35; // between sentences

// ------------------------------------------------------------------------------------------------ recording
/** The drawn cursor, highlight ring, click ripple and zoom, in every page. */
function guideLayer() {
  const ready = () => {
    if (document.getElementById('__g')) return;
    const g = document.createElement('div'); g.id = '__g';
    g.innerHTML = `<div id="__gc" style="position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(800px,450px);transition:transform .7s cubic-bezier(.25,.8,.25,1)"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4 3.8 7.2-2.6 1.4-3.8-7.3L4 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
      <div id="__gh" style="position:fixed;z-index:2147483646;pointer-events:none;border:4px solid #F05A28;border-radius:12px;box-shadow:0 0 0 5px rgba(240,90,40,.28),0 0 28px rgba(240,90,40,.5);opacity:0;transition:all .35s ease"></div>`;
    document.documentElement.append(g);
  };
  window.__guide = {
    move(x, y, ms) { ready(); const c = document.getElementById('__gc'); c.style.transition = `transform ${ms}ms cubic-bezier(.25,.8,.25,1)`; c.style.transform = `translate(${x}px,${y}px)`; },
    ripple(x, y) { ready(); const r = document.createElement('div'); r.style.cssText = `position:fixed;left:${x - 18}px;top:${y - 18}px;width:36px;height:36px;border-radius:50%;background:rgba(240,90,40,.35);z-index:2147483646;pointer-events:none;transform:scale(.3);transition:transform .45s ease,opacity .45s ease`; document.documentElement.append(r); requestAnimationFrame(() => { r.style.transform = 'scale(1.4)'; r.style.opacity = '0'; }); setTimeout(() => r.remove(), 600); },
    ring(b) { ready(); const h = document.getElementById('__gh'); if (!b) { h.style.opacity = '0'; return; } const x = Math.max(4, b.x - 6), y = Math.max(4, b.y - 6), r = Math.min(innerWidth - 4, b.x + b.width + 6), d = Math.min(innerHeight - 4, b.y + b.height + 6); Object.assign(h.style, { left: `${x}px`, top: `${y}px`, width: `${r - x}px`, height: `${d - y}px`, opacity: '1' }); },
    zoom(b, s) { const el = document.body; el.style.transition = 'transform .7s cubic-bezier(.25,.8,.25,1)'; el.style.transformOrigin = b ? `${b.x + b.width / 2}px ${b.y + b.height / 2}px` : 'center'; el.style.transform = b ? `scale(${s})` : ''; },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
}

function helpers(page) {
  const at = async (target) => { const loc = typeof target === 'function' ? target(page) : target; await loc.waitFor({ state: 'visible', timeout: 8000 }); return { loc, box: await loc.boundingBox() }; };
  const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const g = {
    page,
    wait: (ms) => page.waitForTimeout(ms),
    async move(target, ms = 650) { const { box } = await at(target); const c = center(box); await page.evaluate(([x, y, t]) => window.__guide.move(x, y, t), [c.x, c.y, ms]); await page.waitForTimeout(ms + 80); return box; },
    async click(target) { const { loc } = await at(target); const box = await g.move(loc); const c = center(box); await page.evaluate(([x, y]) => window.__guide.ripple(x, y), [c.x, c.y]); await loc.click(); await page.waitForTimeout(250); },
    async type(target, text) { await g.click(target); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(text, { delay: 45 }); },
    async hl(target, ms = 1500) { const { box } = await at(target); const c = center(box); await page.evaluate(([x, y]) => window.__guide.move(x, y, 500), [Math.min(c.x, W - 30), Math.min(c.y, H - 30)]); await page.evaluate((b) => window.__guide.ring(b), box); await page.waitForTimeout(ms); await page.evaluate(() => window.__guide.ring(null)); await page.waitForTimeout(150); },
    async zoom(target, s = 1.6) { const { box } = await at(target); await page.evaluate(([b, k]) => window.__guide.zoom(b, k), [box, s]); await page.waitForTimeout(800); },
    async unzoom() { await page.evaluate(() => window.__guide.zoom(null)); await page.waitForTimeout(800); },
    // A resize handle has no width of its own (its grip is drawn around it), so it only needs to be on the page.
    async drag(target, dx) { const loc = typeof target === 'function' ? target(page) : target; await loc.waitFor({ state: 'attached', timeout: 8000 }); const box = await loc.boundingBox(); const c = center(box);
      await page.evaluate(([x, y]) => window.__guide.move(x, y, 600), [c.x, c.y]); await page.waitForTimeout(700); await page.mouse.move(c.x, c.y); await page.mouse.down();
      for (let i = 1; i <= 20; i++) { const x = c.x + (dx * i) / 20; await page.mouse.move(x, c.y); await page.evaluate(([px, py]) => window.__guide.move(px, py, 40), [x, c.y]); await page.waitForTimeout(40); }
      await page.mouse.up(); },
  };
  return g;
}

/** A title card: the brand's blue, the logo, a kicker, a title and a few lines. */
const cardHtml = (base, c) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 30% 20%,#2f8cff 0%,#0b5fd6 45%,#063a8c 100%);color:#fff;font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
  .c{text-align:center} img{height:64px;filter:brightness(0) invert(1);margin-bottom:28px} .k{font-size:26px;letter-spacing:.18em;text-transform:uppercase;opacity:.85}
  h1{margin:14px 0 22px;font-size:96px;letter-spacing:-.02em} p{margin:6px 0;font-size:34px;opacity:.92}</style></head>
  <body><div class="c"><img src="${base}/brand/logo.png" alt=""><div class="k">${c.kicker}</div><h1>${c.title}</h1>${c.lines.map((l) => `<p>${l}</p>`).join('')}</div></body></html>`;

export async function record(base, work) {
  const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');
  const voice = tts(path.join(work, 'tts')); fs.mkdirSync(path.join(work, 'tts'), { recursive: true });
  const sid = async (who) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${who}@demo.dmi`, password: PASSWORD }) }); return r.headers.get('set-cookie').match(/dms_sid=([^;]+)/)[1]; };
  const an = await sid('an');
  const board = (await (await fetch(base + '/api/boards', { headers: { cookie: 'dms_sid=' + an } })).json()).find((b) => b.name.startsWith('Kế hoạch Marketing')).id;
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  for (const scene of SCENES.filter((s) => !process.env.ONLY || process.env.ONLY.split(',').includes(s.id))) {
    const dir = path.join(work, 'scenes', scene.id); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
    // A note left open by an earlier scene (or run) would sit over this one.
    for (const n of await (await fetch(base + '/api/quick-notes', { headers: { cookie: 'dms_sid=' + an } })).json()) if (n.open) await fetch(base + `/api/quick-notes/${n.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: 'dms_sid=' + an }, body: JSON.stringify({ open: false }) });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
    if (scene.user) await ctx.addCookies([{ name: 'dms_sid', value: await sid(scene.user), url: base }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('dms.lang', 'vi'); localStorage.setItem('dms.theme', 'light'); } catch {} });
    await ctx.addInitScript(guideLayer);
    const said = scene.beats.map((b) => b.say.map((t) => ({ text: t, ...voice(t) })));
    const page = await ctx.newPage();
    if (scene.card) await page.setContent(cardHtml(base, scene.card), { waitUntil: 'load' });
    else { const hash = scene.start === 'board' ? `#boards/${board}` : scene.start; await page.goto(`${base}/${hash}`); if (hash) await page.reload(); await page.waitForTimeout(2200); }
    await page.mouse.move(W / 2, H / 2);
    // Frames as they change, each with the time it was drawn.
    const cdp = await ctx.newCDPSession(page), frames = [];
    cdp.on('Page.screencastFrame', async (f) => { const file = path.join(dir, 'frames', `${String(frames.length).padStart(5, '0')}.jpg`); frames.push({ file, t: f.metadata.timestamp }); fs.writeFileSync(file, Buffer.from(f.data, 'base64')); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * SCALE, maxHeight: H * SCALE });
    while (!frames.length) await page.waitForTimeout(20);
    const t0 = frames[0].t, clock = () => Date.now() / 1000, c0 = clock(), cues = [], g = helpers(page);
    await page.waitForTimeout(500);
    for (const [b, beat] of scene.beats.entries()) {
      // The sentences one after the other, the actions alongside; the beat lasts as long as the longer of the two.
      const lines = said[b], speech = lines.reduce((a, l) => a + l.seconds + GAP, 0);
      let at = clock() - c0;
      for (const l of lines) { cues.push({ text: l.text, file: l.file, start: at, end: at + l.seconds }); at += l.seconds + GAP; }
      const began = clock();
      await Promise.all([page.waitForTimeout(speech * 1000), beat.do ? beat.do(g).catch((e) => console.error(`  ${scene.id}: ${e.message.split('\n')[0]}`)) : null]);
      const spent = clock() - began; if (spent < speech + 0.3) await page.waitForTimeout((speech + 0.3 - spent) * 1000);
      if (process.env.DEBUG) console.error(`  beat ${b}: speech ${speech.toFixed(1)} s, took ${(clock() - began).toFixed(1)} s`);
    }
    await page.waitForTimeout(700);
    const end = clock() - c0;
    await cdp.send('Page.stopScreencast');
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ frames: frames.map((f) => ({ file: f.file, t: f.t - t0 })), cues, end }, null, 1));
    console.log(`${scene.id}: ${frames.length} frames, ${end.toFixed(1)} s`);
    await ctx.close();
  }
  await browser.close();
}

// ------------------------------------------------------------------------------------------------ assembly
const ff = (args) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const srtTime = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 36e5), m = Math.floor(ms / 6e4) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
const clockTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const FADE = 0.45;

export function build(work, out) {
  fs.mkdirSync(out, { recursive: true });
  const parts = [], allCues = [], chapters = [];
  let offset = 0;
  for (const scene of SCENES.filter((s) => fs.existsSync(path.join(work, 'scenes', s.id, 'timeline.json')))) {
    const dir = path.join(work, 'scenes', scene.id), tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
    // Video: every frame for as long as it stayed on screen, then 30 frames a second, faded in and out.
    const list = tl.frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (tl.frames[i + 1]?.t ?? tl.end) - f.t).toFixed(3)}`).join('\n') + `\nfile '${tl.frames.at(-1).file}'\n`;
    fs.writeFileSync(path.join(dir, 'frames.txt'), list);
    // Audio: each sentence at its moment.
    const inputs = tl.cues.flatMap((c) => ['-i', c.file]);
    const delays = tl.cues.map((c, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(c.start * 1000)}|${Math.round(c.start * 1000)}[a${i}]`).join(';');
    const mix = `${delays};${tl.cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${tl.cues.length}:normalize=0,apad=whole_dur=${tl.end.toFixed(3)},afade=t=in:d=${FADE},afade=t=out:st=${(tl.end - FADE).toFixed(3)}:d=${FADE}[aout]`;
    const part = path.join(work, `${String(parts.length).padStart(2, '0')}-${scene.id}.mp4`);
    ff(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'), ...inputs,
      '-filter_complex', `[0:v]fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,fade=t=in:d=${FADE},fade=t=out:st=${(tl.end - FADE).toFixed(3)}:d=${FADE}[vout];${mix}`,
      '-map', '[vout]', '-map', '[aout]', '-t', tl.end.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', part]);
    parts.push(part);
    chapters.push({ title: scene.title, start: offset });
    for (const c of tl.cues) allCues.push({ text: c.text, start: offset + c.start, end: offset + c.end });
    offset += tl.end;
  }
  const total = offset;
  // Subtitles, chapter marks (also inside the file), then one video with the subtitles drawn in.
  const srt = allCues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
  fs.writeFileSync(path.join(out, 'huong-dan-dmi-workspace.srt'), srt);
  fs.writeFileSync(path.join(out, 'chuong.txt'), chapters.map((c) => `${clockTime(c.start)} ${c.title}`).join('\n') + '\n');
  const meta = [';FFMETADATA1', 'title=Hướng dẫn sử dụng DMI Workspace', ...chapters.flatMap((c, i) => ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.start * 1000)}`, `END=${Math.round((chapters[i + 1]?.start ?? total) * 1000)}`, `title=${c.title}`])].join('\n');
  fs.writeFileSync(path.join(work, 'chapters.txt'), meta);
  fs.writeFileSync(path.join(work, 'parts.txt'), parts.map((p) => `file '${p}'`).join('\n'));
  const joined = path.join(work, 'joined.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'parts.txt'), '-c', 'copy', joined]);
  const subs = path.join(work, 'subs.srt'); fs.copyFileSync(path.join(out, 'huong-dan-dmi-workspace.srt'), subs);
  ff(['-i', joined, '-i', path.join(work, 'chapters.txt'), '-map_metadata', '1', '-map_chapters', '1',
    '-vf', `subtitles=${subs}:fontsdir=/System/Library/Fonts/Supplemental:force_style='FontName=Arial,FontSize=12,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,OutlineColour=&H99000000,BorderStyle=3,Outline=5,Shadow=0,MarginV=30'`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'copy', '-movflags', '+faststart', path.join(out, 'huong-dan-dmi-workspace.mp4')]);
  return { total, chapters, cues: allCues.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'record') record(a, b).catch((e) => { console.error(e); process.exit(1); });
  else if (cmd === 'build') console.log(JSON.stringify(build(a, b), null, 1));
  else console.log('node scripts/guide/video.mjs record <base> <workdir> | build <workdir> <outdir>');
}
