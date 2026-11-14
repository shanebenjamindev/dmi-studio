// Có gì mới: what changed for the people using DMI Workspace, newest first. Add an entry (a new `id`) with each release
// that changes something they see; everyone is shown it once after it arrives (components/WhatsNew.tsx). Written for
// users, in both languages: what they can do now, and what works again.
export interface Update {
  id: string;
  date: string;
  items: { kind: 'new' | 'fix'; vi: string; en: string }[];
}

export const UPDATES: Update[] = [
  {
    id: '2026-11-14-6',
    date: '14/11/2026',
    items: [
      { kind: 'new', vi: 'Mỗi công việc chỉ có một người thực hiện, là người được giao sau cùng. Khi người tạo hoặc người đang nhận việc giao cho người khác (ở trang công việc hay trên thẻ board), người thực hiện cũ tự chuyển thành người theo dõi. Nhập từ sheet: người ghi sau cùng thực hiện, những người ghi trước theo dõi.', en: 'Each task has one person doing it: the last one given it. When its maker or the person doing it gives it to someone else (on the task page or its board card), the previous person becomes a follower. Sheet imports: the last person named does it, those named before follow it.' },
    ],
  },
  {
    id: '2026-11-14-5',
    date: '14/11/2026',
    items: [
      { kind: 'fix', vi: 'Bỏ trình dựng video (Tools › Trình dựng). Báo cáo vẫn giữ nguyên; quyền trang “Trình dựng” trong phân quyền nay mang tên “Báo cáo”.', en: 'The video editor (Tools › Editor) is gone. Reports stay as they are; the “Editor” page access in roles is now called “Reports”.' },
      { kind: 'fix', vi: 'Ảnh đại diện hiện đúng ở người giao việc, người được giao và người theo dõi công việc (trước chỉ hiện chữ viết tắt).', en: 'Profile photos now show for who gave a task, who does it and who follows it (only initials showed before).' },
    ],
  },
  {
    id: '2026-11-14-4',
    date: '14/11/2026',
    items: [
      { kind: 'new', vi: 'Hồ sơ › Kết nối Claude: hướng dẫn dùng Claude của chính bạn (gói Pro hoặc Team, app Claude, Claude Code) để làm việc trong DMI, cùng danh sách app Claude đang kết nối với tài khoản của bạn và nút Thu hồi.', en: 'Profile › Connect Claude: how to use your own Claude (Pro or Team plan, the Claude apps, Claude Code) to work in DMI, with the Claude apps connected to your account and a Revoke button.' },
    ],
  },
  {
    id: '2026-11-14-2',
    date: '14/11/2026',
    items: [
      { kind: 'new', vi: 'Trình dựng (trên máy Mac) dựng video bằng Claude Code và HyperFrames: bấm “Chép lời nhắc cho Claude” rồi dán vào Claude Code; Claude đọc sheet, xem footage (nhãn s1, s2…), dựng và render trên máy. HyperFrames Studio mở to ngay trong trang (xem trước, timeline); cột Footage, Sheet, Kịch bản, Claude gập được; bản MP4 Claude gửi về nằm ở nút Bản render. Footage trùng (cùng tên, cùng độ dài) chỉ hiện một lần.', en: 'The editor (on the Mac) builds videos with Claude Code and HyperFrames: click “Copy the prompt for Claude” and paste it into Claude Code; Claude reads the sheet, looks at the footage (labels s1, s2…), builds and renders on the Mac. HyperFrames Studio opens large right in the page (preview, timeline); the Footage, Sheet, Script and Claude column folds away; the MP4s Claude sends back are under Renders. Duplicate footage (same name, same length) shows once.' },
      { kind: 'fix', vi: 'Trình dựng không còn tự gọi Claude: đọc sheet theo mẫu form, bỏ timeline cắt ghép cũ, xuất CapCut, outro logo và khung chat cũ.', en: 'The editor no longer calls Claude itself: sheets are read by the form template; the old cut timeline, CapCut export, logo outro and old chat are gone.' },
    ],
  },
  {
    id: '2026-11-14-1',
    date: '14/11/2026',
    items: [
      { kind: 'new', vi: 'Kết nối Claude với DMI Workspace: trong Claude (claude.ai, app Claude, Claude Code) thêm connector https://dmi-workspace.detailersmovement.workers.dev/api/mcp, đăng nhập DMI và bấm Cho phép. Claude xem, tìm, tạo, sửa, bình luận và chuyển bước công việc, xem dịch vụ và khách hàng, đúng với quyền của tài khoản bạn.', en: 'Connect Claude to DMI Workspace: in Claude (claude.ai, the Claude app, Claude Code) add the connector https://dmi-workspace.detailersmovement.workers.dev/api/mcp, sign in to DMI and click Allow. Claude views, finds, creates, edits, comments on and moves tasks through the workflow, and reads services and customers, with exactly your account\'s rights.' },
      { kind: 'fix', vi: 'Khung bên trái trang Báo cáo, Tools và Quản trị thành thẻ trắng bo tròn như trang Công việc; Meta Ads có icon biểu đồ. Trên điện thoại, Công việc, Báo cáo và Tools hiện dải tab phía trên nội dung thay vì khung chiếm hết màn hình.', en: 'The Reports, Tools and Admin menus are a rounded white card like the Tasks page\'s; Meta Ads has a chart icon. On phones, Tasks, Reports and Tools show a strip of tabs above the content instead of a menu filling the screen.' },
      { kind: 'fix', vi: 'Nút Messenger trên thanh dưới của board đổi tên thành Inbox.', en: 'The Messenger button in a board\'s bottom bar is now called Inbox.' },
    ],
  },
  {
    id: '2026-11-13-1',
    date: '13/11/2026',
    items: [
      { kind: 'fix', vi: "Trang chi tiết công việc có khối Kết quả công việc (bấm để ghi link bài đăng, tài khoản bàn giao…).", en: "The task page has a Work result section (click to note links, handed-over accounts…)." },
      { kind: 'new', vi: "Mỗi công việc chỉ giao cho một người: chọn người khác thì thay người cũ; danh sách chọn không có chính bạn (không tự giao việc cho mình). Công việc tạo mới hoặc thẻ mới không còn tự gán cho người tạo, chờ ở ACCOUNT để giao. Thẻ là công việc không còn nút Tham gia.", en: "A task goes to one person: picking another replaces them; the list leaves you out (you don't give work to yourself). New tasks and cards are no longer given to their maker; they wait in ACCOUNT to be given out. Task cards drop the Join button." },
      { kind: 'fix', vi: "Cửa sổ Tạo công việc mới có cùng giao diện với cửa sổ thẻ: tên công việc và hàng nút nhanh (Khách hàng, Dịch vụ, Thành viên, Nhãn, Ngày, Người duyệt), phần đã chọn hiện như mục thông tin của thẻ, Mô tả và Tuỳ chọn khác trong các khối riêng. Esc trong một cửa sổ chọn chỉ đóng cửa sổ đó; bong bóng chat ẩn khi đang mở cửa sổ.", en: "The New task window looks like a card's: the title and quick buttons (Customer, Service, Members, Labels, Dates, Reviewer), what is chosen shown as a card's facts, Description and More options in their own sections. Esc in a picker closes only it; the chat bubble hides while a window is open." },
      { kind: 'fix', vi: "Mọi hộp thoại hỏi xác nhận hoặc điền chữ (kéo thẻ cần nhận xét REDO/FAIL, mở lại, xoá, đặt tên…) giờ là cửa sổ của app giữa màn hình, nền tối, thay cho hộp thoại mặc định của trình duyệt; nhận xét bắt buộc thì phải điền mới bấm được.", en: "Every question asking to confirm or to type (a drag needing REDO/FAIL feedback, reopening, deleting, naming…) is now the app's own window over a dimmed page instead of the browser's; required feedback must be written before it can be sent." },
      { kind: 'fix', vi: "Trang dịch vụ nền xám như trang Công việc, chọn dịch vụ trên thanh tiêu đề; khung bên trái trang khách hàng thành thẻ trắng bo tròn như trang Công việc; thẻ dịch vụ trên board cũng hiện thanh quy trình.", en: "Service pages sit on grey like the Tasks page, with the service picked in the head; the customer page's menu is a rounded white card like the Tasks page's; service cards on boards show the workflow bar too." },
      { kind: 'new', vi: "Lọc và nhóm theo Ngày tạo hoặc Ngày sửa ở trang Công việc, Khách hàng, Dịch vụ; Quản trị › Tất cả công việc lọc được theo hạn chót, ngày tạo hoặc ngày sửa.", en: "Filter and group by Created or Updated date on the Tasks, Customers and Services pages; Admin › All tasks filters by due, created or updated date." },
      { kind: 'new', vi: "Bỏ hẳn khái niệm Dự án, chỉ còn Dịch vụ của khách: Khách hàng → Dịch vụ → Công việc. Mỗi dự án cũ thành một dịch vụ cùng tên (tạo trong danh mục nếu chưa có) và luôn mang tên dịch vụ; trang Dự án thành trang Dịch vụ; tạo hoặc sửa chỉ cần chọn khách và dịch vụ. File sheet có cột \"Dự án\" hay \"Dịch vụ\" đều nhập được.", en: "Projects are gone, only customers' services remain: Customer → Service → Task. Each old project became a service of the same name (added to the catalogue if missing) and always carries its service's name; the Projects page is now Services; making or editing one only takes a customer and a service. Sheets with a \"Dự án\" or \"Dịch vụ\" column both import." },
      { kind: 'fix', vi: 'Thẻ dịch vụ trên board hiện tên dịch vụ và danh sách công việc bên trong (bước, hạn chót, bấm để mở), thêm được công việc mới cho dịch vụ. Thẻ thường chưa gắn công việc khi mở sẽ tự thành công việc, có đủ thanh quy trình, việc con và các trường; công việc bắt đầu ở đúng bước của cột.', en: 'A service\'s card on a board shows the service\'s name and the tasks under it (step, due date, click to open), and takes new tasks for the service. A plain card with no task becomes one when opened, with the workflow bar, subtasks and fields; the task starts at its column\'s step.' },
      { kind: 'fix', vi: 'Bỏ dạng xem Thẻ ở trang Dự án: chỉ còn Danh sách và Bảng.', en: 'The Projects page drops its Cards view: List and Table remain.' },
      { kind: 'fix', vi: 'Mỗi dự án là một dịch vụ của khách: chỉ chọn một dịch vụ (trang dự án, sửa dự án, tạo nhanh). Tổng quan trong trang dự án cuộn được. Ô trả lời bình luận gọn lại: tên người được trả lời một dòng, nút × nhỏ, ô nhập rộng hết khung.', en: 'A project is one service of its customer: pick one service only (project page, project editing, quick create). The Overview on a project page scrolls. The comment reply box is tidier: who is answered on one line, a small ×, a full-width box.' },
      { kind: 'fix', vi: 'Thanh chọn cách xem (Danh sách, Thẻ, Bảng…) không còn lộ thanh cuộn; khi danh sách thu hẹp cạnh mục đang mở, các tab chỉ còn icon nên không bị cắt chữ.', en: 'View tabs (List, Cards, Table…) no longer show a scrollbar; when the list narrows beside an open item, the tabs show their icons only so nothing is cut off.' },
      { kind: 'fix', vi: 'Kéo thẻ trên board đi mọi hướng theo quy trình: sang bước sau là giao việc / nộp duyệt / PASS (kéo thẳng tới COMPLETED thì nộp rồi PASS nếu bạn được duyệt); EXECUTION về ACCOUNT để giao lại; REVIEW về trước hoặc sang REJECTED thì hỏi nhận xét rồi chấm REDO / FAIL; thẻ đã đóng kéo về thì hỏi lý do rồi mở lại.', en: 'Drag cards on a board in any direction along the workflow: forward hands out / submits / passes (straight to COMPLETED submits, then passes if you may review it); EXECUTION back to ACCOUNT to hand it out again; REVIEW back or to REJECTED asks for feedback, then grades REDO / FAIL; a closed card dragged back asks for a reason, then reopens.' },
      { kind: 'fix', vi: 'Mỗi board chỉ có một dịch vụ (loại board): khi tạo board, trong cài đặt và mục Giới thiệu của board, chọn dịch vụ khác sẽ thay dịch vụ cũ.', en: 'A board has one service (its kind): when making a board, in its settings and in its About, picking another service replaces the old one.' },
      { kind: 'new', vi: 'Cửa sổ thẻ: thanh quy trình ACCOUNT › EXECUTION › REVIEW › COMPLETED nằm trên đầu thẻ (thay nút cột); bấm một bước mới mở cửa sổ có người duyệt, ghi chú và nút Giao việc / Nộp duyệt / PASS, REDO, FAIL.', en: 'Card window: the ACCOUNT › EXECUTION › REVIEW › COMPLETED workflow row sits at the top of the card (in place of the column button); click a step to open a window with the reviewer, note and the Hand out / Submit / PASS, REDO, FAIL buttons.' },
      { kind: 'new', vi: 'Cột của board có màu theo bước ngay khi tạo: ACCOUNT xám, EXECUTION xanh dương, REVIEW tím, COMPLETED xanh lá, REJECTED đỏ (vẫn đổi được như mọi cột). Cột mặc định của các board hiện có cũng được tô màu nếu chưa có màu riêng.', en: 'A board\'s columns get their stage\'s colour as soon as they are made: ACCOUNT grey, EXECUTION blue, REVIEW purple, COMPLETED green, REJECTED red (still changeable like any column). Existing boards\' default columns get them too unless they already have a colour.' },
      { kind: 'new', vi: 'Mỗi bước quy trình có màu riêng trên huy hiệu (ACCOUNT xám, EXECUTION xanh dương, REVIEW tím, COMPLETED xanh lá, REJECTED đỏ); Admin đổi màu ở Quản trị › Công việc › Quy trình.', en: 'Each workflow stage has its own badge colour (ACCOUNT grey, EXECUTION blue, REVIEW purple, COMPLETED green, REJECTED red); Admins change them in Admin › Tasks › Workflow.' },
      { kind: 'new', vi: 'Tổng quan: bấm vào bất kỳ con số, thanh biểu đồ hay "Xem tất cả" để xem đúng các công việc đó (trang Công việc chuyển sang danh sách đã lọc; trang Khách hàng hiện danh sách ngay trong Tổng quan). Thêm biểu đồ Hạn chót của việc đang mở và Tạo mới / hoàn thành theo tuần; bộ lọc danh sách công việc có thêm các mốc này. Bỏ dạng xem Thẻ ở trang Khách hàng.', en: 'Overview: click any number, chart bar or "See all" to see exactly those tasks (the Tasks page switches to the filtered list; the Customers page lists them right in the Overview). New charts: due dates of open tasks, and created / completed per week; the task list filter has these too. The Customers page drops its Cards view.' },
      { kind: 'new', vi: 'Tất cả board: tick chọn một hoặc nhiều workspace (dạng Nhóm workspace và Cây thư mục), có Chọn tất cả, rồi xoá cùng lúc. Chỉ workspace cá nhân bạn tạo (hoặc mọi workspace cá nhân nếu là Admin) mới có ô chọn.', en: 'All boards: tick one or more workspaces (Workspace groups and Folder tree views), with Select all, then delete them together. Only personal workspaces you made (or any personal one for an Admin) can be ticked.' },
      { kind: 'new', vi: 'Trang Khách hàng và trang Công việc có thêm Tổng quan theo quy trình: số việc ở từng bước ACCOUNT / EXECUTION / REVIEW / COMPLETED / REJECTED (bấm để xem danh sách bước đó), việc quá hạn, chờ duyệt quá 24 giờ, bị trả về REDO, và danh sách việc chờ duyệt lâu nhất, quá hạn; trang Khách hàng có thêm việc đang mở của từng khách.', en: 'The Customers and Tasks pages get a workflow Overview: tasks at each stage ACCOUNT / EXECUTION / REVIEW / COMPLETED / REJECTED (click to list that stage), overdue, waiting over 24 h for review, sent back with REDO, and lists of the longest-waiting and overdue tasks; the Customers page also shows each customer\'s open work.' },
      { kind: 'fix', vi: 'Trang chi tiết công việc gọn hơn: quy trình duyệt mở từ một nút (huy hiệu bước) thay vì luôn hiện; Thông tin chung chuyển sang cột bên phải; bình luận hiện đúng định dạng (không còn mã HTML) và giãn cách rõ.', en: 'A tidier task page: the review workflow opens from one button (the stage badge) instead of always showing; General info moves to the right column; comments show their formatting (no raw HTML) with clear spacing.' },
      { kind: 'new', vi: 'Chọn ngày giờ kiểu Airbnb ở mọi nơi: một ô cho cả khoảng Bắt đầu → Hạn chót, lịch hai tháng, bấm ngày đầu rồi ngày cuối, các ngày giữa tô liền một dải; chọn nhanh Hôm nay, Ngày mai, +3 ngày, +1 tuần; giờ chọn ngay dưới lịch.', en: 'Airbnb-style date picking everywhere: one field for the whole Start → Due span, a two-month calendar, click the first then the last day with the days between shaded as one band; quick picks Today, Tomorrow, +3 days, +1 week; times right under the calendar.' },
      { kind: 'new', vi: 'Cửa sổ thẻ trên board có đủ thông tin của công việc như trang công việc: khối Quy trình duyệt (người duyệt, Nộp duyệt, PASS / REDO / FAIL), dịch vụ kèm, người theo dõi, người tạo và việc con; thành viên thẻ hiện là Người thực hiện. Thẻ luôn nằm ở cột đúng bước của công việc.', en: 'A board card\'s window has the task\'s full details as on the task page: the review workflow (reviewer, Submit, PASS / REDO / FAIL), extra services, followers, creator and subtasks; card members show as assignees. A card always sits in the column of its task\'s stage.' },
      { kind: 'new', vi: 'Bỏ trạng thái công việc, chỉ còn quy trình: trang công việc, danh sách, bảng, tab Công việc của khách hàng, hồ sơ và tìm kiếm đều hiện bước ACCOUNT / EXECUTION / REVIEW / COMPLETED / REJECTED. Form tạo và sửa không còn ô Trạng thái; lọc và nhóm theo bước quy trình.', en: 'Task statuses are gone; only the workflow remains: the task page, lists, table, a customer\'s Tasks tab, profiles and search show the ACCOUNT / EXECUTION / REVIEW / COMPLETED / REJECTED stage. The create and edit forms have no Status field; filter and group by stage.' },
      { kind: 'new', vi: 'Cột của board mặc định là các bước quy trình (ACCOUNT, EXECUTION, REVIEW, COMPLETED, REJECTED); board cũ chưa đổi tên cột (Cần làm, Đang làm, Chờ duyệt, Xong, Đã huỷ) được đổi theo. Kéo thẻ sang cột bước kế tiếp là giao việc, nộp duyệt hoặc PASS; REDO và FAIL chấm trong công việc vì cần nhận xét.', en: 'Default board columns are the workflow stages (ACCOUNT, EXECUTION, REVIEW, COMPLETED, REJECTED); older boards with the original column names (Cần làm, Đang làm, Chờ duyệt, Xong, Đã huỷ) are renamed to match. Dragging a card to the next stage\'s column hands the work out, submits it or passes it; REDO and FAIL are graded on the task since they need feedback.' },
      { kind: 'new', vi: 'Quy trình duyệt chỉ dùng tên tiếng Anh: ACCOUNT → EXECUTION → REVIEW → COMPLETED / REJECTED, chấm PASS / REDO / FAIL (bỏ tên tiếng Việt đi kèm).', en: 'The review workflow uses its English names only: ACCOUNT → EXECUTION → REVIEW → COMPLETED / REJECTED, graded PASS / REDO / FAIL.' },
      { kind: 'fix', vi: 'Mọi board theo quy trình duyệt: mỗi board có cột cho từng bước (Cần làm → Đang làm → Chờ duyệt → Xong → Đã huỷ; cột riêng như Cần dựng, Cần sửa, Đã giao được giữ và tính đúng bước). Việc chờ duyệt vào cột Chờ duyệt, việc bị từ chối vào Đã huỷ.', en: 'Every board follows the review workflow: each has a column for every step (To do → Doing → In review → Done → Cancelled; a board’s own columns such as Cần dựng, Cần sửa, Đã giao are kept and count as their step). Tasks waiting for review go to In review, rejected ones to Cancelled.' },
      { kind: 'fix', vi: 'Cột "Quá hạn / Overdue" không còn làm hỏng trạng thái công việc: quá hạn được tính theo hạn chót. Các cột này được lưu trữ (không xoá) và thẻ trong đó về đúng cột.', en: 'An “Overdue” column no longer breaks a task’s status: being late comes from the due date. Such columns are archived (not deleted) and their cards moved to the right column.' },
      { kind: 'new', vi: 'Dịch vụ thay cho Dự án, giống Base Wework: Khách hàng → Dịch vụ → Công việc. Khi tạo hay sửa công việc, và trên thẻ của board, chỉ cần chọn Khách hàng và Dịch vụ; công việc tự vào đúng nhóm dịch vụ đó của khách (tự tạo nếu khách chưa có).', en: 'Services replace Projects, like Base Wework: Client → Service → Task. When creating or editing a task, and on a board card, just pick the Client and the Service; the work goes into that service of the client automatically (created if the client doesn’t have it yet).' },
      { kind: 'new', vi: 'Trang khách hàng có tab Dịch vụ thay cho Dự án: thêm dịch vụ cho khách từ danh mục, bấm vào một dịch vụ để xem và giao công việc của dịch vụ đó.', en: 'A client’s page has a Services tab instead of Projects: add a service from the catalogue, and click one to see and assign its tasks.' },
      { kind: 'new', vi: 'Trang workspace có mục "Board trong workspace": tạo board, mở, gắn sao, đổi tên và cài đặt từng board, hoặc chọn nhiều board mình quản trị để xoá một lần.', en: 'The workspace page now has a "Boards in this workspace" section: create a board, open, star, rename and configure each one, or select several boards you administer and delete them at once.' },
      { kind: 'new', vi: 'Menu "⋯" của board có thêm ô đổi tên board (cho quản trị board).', en: 'A board’s "⋯" menu now includes a rename field (for its admins).' },
      { kind: 'fix', vi: 'Mở một khách hàng không còn tồn tại hoặc không có quyền xem (ví dụ bấm nút trở về) không còn hiện trang gần như trắng: có thông báo rõ và nút Về danh sách khách hàng.', en: 'Opening a client that no longer exists or that you cannot see (for example with the Back button) no longer shows a near-blank page: there is a clear message and a button back to the client list.' },
      { kind: 'fix', vi: 'Giao diện tối của trang Workspace (thanh công cụ, Cây thư mục, các nút trên từng hàng) không còn hiện mảng trắng và chữ khó đọc.', en: 'The Workspace page in the dark theme (its toolbar, the folder tree, the buttons on each row) no longer shows white panels and hard-to-read text.' },
      { kind: 'fix', vi: 'Trang chi tiết công việc: thanh cuộn chỉ hiện khi rê chuột vào, và khoảng cách giữa các khối đều nhau hơn.', en: 'The task details page: scrollbars only show while the pointer is over the pane, and the spacing between the blocks is more even.' },
      { kind: 'new', vi: 'Cửa sổ thẻ trên board được làm lại theo giao diện trang chi tiết công việc: mỗi phần (tên thẻ, mô tả, kết quả, việc cần làm, đính kèm) là một khối bo tròn trên nền xám, thanh cuộn ẩn khi không dùng.', en: 'The card window on a board now matches the task details page: each part (title, description, result, checklist, attachments) is a rounded block on a grey background, with scrollbars hidden until needed.' },
    ],
  },
  {
    id: '2026-11-12-2',
    date: '12/11/2026',
    items: [
      { kind: 'new', vi: 'Quy trình duyệt cho công việc: ACCOUNT (tiếp nhận, giao việc) → EXECUTION (thực hiện, nộp duyệt) → REVIEW. Người duyệt chấm PASS (hoàn thành), REDO (trả về làm lại, kèm nhận xét) hoặc FAIL (từ chối). Mỗi lần nộp lưu lại bản đã nộp, nhận xét và người duyệt.', en: 'A review workflow for tasks: ACCOUNT (take the request, assign it) → EXECUTION (do it, submit it) → REVIEW. The reviewer grades PASS (completed), REDO (sent back with feedback) or FAIL (rejected). Every submission keeps what was handed in, the feedback and who reviewed it.' },
      { kind: 'new', vi: 'Mỗi công việc có Người duyệt (mặc định là người tạo), chọn được khi tạo hoặc trong khối Quy trình duyệt. Công việc đã PASS hoặc FAIL không quay lại quy trình cho tới khi người duyệt hoặc Admin bấm Mở lại.', en: 'Each task has a reviewer (by default whoever made it), chosen when creating it or in the review workflow box. A task that passed or failed stays closed until its reviewer or an admin reopens it.' },
      { kind: 'new', vi: 'Toàn bộ công việc hiện có cũng theo quy trình, theo trạng thái hiện tại của từng việc: việc đã Hoàn thành hoặc Đã huỷ được đóng; việc nhập từ file cũng vậy.', en: 'Every existing task follows the workflow too, from its current status: completed and cancelled tasks are closed, and so are imported ones.' },
      { kind: 'new', vi: 'Quản trị › Công việc › Quy trình: đổi tên từng bước, chọn trạng thái của mỗi bước, chỉnh giờ và số ngày nhắc việc, và xoá các trạng thái không thuộc quy trình.', en: 'Admin › Tasks › Workflow: rename each stage, choose the status each one gives, set the reminder hour and days, and remove statuses outside the workflow.' },
      { kind: 'new', vi: 'Nhắc việc tự động mỗi ngày (mặc định từ 8:00): người làm khi công việc quá hạn, người duyệt khi công việc chờ duyệt quá 24 giờ (trong app, và qua email nếu đã bật).', en: 'Automatic daily reminders (from 8:00 by default): to the people doing a task once it is overdue, and to the reviewer once a review has waited 24 hours (in the app, and by email if turned on).' },
      { kind: 'fix', vi: 'Nút trở về của trình duyệt quay về đúng màn hình trước (danh sách khách hàng, danh sách dự án, tất cả board) thay vì thoát khỏi trang hay hiện màn hình trắng.', en: 'The browser’s Back button returns to the previous screen (the client list, the project list, all boards) instead of leaving the page or showing a blank screen.' },
      { kind: 'fix', vi: 'Trên board hẹp (mở Planner bên cạnh), bấm “…” không còn đẩy mất tên board: các nút không vừa sẽ xuống dòng.', en: 'On a narrow board (Planner open beside it), clicking “…” no longer pushes the board name out of view: buttons that do not fit go onto a second line.' },
    ],
  },
  {
    id: '2026-11-12-1',
    date: '12/11/2026',
    items: [
      { kind: 'fix', vi: 'Cửa sổ Tạo công việc không còn bị tràn khỏi màn hình khi nội dung dài: nút Tạo luôn nhìn thấy và bấm được. Các cửa sổ khác dài hơn màn hình giờ cuộn xuống được.', en: 'The Create task window no longer runs off the screen when its content is long: the Create button is always visible and clickable. Other windows taller than the screen can now be scrolled.' },
    ],
  },
  {
    id: '2026-11-11-1',
    date: '11/11/2026',
    items: [
      { kind: 'new', vi: 'Quản trị › Cấu hình hệ thống › Hosting và giới hạn: dung lượng, số database, số dòng đọc/ghi hôm nay và request trên cả tài khoản Cloudflare: đã dùng bao nhiêu, còn lại bao nhiêu.', en: 'Admin › System settings › Hosting and limits: storage, number of databases, rows read and written today and requests across the whole Cloudflare account: how much is used and how much is left.' },
      { kind: 'new', vi: 'Quản trị › Cấu hình hệ thống › Truy vấn SQL (chỉ Super Admin): chạy câu lệnh SQL trên database của tài khoản. Câu lệnh sửa dữ liệu cần bật cho phép, và mọi lần chạy được ghi vào Lịch sử thao tác.', en: 'Admin › System settings › SQL query (Super Admins only): run SQL on the account’s databases. Statements that change data need to be allowed first, and every run is recorded in the action history.' },
      { kind: 'fix', vi: 'Tệp và dung lượng hiện đúng dung lượng database so với giới hạn 500 MB; trang Sao lưu ghi đúng thời gian Time Travel (7 ngày).', en: 'Files and storage shows the database size against the 500 MB limit correctly; the Backup page states the Time Travel window correctly (7 days).' },
    ],
  },
  {
    id: '2026-11-09-4',
    date: '09/11/2026',
    items: [
      { kind: 'new', vi: 'Menu … trên ô board chọn được loại board (dịch vụ), dạng xem mặc định và khách hàng, khớp với cài đặt trong board.', en: 'The … menu on a board tile picks the board’s type (service), default view and client, the same settings as inside the board.' },
      { kind: 'new', vi: 'Danh sách board: kéo một công việc thả vào dự án để chuyển công việc vào dự án đó, hoặc thả xuống vùng cuối để bỏ khỏi dự án.', en: 'Board list: drag a task onto a project to move it in, or onto the space below to take it out of its project.' },
      { kind: 'new', vi: 'Chế độ xem Timeline cho mỗi workspace: mọi thẻ có ngày trên một dòng thời gian, mỗi dòng là một board hoặc một khách hàng; bấm thẻ để mở ngay tại chỗ.', en: 'A Timeline view for each workspace: every dated card on one timeline, a row per board or per client; click a card to open it in place.' },
      { kind: 'new', vi: 'Loại board giờ là loại dịch vụ (Google Ads, Meta Ads, Website…): chọn khi tạo board hoặc ở menu board › Về board này. Thẻ trên board tính vào dịch vụ đó ở Dashboard, trừ khi công việc của thẻ đã chọn dịch vụ riêng. Ô chọn cách mở board đổi tên thành “Dạng xem”.', en: 'A board’s type is now its service (Google Ads, Meta Ads, Website…): pick it when creating the board or in the board menu › About this board. On the Dashboard its cards count for that service unless their task names its own. The picker for how a board opens is now called “View”.' },
    ],
  },
  {
    id: '2026-11-09-3',
    date: '09/11/2026',
    items: [
      { kind: 'new', vi: 'Workspace gắn được với khách hàng: chọn khi tạo workspace hoặc ở trang Thành viên của workspace. Board tạo trong đó gắn sẵn khách hàng, và Dashboard tính việc của workspace cho khách đó.', en: 'A workspace can be for a client: pick one when creating it or on the workspace’s Members page. Boards made in it start out for that client, and the Dashboard counts its work for them.' },
      { kind: 'new', vi: 'Bấm vào tên được nhắc (@) để mở hồ sơ người đó.', en: 'Click a mentioned name (@) to open that person’s profile.' },
    ],
  },
  {
    id: '2026-11-09-2',
    date: '09/11/2026',
    items: [
      { kind: 'new', vi: 'Chọn loại board khi tạo: Board, Danh sách, Lịch, Tổng quan hoặc Dòng thời gian. Board mở ở dạng đã chọn; các dạng khác vẫn xem được ở thanh trên.', en: 'Pick a board type when you create one: Board, Lists, Calendar, Overview or Timeline. The board opens in that view; the others stay on its top bar.' },
      { kind: 'new', vi: 'Ngày bắt đầu của board: nhập khi tạo, để trống thì lấy thời điểm tạo. Sửa ở menu board › Về board này.', en: 'A board’s start date: enter it when you create the board, or leave it empty for now. Change it in the board menu › About this board.' },
      { kind: 'new', vi: 'Thêm thẻ ngay ở dạng Danh sách, Lịch, Dòng thời gian và Tổng quan, kèm thời hạn nếu muốn.', en: 'Add cards right from the Lists, Calendar, Timeline and Overview views, with a due date if you like.' },
      { kind: 'new', vi: 'Việc con nhiều tầng: thêm việc con cho cả việc con, xem cả nhánh dưới một việc gốc và thu gọn từng nhánh.', en: 'Subtasks at any depth: add subtasks to subtasks, see the whole branch under one task, and fold each branch.' },
      { kind: 'new', vi: 'Thêm việc con và mục checklist liên tục: Enter thêm rồi giữ ô để gõ tiếp; dán nhiều dòng để thêm nhiều mục một lần.', en: 'Add subtasks and checklist items one after another: Enter adds and keeps the field open; paste several lines to add them all at once.' },
      { kind: 'new', vi: 'Nhắc tên bằng @: gõ @ trong bình luận hoặc mô tả thẻ để chọn người trên board. Người được nhắc nhận thông báo và thấy ngay trong Nhắc việc.', en: 'Mention people with @: type @ in a comment or a card description to pick someone on the board. They get a notification and see it in Reminders.' },
      { kind: 'new', vi: 'Thêm › Việc con ngay trong thẻ board: thẻ là công việc, nên việc con hiện cả trong thẻ lẫn trang công việc.', en: 'Add › Subtask right on a board card: a card is a task, so its subtasks show on the card and on the task’s page.' },
      { kind: 'new', vi: 'Dịch vụ cho từng công việc (và thẻ): chọn gọn bằng nút +, dịch vụ của dự án được gợi ý trước. Ô chọn dịch vụ của dự án cũng gọn hơn.', en: 'Services on each task (and card): pick them with a small +, the project’s services suggested first. The project’s service picker is tidier too.' },
      { kind: 'new', vi: 'Nút chọn chế độ xem ở mỗi workspace: Board, Danh sách board (bấm một board để xem các dự án và công việc bên trong dạng cây) hoặc Dashboard. Dashboard có số việc đang mở, quá hạn, sắp đến hạn và biểu đồ theo khách hàng, theo dịch vụ: bấm vào để lọc. Mỗi khách một khung với công việc dạng cây (việc con nằm dưới việc cha): kéo thả một việc lên việc khác để thành việc con, bấm để mở việc hoặc trang khách hàng. Danh sách dài có chọn trang.', en: 'A view switch on each workspace: Board, Board list (click a board to see its projects and tasks as a tree) or Dashboard. The dashboard shows open, overdue and due-soon work, with charts by client and by service that filter when clicked. Each client gets a box with its work as a tree (subtasks under their task): drag a task onto another to make it a subtask, click to open the task or the client. Long lists come in pages.' },
    ],
  },
  {
    id: '2026-11-09',
    date: '09/11/2026',
    items: [
      { kind: 'new', vi: 'Dịch vụ theo dự án: mỗi dự án chọn dịch vụ từ danh mục; dịch vụ của khách hàng tự lấy từ các dự án của khách.', en: 'Services per project: each project picks its services from the catalogue; a client’s services come from its projects.' },
      { kind: 'new', vi: 'Gắn board với khách hàng: khi tạo board hoặc trong menu của board, chọn khách có sẵn hoặc tạo khách hàng mới ngay tại chỗ.', en: 'Link a board to a client: when creating a board or from the board menu, pick a client or create one on the spot.' },
      { kind: 'new', vi: 'Nút Sửa dự án: đổi tên, khách hàng, dịch vụ và trạng thái trong một hộp thoại.', en: 'Edit project: name, client, services and status in one dialog.' },
      { kind: 'new', vi: 'Dán ảnh (Ctrl/⌘ V) vào tin nhắn Messenger và vào yêu cầu Hỗ trợ (tối đa 3 ảnh).', en: 'Paste pictures (Ctrl/⌘ V) into Messenger and into Support requests (up to 3).' },
      { kind: 'new', vi: 'Kéo nút Messenger đi chỗ khác trên màn hình; vị trí được nhớ.', en: 'Drag the Messenger bubble anywhere on the screen; it stays there.' },
      { kind: 'new', vi: 'Dán link thư mục Drive ngay ở thẻ Drive trong phần Tổng quan của khách hàng.', en: 'Paste a Drive folder link right on the Drive card of a client’s overview.' },
      { kind: 'new', vi: 'Giao diện tiếng Anh đầy đủ hơn: ngày tháng, thứ trong tuần và các nút còn sót tiếng Việt giờ đã là tiếng Anh (chọn English ở menu tài khoản).', en: 'A complete English interface: dates, weekdays and the buttons still in Vietnamese are now in English (choose English in the account menu).' },
      { kind: 'fix', vi: 'Số tin nhắn chưa đọc giờ đúng trên mọi máy và mất đi khi đã đọc.', en: 'Unread message counts are right on every device and clear once read.' },
      { kind: 'fix', vi: 'Đóng được bong bóng chat; nó chỉ hiện lại khi có tin nhắn mới.', en: 'Chat bubbles close and stay closed until a new message arrives.' },
      { kind: 'fix', vi: 'Người được phân quyền “Tạo khách hàng” thêm được khách ở trang Khách hàng.', en: 'People given “Create client” in Permissions can add clients on the Client page.' },
      { kind: 'fix', vi: 'Dán link vào mô tả thẻ không còn hiện chữ <div>.', en: 'Pasting a link into a card description no longer shows <div>.' },
      { kind: 'fix', vi: 'Ảnh đại diện hiện trên thanh trên; danh sách dự án không còn chồng chữ khi cuộn ngang.', en: 'Your profile picture shows on the top bar; the project list no longer overlaps text when scrolled sideways.' },
      { kind: 'fix', vi: 'Trên điện thoại: thanh trên vừa màn hình và nút Messenger không che thanh dưới.', en: 'On phones: the top bar fits the screen and the Messenger bubble no longer covers the bottom bar.' },
    ],
  },
];
