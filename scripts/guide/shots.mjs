// Screenshots for the user guide, from the demo company of seed.mjs on a scratch server: a plain one and one with
// numbered callouts for each screen. The callouts' texts are the legend the manual prints under each picture
// (build.mjs reads SHOTS), so picture and text always agree.
//   PLAYWRIGHT=/path/to/node_modules/playwright-core node scripts/guide/shots.mjs http://127.0.0.1:5394 docs/huong-dan-dmi-workspace/anh [id…]
import fs from 'node:fs';
import path from 'node:path';

const PASSWORD = 'demo-12345';
const W = 1440, H = 900;
const role = (r, name, o = {}) => (p) => p.getByRole(r, { name, ...o }).first();
const text = (t) => (p) => p.getByText(t, { exact: true }).first();
const css = (s, has) => (p) => (has ? p.locator(s, { hasText: has }) : p.locator(s)).first();

/** Each screen: who looks at it, how to get there, and what its numbers point at (with what the manual says of each). */
export const SHOTS = [
  { id: '01-dang-nhap', title: 'Trang đăng nhập', user: null, go: '', notes: [
    [css('.login-card input[type=email]'), 'Email đăng nhập do quản trị viên cấp.'],
    [css('.login-pass input'), 'Mật khẩu (ít nhất 8 ký tự).'],
    [css('.login-pass .bd-icon'), 'Hiện hoặc ẩn mật khẩu đang gõ.'],
    [css('.login-card .btn-primary'), 'Đăng nhập.'],
    [css('.login-switch'), 'Quên mật khẩu: nhận link đặt lại qua email.'],
    [css('.tb-lang'), 'Đổi ngôn ngữ giao diện (Tiếng Việt / English).'],
  ] },
  { id: '02-quen-mat-khau', title: 'Yêu cầu đặt lại mật khẩu', user: null, go: '', act: async (p) => { await p.click('.login-switch'); await p.fill('.login-card input[type=email]', 'lan@demo.dmi'); await p.click('.login-card .btn-primary'); await p.waitForSelector('.login-note', { timeout: 10000 }); }, notes: [
    [css('.login-card input[type=email]'), 'Email đăng nhập của bạn.'],
    [css('.login-card .btn-primary'), 'Gửi link đặt lại mật khẩu.'],
    [css('.login-note'), 'Thông báo đã gửi (luôn giống nhau, dù email có tài khoản hay không).'],
    [css('.login-switch'), 'Quay lại trang đăng nhập.'],
  ] },
  { id: '03-giao-dien', title: 'Bố cục chung sau khi đăng nhập', user: 'an', go: '#boards', notes: [
    [css('.rail'), 'Menu chính: Workspace, Khách hàng, Công việc, Báo cáo, Tools, Quản trị.'],
    [css('.app-search'), 'Tìm mọi thứ: khách hàng, công việc, dự án, board, thành viên, ghi chú (phím tắt ⌘K / Ctrl K).'],
    [css('.app-head-right button', ''), 'Messenger: nhắn tin với đồng nghiệp.'],
    [css('[aria-label="Tạo ghi chú nhanh"]'), 'Ghi chú nhanh: tạo một tờ ghi chú riêng của bạn.'],
    [css('.notification-bell'), 'Thông báo: việc được giao, bình luận, thay đổi trạng thái…'],
    [css('.tb-theme'), 'Giao diện sáng, tối hoặc theo thiết bị.'],
    [css('.tb-user'), 'Tài khoản: hồ sơ, đổi mật khẩu, ngôn ngữ, đăng xuất.'],
    [css('.sp-button'), 'Hỗ trợ: gửi câu hỏi hoặc báo lỗi cho lập trình viên.'],
    [css('.rm-button'), 'Nhắc việc: việc mới được giao, trễ hạn, đến hạn hôm nay.'],
  ] },
  { id: '04-workspace', title: 'Workspace: danh sách board', user: 'an', go: '#boards', notes: [
    [css('.bd-wsec h2, .bd-wsec header', ''), 'Workspace và các board bạn được vào.'],
    [role('button', 'Thành viên (6)'), 'Thành viên của workspace.'],
    [css('.bd-tile', 'Kế hoạch Marketing'), 'Một board: tên, quyền riêng tư và những người đang ở trong board (rê chuột vào ảnh để xem tên).'],
    [css('.bd-tile-new'), 'Tạo board mới.'],
    [css('[placeholder^="Tìm trong Workspace"]'), 'Tìm thẻ hoặc board trong Workspace.'],
    [role('button', 'Tạo mới'), 'Tạo nhanh: board, công việc, dự án, khách hàng…'],
    [css('.bd-dock'), 'Thanh dock: Messenger, Planner (lịch), Board, Đổi board.'],
  ] },
  { id: '05-board', title: 'Một board: các cột theo quy trình công việc', user: 'an', go: (s) => `#boards/${s.board}`, notes: [
    [css('.bd-bar .bd-title'), 'Tên board (quản lý board bấm để đổi tên).'],
    [css('.bd-view-button'), 'Chế độ xem: Board, Bảng, Lịch…'],
    [css('.bd-bar .bd-star'), 'Gắn sao để board hiện ở mục "Board đã gắn sao".'],
    [css('.bd-bar .bd-vis'), 'Ai xem được board (riêng tư: chỉ người được mời).'],
    [role('button', 'Bộ lọc'), 'Lọc thẻ theo thành viên, nhãn, hạn, khách hàng…'],
    [role('button', 'Chia sẻ'), 'Mời người vào board và đặt quyền của họ.'],
    [css('.bd-list', 'Cần làm'), 'Một cột = một bước trong quy trình của công việc. Cột có thể có màu riêng.'],
    [css('.bd-card', 'Chụp ảnh sản phẩm'), 'Một thẻ = một công việc: nhãn, khách hàng, dự án, hạn, việc cần làm, người làm.'],
    [css('.bd-list:has-text("Cần làm") .bd-add-card'), 'Thêm thẻ (công việc) vào cột.'],
    [text('Thêm danh sách khác'), 'Thêm cột mới.'],
  ] },
  { id: '06-mau-cot', title: 'Menu của cột: chọn màu cho cả cột', user: 'an', go: (s) => `#boards/${s.board}`, act: async (p) => { await p.locator('.bd-list', { hasText: 'Cần làm' }).first().locator('.bd-list-h .bd-icon').last().click(); await p.waitForTimeout(400); }, notes: [
    [css('.bk-colors'), 'Màu danh sách: tô màu cả cột (mọi người cùng thấy).'],
    [css('.bk-menu button', 'Thêm thẻ'), 'Thêm thẻ vào đầu cột.'],
    [css('.bk-menu button', 'Sắp xếp theo'), 'Sắp xếp thẻ trong cột theo ngày tạo, tên hoặc hạn.'],
    [css('.bk-menu button', 'Lưu trữ danh sách này'), 'Lưu trữ cả cột.'],
  ] },
  { id: '07-the', title: 'Chi tiết một thẻ (công việc)', user: 'an', go: (s) => `#boards/${s.board}`, act: async (p) => { await p.locator('.bd-card', { hasText: 'Chụp ảnh sản phẩm' }).first().click(); await p.waitForSelector('.cm'); await p.waitForTimeout(600); }, notes: [
    [css('.cm-top-l, .cm .cm-list-btn, .cm button:has-text("Đang làm")'), 'Cột (bước) hiện tại; bấm để chuyển thẻ sang cột khác.'],
    [text('Mở trang công việc'), 'Mở công việc gắn với thẻ ở trang Công việc.'],
    [css('.cm-actions, .cm button:has-text("Thêm")'), 'Thêm: thành viên, nhãn, ngày, việc cần làm, đính kèm, ảnh bìa…'],
    [css('.cm div:has(> h4:text-is("Khách hàng"))'), 'Khách hàng và dự án của công việc.'],
    [css('.cm div:has(> h4:text-is("Thành viên"))'), 'Người làm (thành viên của thẻ) và nhãn.'],
    [css('.cm div:has(> h4:text-is("Ngày"))'), 'Ngày bắt đầu và hạn; tích ô để đánh dấu đã xong.'],
    [css('.cm h3:has-text("Mô tả")'), 'Mô tả công việc.'],
    [css('.cm h3:has-text("Kết quả công việc")'), 'Kết quả: ghi chú và file nộp.'],
    [text('Chuẩn bị'), 'Danh sách việc cần làm (checklist) và tiến độ.'],
    [css('#card-comments'), 'Bình luận và lịch sử hoạt động của thẻ.'],
  ] },
  { id: '08-planner', title: 'Planner: lịch công việc cạnh board', user: 'an', go: (s) => `#boards/${s.board}`, act: async (p) => { if (!(await p.locator('.bp-planner').count())) await p.locator('.bd-dock button', { hasText: 'Planner' }).click(); await p.waitForTimeout(1200); }, post: async (p) => { await p.keyboard.press('Escape'); await p.locator('.bd-dock button', { hasText: 'Planner' }).click(); await p.waitForTimeout(800); }, notes: [
    [css('.bp-planner'), 'Planner: các thẻ có ngày của bạn theo lịch; kéo thẻ từ lịch vào board hoặc ngược lại.'],
    [css('.bd-main > .resize-handle'), 'Kéo khe này để đổi độ rộng khung (bấm đúp để về mặc định).'],
    [css('.bd-dock button:has-text("Planner")'), 'Bật / tắt Planner.'],
  ] },
  { id: '09-messenger', title: 'Messenger: nhắn tin nội bộ', user: 'an', go: '#boards', act: async (p) => { if (await p.locator('.bp-planner').count()) await p.locator('.bd-dock button', { hasText: 'Planner' }).click(); await p.locator('.bd-dock button', { hasText: 'Messenger' }).click(); await p.waitForTimeout(1500); }, notes: [
    [css('.fmsg-window'), 'Cửa sổ chat: kênh chung của công ty hoặc tin nhắn riêng với một người.'],
    [css('[aria-label="Nội dung tin nhắn"]'), 'Gõ tin nhắn rồi Enter để gửi; có emoji và gửi ảnh.'],
    [css('[aria-label="Gọi thoại"]'), 'Gọi thoại / gọi video / ghi âm: chưa hoạt động (chỉ hiện thông báo).'],
    [css('.bd-dock button:has-text("Messenger")'), 'Mở Messenger từ thanh dock (hoặc biểu tượng trên thanh trên).'],
  ] },
  { id: '10-cong-viec', title: 'Công việc của tôi', user: 'an', go: '#tasks', notes: [
    [css('.sec-nav'), 'Cột mục: Công việc của tôi, Dự án, và danh sách dự án theo khách hàng.'],
    [css('.tk-head .reading-tabs'), 'Giao cho tôi / Tôi giao đi / Đang theo dõi.'],
    [css('.tk-new'), 'Thêm công việc mới.'],
    [css('.tk-find'), 'Tìm theo tên, dự án, nhãn, mã.'],
    [css('.tk-toolbar .tk-pick', 'trạng thái'), 'Lọc theo trạng thái.'],
    [css('.tk-toolbar .tk-pick', 'dự án'), 'Lọc theo dự án.'],
    [css('.tk-toolbar .tk-pick', 'Nhóm theo'), 'Nhóm danh sách: theo thời hạn, trạng thái, dự án…'],
    [css('.gl-group-h', 'Hôm nay'), 'Nhóm "Hôm nay": việc đến hạn trong ngày.'],
  ] },
  { id: '11-cong-viec-chi-tiet', title: 'Xem một công việc bên cạnh danh sách', user: 'an', go: '#tasks', act: async (p) => { await p.locator('.gl-row', { hasText: 'Chụp ảnh sản phẩm Ceramic' }).first().click(); await p.waitForTimeout(1500); }, notes: [
    [css('.tk-list-pane'), 'Danh sách công việc (thu gọn khi đang xem một việc).'],
    [css('.tk-mailbox > .resize-handle'), 'Kéo để đổi độ rộng danh sách; bấm đúp để về mặc định.'],
    [css('.tk-reading-pane'), 'Chi tiết công việc: trạng thái, người làm, hạn, mô tả, bình luận…'],
  ] },
  { id: '12-tao-cong-viec', title: 'Thêm công việc mới', user: 'an', go: '#tasks', act: async (p) => { await p.click('.tk-new'); await p.waitForTimeout(900); }, notes: [
    [css('.task-editor-back input[placeholder="Tên công việc"]'), 'Tên công việc (bắt buộc).'],
    [css('.task-editor-back .tk-staff-picker'), 'Người làm: chọn một hoặc nhiều nhân viên.'],
    [css('.task-editor-back select'), 'Dự án của công việc (để trống nếu là việc chung).'],
    [css('.tk-quick-due'), 'Hạn: Hôm nay, Ngày mai, hoặc chọn ngày khác.'],
    [css('.tk-create-description'), 'Mô tả, có định dạng (đậm, danh sách, liên kết…).'],
    [css('.tk-create-more'), 'Tuỳ chọn khác: ngày bắt đầu, trạng thái, nhãn, người theo dõi…'],
    [css('.task-editor-back .btn-primary'), 'Tạo công việc.'],
  ] },
  { id: '13-du-an', title: 'Dự án và trạng thái của dự án', user: 'an', go: '#projects', notes: [
    [css('.tk-new'), 'Thêm dự án mới.'],
    [css('.tk-toolbar .tk-pick', 'Nhóm theo'), 'Nhóm theo khách hàng hoặc theo trạng thái dự án.'],
    [css('.gl-row', 'Chiến dịch Tết 2027'), 'Một dự án: trạng thái, số việc quá hạn, người làm, tiến độ.'],
    [css('.tk-badge', 'Tạm dừng'), 'Trạng thái do người quản lý dự án đặt (Tạm dừng / Đã huỷ).'],
    [css('.gl-row:has-text("Video giới thiệu") .tk-badge'), 'Trạng thái tự theo công việc: Chưa bắt đầu, Đang thực hiện, Hoàn thành.'],
  ] },
  { id: '14-du-an-chi-tiet', title: 'Chi tiết dự án và đặt trạng thái', user: 'an', go: '#projects', act: async (p) => { await p.locator('.gl-row', { hasText: 'Chiến dịch Tết 2027' }).first().click(); await p.waitForTimeout(1500); }, notes: [
    [css('.reading-header .tk-badge'), 'Trạng thái hiện tại của dự án.'],
    [css('.reading-header select[aria-label="Trạng thái dự án"]'), 'Người quản lý đặt Tạm dừng / Đã huỷ, hoặc để theo tiến độ công việc.'],
    [css('.project-reading-pane'), 'Chiến dịch và công việc của dự án.'],
  ] },
  { id: '15-khach-hang', title: 'Khách hàng: danh sách', user: 'an', go: '#customers', notes: [
    [css('.tk-head .reading-tabs'), 'Cách xem: Danh sách, Kanban, Thẻ.'],
    [css('.cd-totals'), 'Tổng số khách, dự án và công việc đã xong.'],
    [css('.tk-new'), 'Thêm khách hàng.'],
    [css('.tk-find'), 'Tìm theo tên, liên hệ, email, điện thoại, nhu cầu.'],
    [css('.cd-filter-btn'), 'Lọc theo nhu cầu, trạng thái, tag, nguồn, người phụ trách, Drive.'],
    [css('.tk-toolbar .tk-pick', 'Nhóm theo'), 'Nhóm theo trạng thái, tag, nguồn hoặc người phụ trách.'],
    [css('.gl-group-h', 'Tiềm năng'), 'Một nhóm (ở đây là trạng thái "Tiềm năng").'],
    [css('.gl tr.gl-row .gl-end'), 'Sửa hoặc xoá khách hàng (nếu bạn có quyền).'],
  ] },
  { id: '16-khach-hang-kanban', title: 'Khách hàng: Kanban theo trạng thái', user: 'an', go: '#customers', act: async (p) => { await p.getByRole('tab', { name: 'Kanban' }).click(); await p.waitForTimeout(800); }, notes: [
    [css('.cd-col', 'Tiềm năng'), 'Một cột = một trạng thái của khách hàng; kéo thẻ khách sang cột khác để đổi trạng thái.'],
  ] },
  { id: '17-khach-hang-chi-tiet', title: 'Chi tiết khách hàng', user: 'an', go: '#customers', act: async (p) => { await p.locator('.gl-row', { hasText: 'Rửa xe Ánh Dương' }).first().click(); await p.waitForTimeout(1500); }, notes: [
    [css('.crm-detail-stages'), 'Quy trình của khách hàng: bấm một bước để đổi trạng thái.'],
    [css('.crm-side'), 'Các mục: Tổng quan, Dự án, Công việc, Drive, Báo cáo, Thành viên, Lịch sử.'],
    [role('button', 'Chỉnh sửa'), 'Sửa thông tin khách hàng.'],
    [text('Tiến độ công việc'), 'Tiến độ công việc của khách.'],
    [text('Liên hệ'), 'Liên hệ và người phụ trách.'],
  ] },
  { id: '18-them-khach-hang', title: 'Thêm khách hàng', user: 'an', go: '#customers', act: async (p) => { await p.click('.tk-new'); await p.waitForSelector('.crm-new'); await p.waitForTimeout(800); await p.fill('.crm-new input[required]', 'Rửa xe Anh Dương'); await p.waitForTimeout(400); }, notes: [
    [css('.crm-new .stg, .crm-new [class*="stage"]'), 'Trạng thái ban đầu (chọn sẵn bước đầu tiên, đổi được).'],
    [css('.crm-new input[required]'), 'Tên khách hàng (bắt buộc).'],
    [css('.crm-new .note.warn'), 'Cảnh báo khi tên giống một khách đã có (vẫn tạo được).'],
    [css('.crm-new footer .btn-primary'), 'Tạo khách hàng.'],
  ] },
  { id: '19-bao-cao', title: 'Báo cáo khách hàng', user: 'an', go: '#reports', notes: [
    [css('.sec-nav'), 'Báo cáo: Tất cả báo cáo, Meta Ads.'],
    [css('select'), 'Chọn khách hàng cho báo cáo mới.'],
    [role('button', 'Tạo báo cáo'), 'Tạo báo cáo.'],
  ] },
  { id: '20-meta-ads', title: 'Meta Ads (chưa kết nối)', user: 'an', go: '#ads', notes: [
    [role('button', 'Kết nối Meta Ads'), 'Kết nối bằng access token Meta (quyền ads_read) để xem số liệu quảng cáo.'],
  ] },
  { id: '21-chuyen-doi', title: 'Tools: Chuyển đổi định dạng', user: 'an', go: '#tools', notes: [
    [text('Kéo thả file vào đây'), 'Kéo thả hoặc chọn file; xử lý ngay trên máy, không tải lên server.'],
    [text('Video'), 'Các loại file đổi được: video, âm thanh, ảnh, phụ đề, bảng tính.'],
    [role('button', 'Mở trình dựng'), 'Mở Trình dựng video.'],
  ] },
  { id: '22-trinh-dung', title: 'Tools: Trình dựng video', user: 'an', go: '#editor', notes: [
    [text('Tạo dự án'), 'Tạo dự án video mới.'],
  ] },
  { id: '23-quan-tri', title: 'Quản trị: Thống kê tổng quan', user: 'an', go: '#admin/stats/overview', notes: [
    [css('.ax-side, nav.ax-nav, aside'), 'Các nhóm trang quản trị (hiện theo quyền của bạn).'],
    [css('.ax-kpis'), 'Các chỉ số chính trong kỳ.'],
    [role('button', 'Xuất báo cáo'), 'Xuất số liệu.'],
  ] },
  { id: '24-nhan-vien', title: 'Quản trị: Nhân viên', user: 'an', go: '#admin/staff/list', notes: [
    [role('button', 'Thêm nhân viên'), 'Thêm nhân viên: tên, email, mật khẩu, phòng ban, chức vụ.'],
    [role('button', 'Xuất CSV'), 'Xuất danh sách ra file CSV.'],
    [css('main input[type=search], main input[placeholder^="Tìm tên"]'), 'Tìm theo tên, email, điện thoại.'],
    [css('table'), 'Danh sách: phòng ban, chức vụ, vai trò, trạng thái, lần đăng nhập gần nhất, số việc đang làm.'],
  ] },
  { id: '25-phan-quyen', title: 'Quản trị: Vai trò và quyền', user: 'an', go: '#admin/rbac/roles', notes: [
    [role('button', 'Tạo vai trò'), 'Tạo vai trò mới (tập hợp quyền).'],
    [css('.ax-role', 'Super Admin'), 'Một vai trò: cấp, số người, số quyền; bấm để sửa quyền.'],
    [text('Gán quyền nhân viên'), 'Gán vai trò cho nhân viên.'],
  ] },
  { id: '26-thong-bao', title: 'Thông báo', user: 'an', go: '#tasks', act: async (p) => { await p.click('.notification-bell'); await p.waitForTimeout(900); }, notes: [
    [css('.notification-bell'), 'Chuông: số thông báo chưa đọc.'],
    [css('.notification-inbox-actions'), 'Đánh dấu tất cả đã đọc.'],
    [text('Bạn được giao công việc'), 'Một thông báo: bấm để mở công việc hoặc thẻ (và đánh dấu đã đọc).'],
  ] },
  { id: '27-nhac-viec', title: 'Nhắc việc', user: 'an', go: '#tasks', act: async (p) => { await p.click('.rm-button'); await p.waitForTimeout(1200); }, notes: [
    [css('.rm-tabs'), 'Quan trọng / Hôm nay / Muộn.'],
    [css('.rm-alert'), 'Việc trễ hạn hoặc đến hạn hôm nay (cần chú ý).'],
    [css('.rm-panel footer'), 'Mở danh sách công việc đầy đủ.'],
  ] },
  { id: '28-tim-kiem', title: 'Tìm kiếm mọi thứ', user: 'an', go: '#tasks', act: async (p) => { await p.click('.app-search'); await p.waitForSelector('.gs input'); await p.waitForTimeout(300); await p.keyboard.type('ánh dương', { delay: 40 }); await p.waitForTimeout(1500); }, notes: [
    [css('.gs input'), 'Gõ từ khoá (không cần dấu: "anh duong" vẫn tìm ra "Ánh Dương").'],
    [css('.gs [role=tablist], .gs nav'), 'Lọc kết quả: Tất cả, Thành viên, Công việc, Khách hàng, Dự án, Board & thẻ, Ghi chú.'],
    [css('.gs-body'), 'Kết quả theo nhóm; dùng phím ↑ ↓ và Enter để mở.'],
  ] },
  { id: '29-ghi-chu', title: 'Ghi chú nhanh', user: 'an', go: '#tasks', before: async (A) => { const n = (await A('GET', '/api/quick-notes'))[0]; await A('PUT', `/api/quick-notes/${n.id}`, { open: true, x: 760, y: 140, w: 380, h: 360 }); }, after: async (A) => { for (const n of await A('GET', '/api/quick-notes')) await A('PUT', `/api/quick-notes/${n.id}`, { open: false }); }, notes: [
    [css('.qn-win'), 'Một ghi chú: kéo thanh trên để di chuyển, kéo góc để đổi cỡ; tự lưu khi gõ.'],
    [css('.qn-win footer'), 'Định dạng: đậm, nghiêng, mã, tiêu đề, danh sách, việc cần làm, ảnh.'],
  ] },
  { id: '30-ho-so', title: 'Hồ sơ của tôi', user: 'an', go: '#profile', notes: [
    [role('button', 'Sửa hồ sơ'), 'Sửa tên và số điện thoại.'],
    [role('button', 'Đổi mật khẩu'), 'Đổi mật khẩu.'],
    [text('Thông tin cá nhân'), 'Thông tin tài khoản: email, điện thoại, phòng ban, ngày tham gia.'],
    [text('Công việc được giao'), 'Công việc đang được giao cho bạn.'],
  ] },
  { id: '31-menu-tai-khoan', title: 'Menu tài khoản', user: 'an', go: '#tasks', act: async (p) => { await p.click('.tb-user-btn'); await p.waitForTimeout(500); }, notes: [
    [css('.app-head .tb-menu'), 'Hồ sơ của tôi, Đổi mật khẩu, Ngôn ngữ, Đăng xuất.'],
  ] },
  { id: '32-ho-tro', title: 'Gửi yêu cầu hỗ trợ', user: 'an', go: '#tasks', act: async (p) => { await p.click('.sp-button'); await p.waitForTimeout(800); }, notes: [
    [css('dialog[open] textarea'), 'Mô tả câu hỏi hoặc lỗi gặp phải (kèm ảnh chụp nếu có).'],
    [css('dialog[open] .btn-primary'), 'Gửi cho lập trình viên; trả lời sẽ về thông báo của bạn.'],
  ] },
  { id: '33-di-dong', title: 'Trên điện thoại', user: 'an', go: '#customers', mobile: true, notes: [
    [css('.rail'), 'Thanh dưới: 3 mục chính, Nhắc việc và Thêm.'],
  ] },
  { id: '34-di-dong-them', title: 'Trên điện thoại: mục "Thêm"', user: 'an', go: '#customers', mobile: true, act: async (p) => { await p.tap('.rail-more-btn'); await p.waitForTimeout(500); }, notes: [
    [css('.rail-more.open'), 'Các mục còn lại: Báo cáo, Tools, Quản trị, Hỗ trợ.'],
  ] },
  { id: '35-chi-xem', title: 'Board với quyền chỉ xem', user: 'mai', go: (s) => `#boards/${s.board}`, notes: [
    [text('Chỉ xem'), 'Bạn chỉ có quyền xem board này: không thêm, sửa hay kéo thẻ.'],
    [css('.bd-list', 'Cần làm'), 'Chỉ hiện thẻ của những dự án và khách hàng bạn được xem.'],
    [css('.rail'), 'Menu chỉ có các mục bạn được vào (ở đây không có Quản trị).'],
  ] },
];

export async function capture(base, outDir, only = []) {
  const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');
  fs.mkdirSync(path.join(outDir, 'goc'), { recursive: true });
  const sid = async (who) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${who}@demo.dmi`, password: PASSWORD }) }); return r.headers.get('set-cookie').match(/dms_sid=([^;]+)/)[1]; };
  const api = (cookie) => async (m, p, b) => (await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', cookie: 'dms_sid=' + cookie }, body: b && JSON.stringify(b) })).json();
  const an = await sid('an');
  const state = { board: (await api(an)('GET', '/api/boards')).find((b) => b.name.startsWith('Kế hoạch Marketing')).id };
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const report = [];
  for (const s of SHOTS.filter((x) => !only.length || only.includes(x.id))) {
    const cookie = s.user ? await sid(s.user) : null;
    const ctx = await browser.newContext(s.mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: W, height: H }, deviceScaleFactor: 1.5 });
    if (cookie) await ctx.addCookies([{ name: 'dms_sid', value: cookie, url: base }]);
    // The guide shows the interface in Vietnamese, light theme.
    await ctx.addInitScript(() => { try { localStorage.setItem('dms.lang', 'vi'); localStorage.setItem('dms.theme', 'light'); } catch {} });
    const page = await ctx.newPage();
    try {
      if (s.before) await s.before(api(cookie));
      const hash = typeof s.go === 'function' ? s.go(state) : s.go;
      await page.goto(`${base}/${hash}`); if (hash) await page.reload();
      await page.waitForTimeout(1800);
      if (s.act) await s.act(page);
      await page.mouse.move(W - 4, H - 4);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outDir, 'goc', `${s.id}.png`) });
      const boxes = [], missing = [];
      for (const [i, [find, label]] of s.notes.entries()) {
        let box = find ? await find(page).boundingBox({ timeout: 1500 }).catch(() => null) : null;
        // A resize handle has no width of its own (its grip is drawn around it): a 12px strip over it.
        if (box && box.height && box.width < 4) box = { ...box, x: box.x - 6, width: 12 };
        if (box && box.width && box.height) boxes.push({ n: i + 1, ...box }); else missing.push(`${i + 1}. ${label}`);
      }
      await page.evaluate(drawNotes, boxes);
      await page.screenshot({ path: path.join(outDir, `${s.id}.png`) });
      if (s.post) await s.post(page);
      report.push(`${s.id}: ${boxes.length}/${s.notes.length}${missing.length ? '  missing → ' + missing.join(' | ') : ''}`);
      if (s.after) await s.after(api(cookie));
    } catch (e) { report.push(`${s.id}: FAILED ${String(e.message).split('\n')[0]}`); }
    await ctx.close();
  }
  await browser.close();
  return report;
}

/** Numbered callouts over the page: an outlined box per element and its number at the box's top left corner. */
function drawNotes(boxes) {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  for (const b of boxes) {
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${b.x - 3}px;top:${b.y - 3}px;width:${b.width + 6}px;height:${b.height + 6}px;border:2.5px solid #F05A28;border-radius:8px;box-shadow:0 0 0 2px rgba(255,255,255,.85)`;
    const tag = document.createElement('div');
    const x = Math.min(Math.max(b.x - 14, 2), innerWidth - 30), y = Math.min(Math.max(b.y - 14, 2), innerHeight - 30);
    tag.textContent = b.n;
    tag.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:26px;height:26px;border-radius:50%;background:#F05A28;color:#fff;font:700 14px/26px -apple-system,Segoe UI,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.3)`;
    layer.append(box, tag);
  }
  document.body.append(layer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base = 'http://127.0.0.1:5394', out = 'docs/huong-dan-dmi-workspace/anh', ...only] = process.argv.slice(2);
  capture(base, out, only).then((r) => console.log(r.join('\n')));
}
