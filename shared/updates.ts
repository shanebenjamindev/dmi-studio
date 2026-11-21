// Có gì mới: what changed for the people using DMI Workspace, newest first. Add an entry (a new `id`) with each release
// that changes something they see; everyone is shown it once after it arrives (web/src/components/WhatsNew.tsx), and
// Tin nhắn's #co-gi-moi posts it (server/chat-news.ts). Written for users, in both languages: what they can do now, and
// what works again.
export interface Update {
  id: string;
  date: string;
  items: { kind: 'new' | 'fix'; vi: string; en: string }[];
}

export const UPDATES: Update[] = [
  {
    id: '2026-11-21-9',
    date: '21/11/2026',
    items: [
      { kind: 'new', vi: 'Quản trị › Cấu hình hệ thống › Tệp và dung lượng › Dọn dẹp: xem từng loại dữ liệu cũ (nhật ký, lịch sử đăng nhập, thông báo, email đã gửi, lịch sử tự động hoá, bảng tính đã nhập, ván Board Game, thẻ đã lưu trữ…) với số mục và dung lượng, chọn khoảng thời gian, tick những gì muốn dọn rồi bấm một lần. Dọn thông báo cũ nay hoạt động đúng.', en: 'Admin › System settings › Files and storage › Clean up: see each kind of old data (logs, sign-in history, notifications, sent emails, automation history, imported sheets, Board Game rounds, archived cards…) with its count and size, pick an age, tick what to clear and clean in one go. Clearing old notifications now works.' },
    ],
  },
  {
    id: '2026-11-21-8',
    date: '21/11/2026',
    items: [
      { kind: 'fix', vi: 'Biểu tượng "Đang mở trang" nằm giữa màn hình. Ảnh đại diện, logo và ảnh đính kèm chỉ tải khi cuộn tới; các trang Quản trị và Trợ giúp tải riêng từng phần (Trợ giúp chỉ tải ngôn ngữ đang dùng) nên mở nhanh hơn.', en: 'The "Opening page" sign sits in the middle of the screen. Avatars, logos and attachment images load only when scrolled to; Admin and Help pages load in parts (Help only in the language in use), so they open faster.' },
    ],
  },
  {
    id: '2026-11-21-7',
    date: '21/11/2026',
    items: [
      { kind: 'new', vi: 'Tự động hoá đầy đủ hơn (học theo Bizfly CRM): khối Nếu/Thì rẽ hai nhánh Đúng/Sai, khối Đợi hẹn giờ (có thể chỉ tính giờ làm việc); kích hoạt khi trường dữ liệu đổi, có bình luận mới, khách hàng mới, khách đổi trạng thái hoặc người phụ trách; giao việc và chia khách theo vòng tròn, tỷ trọng hoặc người ít việc nhất (bỏ qua người đang nghỉ); cập nhật hạn chót, chuyển bước quy trình, đổi trạng thái khách. Có Cài đặt chung (giờ làm việc, danh sách nghỉ), tuỳ chọn "mỗi bản ghi chạy một lần" và "chỉ chạy trong giờ làm việc", số lần chạy hiện trên từng node, tab Đang chờ, chạy cho dữ liệu có sẵn, nhân bản luật, tải lịch sử chạy CSV.', en: 'Fuller Automation (modelled on Bizfly CRM): If/Then blocks with True/False branches, Wait blocks (optionally counting working hours only); triggers when a field changes, a comment is added, a client is added or changes status or owner; assign tasks and clients round-robin, by weight or to whoever has the fewest tasks (skipping people on leave); update due dates, move workflow steps, change client status. With General settings (working hours, leave list), "once per record" and "working hours only" options, run counts on each node, a Waiting tab, run on existing records, duplicate rules and a CSV run history.' },
      { kind: 'new', vi: 'Trang Trợ giúp (menu Trợ giúp): toàn bộ hướng dẫn sử dụng theo từng mục, có ảnh chụp chú thích, ô tìm kiếm và bộ bài riêng về Tự động hoá giải thích từng ô cần điền. Trong cửa sổ của mỗi bước tự động hoá, mỗi ô có dòng giải thích và nút Hướng dẫn mở đúng bài.', en: 'A Help page (Help in the menu): the whole user guide by section, with annotated screenshots, a search box and a set of Automation articles explaining every box. In each automation step, every box has a line of explanation and a Guide button opening the right article.' },
      { kind: 'fix', vi: 'Ma Sói: cửa sổ Kết quả gọn lại (người bị treo, phán xử và phiếu bầu mỗi thứ một hàng), không còn lặp nội dung và nút phía sau; đã đóng thì không tự mở lại, kể cả khi tải lại trang.', en: 'Werewolf: the Result window is tidier (the hanged player, then the verdict and the votes on a line each), no longer repeated with its button behind it; once closed it does not pop up again, even after reloading.' },
    ],
  },
  {
    id: '2026-11-21-6',
    date: '21/11/2026',
    items: [
      { kind: 'new', vi: 'Trang chủ có nút Thêm widget: chọn từ 10 loại (cần làm, hôm nay, trong tuần, quá hạn, chờ tôi duyệt, việc tôi giao, việc tôi theo dõi, tổng quan khách hàng, tổng quan dịch vụ, nhân viên của tôi). Bấm “…” trên mỗi widget để sửa (đổi tên, lọc một khách hàng, chọn trường hoặc cột hiển thị, kiểu hiển thị: danh sách/bảng hoặc biểu đồ — cột theo bước, cột theo hạn, lịch hạn 14 ngày, biểu đồ tròn, thanh theo khách hàng, thanh chồng, cột dọc, số liệu), đưa lên/xuống hoặc xoá. Trang chủ của bạn được lưu theo tài khoản, mở máy khác vẫn giữ nguyên.', en: 'Home has an Add widget button: pick from 10 kinds (to do, today, this week, overdue, waiting for my review, tasks I gave out, tasks I follow, clients overview, services overview, my people). Press “…” on a widget to edit it (rename, filter to one client, choose the fields or columns shown, how it shows its data: a list/table or a chart — columns by step, columns by due date, the next 14 days, donut, bars by client, stacked bars, columns, numbers), move it up or down, or remove it. Your Home is saved with your account, so it looks the same on any device.' },
      { kind: 'new', vi: 'Mỗi widget có tay nắm ⠿ để kéo đổi vị trí (cả trên điện thoại): khi kéo có bóng xem trước chỗ sẽ thả; thả cạnh widget khác là vào chung hàng, thả giữa hai hàng là thành hàng mới; các widget trong một hàng (tối đa 4) tự chia đều độ rộng, nút Đồng bộ để tải lại ngay và nút Mở rộng để xem toàn khung với đủ mọi dòng (Esc hoặc ✕ để thu nhỏ).', en: 'Each widget has a ⠿ handle to drag it into place (phones too): a shadow previews where it lands; drop it beside a widget to share that row, or between rows for a row of its own; widgets in a row (up to 4) share its width equally, a Sync button to reload it right away, and an Expand button to see it full size with every row (Esc or ✕ to close).' },
      { kind: 'new', vi: 'Quản trị › Tự động hoá: tạo luật kiểu n8n cho toàn hệ thống — Kích hoạt (việc mới, chuyển bước, quá hạn, sắp đến hạn, theo lịch, webhook gọi vào) → Điều kiện (khách hàng, dịch vụ, người làm, bước, tên việc) → Hành động (gửi thông báo, bình luận, giao việc, thêm người theo dõi, đặt người duyệt, tạo việc, gọi webhook sang n8n/Zapier). Giao diện như n8n: canvas lưới chấm, các node nối bằng dây, kéo thả node tự do, nút + để thêm hoặc chèn bước, bấm node để mở bảng Đầu vào · Tham số · Đầu ra. Có mẫu nhanh, bật/tắt, chạy thử và lịch sử chạy. Hành động chạy bằng quyền của người lưu luật; quyền "Tự động hoá" cấp ở Phân quyền.', en: 'Admin › Automation: n8n-style rules for the whole system — Trigger (new task, step change, overdue, due soon, schedule, incoming webhook) → Conditions (client, service, assignee, step, task name) → Actions (notify, comment, assign, add followers, set reviewer, create a task, call a webhook to n8n/Zapier). Laid out like n8n: a dotted canvas with nodes joined by lines, nodes dragged anywhere, + to add or insert a step, a node opening Input · Parameters · Output. With quick templates, on/off switches, test runs and a run history. Actions run with the rights of whoever saved the rule; the "Automation" permission is granted in Permissions.' },
      { kind: 'fix', vi: 'Trang Workspace: mũi tên cạnh mỗi workspace hướng xuống khi đang mở, hướng sang phải khi đã thu gọn.', en: 'Workspace page: the arrow by each workspace points down while it is open and right when folded.' },
    ],
  },
  {
    id: '2026-11-21-5',
    date: '21/11/2026',
    items: [
      { kind: 'new', vi: 'Có Trang chủ (biểu tượng ngôi nhà, mục đầu tiên bên trái): công việc cần làm, việc chờ bạn duyệt và tổng quan công việc của từng khách hàng trên một trang. Đăng nhập xong sẽ mở trang này.', en: 'New Home page (the house icon, first on the left): your tasks to do, tasks waiting for your review and an overview of each customer\'s work on one page. Signing in opens it.' },
      { kind: 'fix', vi: 'Trên điện thoại, thanh dưới gọn lại còn Trang chủ, Workspace, Công việc, Nhắc việc và Thêm; tên các mục không còn xuống dòng hay lệch nhau. Khách hàng, Tin nhắn, Hộp thư… nằm trong Thêm.', en: 'On phones the bottom bar now holds Home, Workspace, Tasks, Reminders and More; names no longer wrap or sit unevenly. Customers, Messages, Mailbox… are under More.' },
      { kind: 'fix', vi: 'Trang Workspace gọn hơn: chế độ xem gom vào một ô chọn, mỗi workspace chỉ còn các nút nhỏ (chế độ xem, thành viên, thêm), bấm tên khách hàng để mở khách hàng; ô chọn để xoá nhiều workspace chỉ hiện khi rê chuột vào dòng.', en: 'The Workspace page is tidier: views are in one picker, each workspace keeps only small buttons (view, members, more), click a customer\'s name to open it; the boxes for deleting several workspaces show only when you hover a row.' },
    ],
  },
  {
    id: '2026-11-21-4',
    date: '21/11/2026',
    items: [
      { kind: 'new', vi: 'Ma Sói: kết quả treo cổ và kết quả cuối ván (kèm lật vai cả làng) hiện ngay toàn màn hình; ai bị nguyền hay Bán sói bị cắn hóa Sói thì có thông báo riêng; Cứu là dấu cộng xanh lá, Đầu độc là đầu lâu tím.', en: 'Werewolf: the hanging result and the end-of-game result (with every role revealed) now show full screen right away; whoever is cursed, or a Cursed villager who is bitten, gets their own notice on turning into a wolf; Heal shows green pluses, Poison a purple skull.' },
      { kind: 'fix', vi: 'Ma Sói: chọn màu nhân vật chỉ đổi màu của mình, nhà người khác không đổi theo; màu đã có người dùng (cả bot) mờ đi và không bấm được.', en: 'Werewolf: picking a character colour changes only yours, other houses keep theirs; colours already in use (bots too) are greyed out and cannot be picked.' },
      { kind: 'fix', vi: 'Ma Sói: đóng trang rồi mở lại vẫn vào lại đúng phòng và ván chạy tiếp (trước đây ván có thể đứng yên); cùng tài khoản mở trên hai máy thì chỉ một máy làm quản trò, không còn gọi trùng hay nhảy lượt; kết quả bỏ phiếu, phán xử dễ đọc hơn.', en: 'Werewolf: closing and reopening the page takes you back into your room and the game goes on (before, it could stall); with one account open on two devices only one runs the narrator, so turns are no longer called twice or skipped; vote and trial results are easier to read.' },
    ],
  },
  {
    id: '2026-11-21-3',
    date: '21/11/2026',
    items: [
      { kind: 'fix', vi: 'Ma Sói gọn chữ hơn: bớt các dòng hướng dẫn dài; Sói thấy đồng bọn và người cả bầy đang nhắm (kèm số Sói) dễ nhìn hơn; Điểm nhấn cuối ván mỗi ý một dòng.', en: 'Werewolf has less text: long hints are gone; wolves see their pack and who it is aiming at (with counts) more clearly; end-of-game highlights are one per line.' },
      { kind: 'new', vi: 'Ma Sói: lỡ bấm “Không làm gì” thì bấm “Chọn lại” khi lượt của vai mình chưa hết.', en: 'Werewolf: pressed “Do nothing” by mistake? Press “Choose again” while your turn is still on.' },
    ],
  },
  {
    id: '2026-11-21-2',
    date: '21/11/2026',
    items: [
      { kind: 'new', vi: 'Ma Sói: đến lượt vai mình, mỗi chức năng là một nút riêng và có nút “Không làm gì”; Thiết lập có khung đếm vai trong ván, số Sói là Sói thường và bật Sói nguyền thì có thêm một con.', en: 'Werewolf: on your turn each action is its own button, with a “Do nothing” option; Settings shows a count of the roles in the game, the wolf number is ordinary wolves, and turning on the Cursed Wolf adds one more.' },
      { kind: 'fix', vi: 'Ma Sói giờ dùng tên tài khoản DMI Workspace: chưa đăng nhập thì cần đăng nhập để chơi, không chọn tên nữa.', en: 'Werewolf now uses your DMI Workspace account name: sign in to play, there is no name picker any more.' },
      { kind: 'new', vi: 'Ma Sói có nút “Chơi với tư cách khách”: người ngoài công ty chỉ cần gõ tên là vào phòng chơi cùng, không cần tài khoản (tên khách không được trùng tên nhân viên). Danh sách phòng chỉ còn những phòng đang có người.', en: 'Werewolf has a “Play as a guest” button: people outside the company just type a name to join, no account needed (a guest name cannot be a staff name). The room list now shows only rooms with people in them.' },
      { kind: 'fix', vi: 'Ma Sói: mở cùng một tài khoản trên điện thoại và máy tính giờ là cùng một người chơi, không còn báo “Đã có người tên… trong phòng”. Trên điện thoại, thẻ ban đêm không còn bị cắt và thanh các bước luôn hiện.', en: 'Werewolf: the same account on a phone and a computer is now one player, no more “someone with that name is already in the room”. On phones the night card is no longer cut off and the step bar always shows.' },
    ],
  },
  {
    id: '2026-11-21-1',
    date: '21/11/2026',
    items: [
      { kind: 'new', vi: 'Ma Sói có làng mới toàn màn hình: mỗi người chọn màu nhân vật trong phòng chờ (mái nhà cùng màu), đầu ván mỗi máy lật bài xem vai của mình, ban đêm bấm nhà người muốn chọn rồi nhân vật đi tới và có hoạt ảnh của từng vai. Sói thấy nhau cả ngày lẫn đêm, ban đêm hiện thành con sói.', en: 'Werewolf has a new full-screen village: everyone picks a character colour in the lobby (their roof matches), each phone flips a card to see its role at the start, and at night you tap a house, your character walks there and each role plays its own animation. Wolves see each other day and night, and appear as wolves at night.' },
      { kind: 'new', vi: 'Ma Sói: Thợ săn giờ được gọi dậy mỗi đêm để bắn một người (sáng ra người đó chết); chủ phòng có thể bật “Ẩn phiếu” để không ai thấy ai bầu ai.', en: 'Werewolf: the Hunter is now woken each night to shoot someone (they die at dawn); the host can turn on “Hide votes” so nobody sees who voted for whom.' },
      { kind: 'new', vi: 'Ma Sói: đến lượt vai mình thì chọn chức năng (Cắn, Soi, Bảo vệ, Cứu, Đầu độc…) rồi bấm vào nhà người đó. Ban đêm bầy Sói có khung chat riêng, và số phiếu hiện ngay trên nóc nhà người bị chọn.', en: 'Werewolf: on your turn, pick an action (Bite, See, Guard, Heal, Poison…) then tap that person’s house. Wolves get their own chat at night, and vote counts show on the chosen person’s roof.' },
      { kind: 'fix', vi: 'Thanh Mailbox ở cuối trang không còn bị nút nhạc che hay nhảy chỗ trên điện thoại.', en: 'The Mailbox bar at the bottom no longer jumps or sits under the music button on phones.' },
    ],
  },
  {
    id: '2026-11-19-4',
    date: '19/11/2026',
    items: [
      { kind: 'new', vi: 'Cảm xúc (reaction) trên bình luận theo phong cách Facebook: Thích là ngón cái nền xanh, Yêu là tim nền đỏ, còn lại là mặt cười màu. Di chuột vào nút Thích để chọn trong bảy cảm xúc.', en: 'Comment reactions now look Facebook-style: Like is a thumb on blue, Love a heart on red, the rest colourful faces. Hover the Like button to pick from the seven.' },
    ],
  },
  {
    id: '2026-11-19-3',
    date: '19/11/2026',
    items: [
      { kind: 'new', vi: 'Có nút nhạc nổi ở góc trái dưới: bấm để phát, bấm lần nữa để tắt. Nhạc chỉ phát khi bạn bấm, và trang nhớ lựa chọn của bạn trên máy này.', en: 'A floating music button sits at the bottom-left: click to play, click again to stop. Music plays only when you click, and the page remembers your choice on this device.' },
    ],
  },
  {
    id: '2026-11-19-2',
    date: '19/11/2026',
    items: [
      { kind: 'new', vi: 'Trang Khách hàng có thanh bên trái như Công việc: tìm nhanh và bấm thẳng vào một khách hàng để mở, không phải quay lại danh sách.', en: 'The Customers page now has a left sidebar like Work: search and click straight into a customer, instead of going back to the list.' },
      { kind: 'fix', vi: 'Nhắc tên @ trong Tin nhắn không còn dính chữ đứng sau vào tên (ví dụ “@Vincent vin” chỉ tô “@Vincent”).', en: 'An @mention in Messages no longer pulls the following word into the name (e.g. “@Vincent vin” highlights only “@Vincent”).' },
    ],
  },
  {
    id: '2026-11-19-1',
    date: '19/11/2026',
    items: [
      { kind: 'fix', vi: 'Trang nhẹ hơn và bớt hiện “Đang tải…”: thay vì từng phần tự hỏi máy chủ mỗi vài giây, trang chỉ hỏi một lần xem có gì mới rồi tải lại đúng phần đã đổi (tin nhắn, thông báo, bảng, công việc, ghi chú), không hiện biểu tượng tải. Khi tab bị ẩn trang không hỏi gì, quay lại là cập nhật ngay.', en: 'A lighter page with less “Loading…”: instead of each part asking the server every few seconds, the page asks once what is new and reloads only what changed (messages, notifications, boards, tasks, notes), without the loading sign. While the tab is hidden it asks nothing, and it catches up as soon as you come back.' },
    ],
  },
  {
    id: '2026-11-18-5',
    date: '18/11/2026',
    items: [
      { kind: 'new', vi: 'Gỡ email nhận thông báo dễ hơn: ở Hồ sơ, email đã lưu hay đang chờ mã xác minh đều có nút Gỡ email. Quản trị viên gỡ email của nhân viên ngay trên thẻ nhân viên (menu › Gỡ email nhận thông báo) hoặc trong hồ sơ nhân viên ở Quản trị.', en: 'Removing a notification email is easier: in your profile, a saved email or one still waiting for its code has a Remove email button. Admins remove someone\'s email straight from their staff card (menu › Remove notification email) or from their profile in Admin.' },
      { kind: 'fix', vi: 'Email nhận thông báo của mọi người đã được gỡ. Vào Hồ sơ để liên kết lại Gmail nếu bạn muốn nhận thông báo qua email.', en: 'Everyone\'s notification email has been removed. Go to your profile to link Gmail again if you want notifications by email.' },
    ],
  },
  {
    id: '2026-11-18-4',
    date: '18/11/2026',
    items: [
      { kind: 'new', vi: 'Mỗi tài khoản một Gmail, dùng chung cho Hộp thư và nhận thông báo: liên kết ở Hồ sơ (nút Liên kết Gmail) hay kết nối ở Hộp thư thì nơi kia cũng có, không cần mã xác minh. Nếu hồ sơ đã có email nhận thông báo, mở Hộp thư là Google mở đúng email đó, chỉ cần bấm Cho phép một lần.', en: 'One Gmail per account, shared by Mail and notifications: link it in your profile (Link Gmail) or connect it in Mail and the other has it too, with no verification code. If your profile already has a notification email, opening Mail takes you to Google with that email, so you only click Allow once.' },
      { kind: 'new', vi: 'Hộp thư gợi ý người nhận như Gmail: gõ vài chữ ở Đến, Cc hoặc Bcc là hiện người bạn hay gửi thư, nhân viên công ty và liên hệ của khách hàng bạn phụ trách. Dùng ↑ ↓ để chọn, Enter hoặc Tab để điền.', en: 'Mail suggests recipients as Gmail does: type a few letters in To, Cc or Bcc to see people you often write to, your colleagues and the contacts of your customers. Use ↑ ↓ to choose and Enter or Tab to fill it in.' },
      { kind: 'new', vi: 'Đổi tên kênh nhanh: bấm đúp vào tên kênh hoặc chuột phải › Đổi tên kênh, gõ tên mới rồi Enter (Esc để huỷ). Người tạo kênh cũng đổi tên được kênh của mình.', en: 'Rename a channel quickly: double-click its name or right-click › Rename channel, type the new name and press Enter (Esc cancels). Whoever made a channel can rename it too.' },
      { kind: 'fix', vi: 'Tin nhắn không còn báo “Trang này gặp lỗi” khi trang được mở từ trước lúc cập nhật.', en: 'Messages no longer shows “Something went wrong on this page” when the page was open from before an update.' },
    ],
  },
  {
    id: '2026-11-18-3',
    date: '18/11/2026',
    items: [
      { kind: 'new', vi: 'Cài đặt máy chủ trong Tin nhắn (nút ⚙ cạnh tên máy chủ): tạo role riêng của từng máy chủ như Discord (tên, màu, thứ tự), bật quyền Nhắn tin hoặc Quản lý cho role, gán role cho thành viên. Tên trong chat mang màu role cao nhất; quyền từng kênh chọn được theo role.', en: 'Server settings in Messages (the ⚙ next to the server name): make each server\'s own roles as on Discord (name, colour, order), give a role Send or Manage, and assign roles to members. Names in the chat take their highest role\'s colour, and each channel\'s permissions can pick roles.' },
      { kind: 'new', vi: 'Máy chủ của nhãn hàng trong Tin nhắn hiện luôn thông tin khách hàng bên phải khung chat: trạng thái, người phụ trách, tiến độ và việc đang làm, liên hệ, tag, Drive và thành viên như trang chi tiết khách hàng. Kéo mép trái để mở rộng; bật tắt bằng nút 👤 trên đầu kênh.', en: 'A brand\'s server in Messages shows its customer beside the chat: status, who handles them, progress and work under way, contact, tags, Drive and members as on the customer\'s page. Drag its left edge to widen it; the 👤 button at the top of the channel shows or hides it.' },
      { kind: 'new', vi: 'Nút + dưới danh sách máy chủ trong Tin nhắn tạo workspace mới như ở trang Workspace; máy chủ của nhãn hàng mới có sẵn các kênh.', en: 'The + under the servers in Messages makes a new workspace as on the Workspace page; the new brand\'s server comes with its channels.' },
      { kind: 'new', vi: 'Kéo thả kênh để đổi thứ tự hoặc chuyển sang danh mục khác, kéo tên danh mục để đổi thứ tự danh mục (dành cho người quản lý Tin nhắn).', en: 'Drag channels to reorder them or move them to another category, and drag a category\'s name to reorder categories (for who manages Messages).' },
      { kind: 'new', vi: 'Tin nhắn có kênh #co-gi-moi của hệ thống: mỗi lần DMI Workspace cập nhật, bản tin Có gì mới tự đăng vào kênh và kênh hiện số chưa đọc. Mở kênh để xem lại mọi bản cập nhật trước đó; không ai nhắn trong kênh này.', en: 'Messages has the system\'s #co-gi-moi channel: each time DMI Workspace is updated, its What\'s new is posted there and the channel shows it unread. Open it to look back at every earlier update; nobody writes in it.' },
    ],
  },
  {
    id: '2026-11-18-2',
    date: '18/11/2026',
    items: [
      { kind: 'new', vi: 'Quản lý kênh chat như Discord: người quản lý Tin nhắn thêm, đổi tên, đổi chủ đề, chuyển danh mục và xoá mọi kênh (trừ #general), đổi tên danh mục. Rê chuột vào kênh bấm ⚙, hoặc chuột phải › Chỉnh sửa kênh.', en: 'Manage chat channels as on Discord: who manages Messages adds, renames, retitles, moves and deletes any channel (except #general) and renames categories. Rest on a channel and click ⚙, or right-click › Edit channel.' },
      { kind: 'new', vi: 'Quyền riêng từng kênh (Chỉnh sửa kênh › Quyền): ai xem được kênh (kênh riêng tư, có 🔒) và ai được nhắn (người khác chỉ đọc), chọn theo phòng ban, vai trò hoặc từng nhân viên.', en: 'Each channel\'s own permissions (Edit channel › Permissions): who sees it (a private channel, with 🔒) and who writes in it (the others only read), picked by department, role or person.' },
      { kind: 'new', vi: 'Thả cảm xúc vào bình luận như Facebook: bấm Thích, hoặc rê chuột vào Thích để chọn Yêu thích, Haha, Wow, Buồn, Thương thương, Phẫn nộ. Có ở bình luận của thẻ và của công việc; rê vào số cảm xúc để xem ai đã thả.', en: 'React to comments as on Facebook: click Like, or rest on Like to pick Love, Haha, Wow, Sad, Care or Angry. On card and task comments; rest on the count to see who reacted.' },
      { kind: 'new', vi: 'Ghi chú nhanh đồng bộ giữa các máy: đăng nhập trên máy nào cũng thấy cùng ghi chú, sửa ở máy này thì máy kia tự cập nhật sau vài giây. Nếu hai máy cùng sửa một ghi chú, phần bạn vừa gõ được giữ thành ghi chú mới, không bị ghi đè.', en: 'Quick notes sync across computers: the same notes wherever you sign in, and a change on one computer shows on the other within seconds. If two computers edit the same note, what you just typed is kept as a new note instead of being overwritten.' },
      { kind: 'new', vi: 'Tin nhắn theo phân quyền của Quản trị, gọn còn 2 quyền ở Phân quyền › Tin nhắn: Nhắn tin (gửi tin, file, nhắn riêng; mọi nhân viên có sẵn) và Quản lý (tạo, xoá kênh, ghim và xoá tin của người khác). Kênh của một nhãn hàng theo quyền vào workspace đó.', en: 'Messages follows the site\'s own permissions, down to two in Permissions › Messages: Send (messages, files, direct messages; everyone has it) and Manage (create and delete channels, pin and delete other people\'s messages). A brand\'s channels follow access to its workspace.' },
      { kind: 'new', vi: 'Quản trị › Tin nhắn › Cài đặt Tin nhắn: xem vai trò nào được nhắn tin và chặn từng người nhắn tin (họ vẫn đọc được). Bản Cài đặt máy chủ riêng của Tin nhắn hôm qua đã bỏ.', en: 'Admin › Messages › Message settings: see which roles may send and block a person from sending (they can still read). Yesterday\'s separate Server settings of Messages is gone.' },
    ],
  },
  {
    id: '2026-11-17-2',
    date: '17/11/2026',
    items: [
      { kind: 'new', vi: 'Tools có thêm trang Giọng nói: đọc kịch bản thành giọng, chép lời và xuất phụ đề SRT, lồng tiếng video sang ngôn ngữ khác và nhân bản giọng (cần sự đồng ý của người có giọng). Chạy bằng app VoiceStudio miễn phí trên máy bạn, file không rời máy; lần đầu làm theo hướng dẫn kết nối ngay trên trang.', en: 'Tools has a new Voice page: read a script aloud, transcribe and export SRT subtitles, dub a video into another language and clone a voice (with its owner\'s consent). Runs on the free VoiceStudio app on your computer, so files never leave it; the first time, follow the connection steps on the page.' },
      { kind: 'fix', vi: 'Hộp thư: thư có nhiều ảnh (thư quảng cáo, bản tin) hiện đủ cả thư, không còn bị cắt sau ảnh đầu tiên.', en: 'Mail: messages with many pictures (newsletters, promotions) show in full instead of being cut off after the first picture.' },
      { kind: 'fix', vi: 'Ảnh gửi trong chat không còn hiện thành một đoạn mã dài: ảnh cũ hiện lại thành ảnh, ảnh gửi từ cửa sổ chat nhỏ được lưu như file của cuộc trò chuyện. Danh sách tin nhắn riêng ghi “📷 Ảnh” thay vì đoạn mã.', en: 'Pictures sent in chat no longer show as a long code: older ones show as pictures again, and pictures sent from the small chat window are kept as the conversation\'s files. The direct message list says “📷 Picture” instead of the code.' },
      { kind: 'new', vi: 'Tạo board không cần gõ tên: board lấy tên theo dịch vụ bạn chọn (đổi được sau trong cài đặt board).', en: 'Creating a board needs no name: it is named after the service you pick (rename it later in the board\'s settings).' },
      { kind: 'fix', vi: 'Workspace: nút ← trên thanh đường dẫn về trang trước đó (ví dụ từ board về Workspaces), không mở lại thẻ vừa đóng.', en: 'Workspace: the ← button on the path bar goes to the page before (from a board back to Workspaces, say) instead of reopening the card just closed.' },
      { kind: 'fix', vi: 'Mở một cuộc trò chuyện có ảnh, khung chat ở đúng tin mới nhất thay vì dừng giữa chừng khi ảnh tải xong.', en: 'Opening a conversation with pictures lands on the newest message instead of stopping halfway once the pictures load.' },
    ],
  },
  {
    id: '2026-11-17-1',
    date: '17/11/2026',
    items: [
      { kind: 'new', vi: 'Tin nhắn mang giao diện như Discord: cột máy chủ (DMI Studio, từng nhãn hàng, tin nhắn riêng), danh sách kênh theo nhóm, khung chat và danh sách thành viên đang trực tuyến.', en: 'Messages now look like Discord: a column of servers (DMI Studio, each brand, direct messages), channels in groups, the chat, and the list of members online.' },
      { kind: 'new', vi: 'Gửi file trong chat: bấm 📎, kéo file thả vào khung chat hoặc dán ảnh (Ctrl/⌘ + V). Ảnh hiện xem trước ngay trong tin nhắn, file khác tải xuống được. Tối đa 50 MB một file.', en: 'Send files in chat: click 📎, drop files on the chat or paste a picture (Ctrl/⌘ + V). Pictures show right in the message, other files can be downloaded. Up to 50 MB per file.' },
      { kind: 'new', vi: 'Mỗi cuộc trò chuyện có thư mục riêng (nút 📁 trên đầu chat): tạo thư mục con, tải file lên hoặc kéo thả vào, đi lại bằng đường dẫn phía trên. File chat là riêng tư: chỉ người trong cuộc trò chuyện xem được, tin nhắn riêng chỉ hai người.', en: 'Each conversation has its own folder (the 📁 button at the top of the chat): make folders, upload or drop files, and move around with the path above. Chat files are private: only the people in the conversation can open them, and a direct chat only its two people.' },
      { kind: 'new', vi: 'Bấm chuột phải trong Tin nhắn để có thao tác nhanh: trên tin nhắn (thả cảm xúc, trả lời, ghim, sửa, sao chép, xoá), trên kênh, thành viên, máy chủ và file.', en: 'Right-click in Messages for quick actions: on a message (react, reply, pin, edit, copy, delete), on a channel, a member, a server and a file.' },
      { kind: 'fix', vi: 'Logo workspace không còn khung nền trắng hay đen quanh logo.', en: 'Workspace logos no longer sit on a white or black square.' },
    ],
  },
  {
    id: '2026-11-16-5',
    date: '16/11/2026',
    items: [
      { kind: 'new', vi: 'Khách hàng → workspace → board → công việc luôn đi cùng nhau: mỗi workspace là của một khách hàng (một khách có thể có nhiều workspace), mỗi board là một dịch vụ của khách đó, mỗi dịch vụ của khách chỉ có một board. Việc của dịch vụ tự nằm trên board của nó; đổi dịch vụ của việc thì thẻ chuyển sang board kia.', en: 'Client → workspace → board → task now always go together: each workspace belongs to one client (a client can have several), each board is one of that client\'s services, and each service of a client has one board. A service\'s tasks sit on its board by themselves; change a task\'s service and its card moves to that board.' },
      { kind: 'new', vi: 'Trang khách hàng có tab Workspace & board: xem các workspace của khách, mỗi dịch vụ một board kèm số việc đang mở, thêm dịch vụ (tạo board) hoặc workspace mới ngay tại đó.', en: 'The client page has a Workspaces & boards tab: the client\'s workspaces, one board per service with its open tasks, and adding a service (a new board) or a workspace right there.' },
      { kind: 'new', vi: 'Trang Workspace xem theo khách hàng: các workspace và board gom dưới từng khách, chọn một khách để mọi chế độ xem (lưới, cây thư mục, timeline, dashboard) chỉ hiện của khách đó.', en: 'The Workspace page is by client: workspaces and boards grouped under each client, and pick one client so every view (grid, tree, timeline, dashboard) shows only theirs.' },
      { kind: 'fix', vi: 'Board cũ chưa có dịch vụ sẽ hỏi quản lý board chọn khách hàng và dịch vụ; các board cũ đã tự chuyển theo dịch vụ (ví dụ board gom nhiều dịch vụ được tách thành từng board).', en: 'Older boards with no service ask their managers to choose a client and service; older boards were moved over by service (a board holding several services was split into one board each).' },
    ],
  },
  {
    id: '2026-11-16-4',
    date: '16/11/2026',
    items: [
      { kind: 'new', vi: 'Hộp thư: đọc và gửi email bằng Gmail của chính bạn ngay trong DMI. Vào Hộp thư trên thanh bên, bấm Kết nối Gmail một lần; sau đó xem thư đến, đã gửi, có gắn sao, tìm thư, trả lời, chuyển tiếp và đính kèm tệp. Chỉ bạn xem được hộp thư của mình, thư vẫn nằm trong Gmail như cũ.', en: 'Mail: read and send email with your own Gmail right inside DMI. Open Mail in the sidebar and click Connect Gmail once; then see your inbox, sent and starred mail, search, reply, forward and attach files. Only you can see your mailbox, and your mail stays in Gmail as before.' },
      { kind: 'new', vi: 'Workspace: nút Inbox ở thanh dưới đổi thành Mailbox. Bấm vào để mở thư Gmail của bạn ngay cạnh Planner: đọc, trả lời và soạn thư mới mà không rời board. Tin nhắn nội bộ vẫn mở từ biểu tượng Messenger ở góc trên.', en: 'Workspace: the Inbox button on the bottom bar is now Mailbox. Click it to open your Gmail right beside the Planner: read, reply and write new mail without leaving the board. Team chat still opens from the Messenger icon at the top.' },
      { kind: 'new', vi: 'Viết thư như Gmail: thư mới mở trong cửa sổ nhỏ ở góc dưới bên phải (thu nhỏ, phóng to hoặc đóng được, vẫn dùng trang bên dưới), trả lời và chuyển tiếp viết ngay cuối cuộc trò chuyện. Có thêm Bcc; Ctrl/⌘ + Enter để gửi.', en: 'Write mail as in Gmail: a new message opens in a small window at the bottom right (minimize, enlarge or close it while still using the page), and replies and forwards are written at the foot of the conversation. Bcc is there too; Ctrl/⌘ + Enter sends.' },
      { kind: 'new', vi: 'Hộp thư chuyên nghiệp hơn: định dạng thư như Gmail (phông, cỡ chữ, đậm, nghiêng, màu, căn lề, danh sách, trích dẫn, liên kết); chữ ký tự thêm vào cuối thư, đặt ở nút bánh răng hoặc lấy luôn chữ ký trong Gmail; thêm Quan trọng, Thư rác, Thùng rác, báo cáo thư rác, xoá, khôi phục và đánh dấu chưa đọc.', en: 'A more professional mailbox: format mail as in Gmail (font, size, bold, italic, colour, alignment, lists, quotes, links); a signature added at the end of your mail, set from the gear button or taken from your Gmail; plus Important, Spam and Trash, report spam, delete, restore and mark as unread.' },
      { kind: 'new', vi: 'Board: bấm Thêm thẻ là tạo công việc và mở ngay cửa sổ của nó, tên đã chọn sẵn để gõ đè. Đóng mà chưa sửa gì thì thẻ trống tự bỏ đi.', en: 'Boards: Add a card now creates the task and opens its window straight away, with the name selected so you can type over it. Close it without changing anything and the blank card goes away.' },
    ],
  },
  {
    id: '2026-11-16-3',
    date: '16/11/2026',
    items: [
      { kind: 'fix', vi: 'Người giao việc không tự thêm mình vào công việc: danh sách Người thực hiện, Người theo dõi và Người duyệt không hiện tên bạn (bạn là người duyệt sẵn). Việc con cũng không tự cho bạn theo dõi khi bạn tạo nó.', en: 'Whoever gives a task out no longer adds themselves to it: your name is not offered as Assignee, Follower or Reviewer (you review it by default). A subtask you create does not make you follow it either.' },
    ],
  },
  {
    id: '2026-11-16-2',
    date: '16/11/2026',
    items: [
      { kind: 'new', vi: 'Hồ sơ: công việc xếp theo nhóm cần làm trước (Quá hạn, Đang mở, rồi Hoàn thành và Đã huỷ gập lại), mỗi nhóm hiện 5 việc đầu và có nút Xem thêm. Bấm các ô số liệu để chỉ xem một nhóm; có ô tìm khi nhiều việc.', en: 'Profile: tasks are grouped by what needs doing first (Overdue, Open, then Done and Cancelled folded away), each group shows its first 5 with a Show more button. Click a counter to see one group only; a search box appears when there are many tasks.' },
      { kind: 'fix', vi: 'Trợ lý AI hết tiền API giờ chỉ báo một câu ngắn.', en: 'When the AI assistant runs out of API credit it now says so in one short line.' },
      { kind: 'new', vi: 'Kết nối ChatGPT với DMI, như Claude: mỗi người dùng ChatGPT của chính mình, đăng nhập bằng tài khoản DMI của mình và chỉ làm được những gì tài khoản đó được làm. Hướng dẫn ở Hồ sơ › Kết nối Claude và ChatGPT; nhật ký ghi rõ thay đổi đến từ ChatGPT hay Claude.', en: 'Connect ChatGPT to DMI, like Claude: each person uses their own ChatGPT, signs in with their own DMI account and can only do what that account may do. How-to in Profile › Connect Claude and ChatGPT; the log shows whether a change came from ChatGPT or Claude.' },
    ],
  },
  {
    id: '2026-11-16-1',
    date: '16/11/2026',
    items: [
      { kind: 'new', vi: 'Quản trị › Dịch vụ: bỏ Danh mục dịch vụ, thay bằng Gói dịch vụ. Khi thêm hoặc sửa một dịch vụ, tích chọn các gói có dịch vụ đó; danh sách dịch vụ hiện gói của từng dịch vụ và lọc được theo gói.', en: 'Admin › Services: service categories are gone, replaced by service packages. When adding or editing a service, tick the packages it belongs to; the service list shows each service’s packages and filters by package.' },
    ],
  },
  {
    id: '2026-11-14-8',
    date: '14/11/2026',
    items: [
      { kind: 'fix', vi: 'Giao diện tiếng Anh dịch đủ những phần còn sót: Hồ sơ › Kết nối Claude, dòng nộp/duyệt của công việc, nhắc việc, biểu đồ Thống kê, Quản trị › Dịch vụ và các thông báo của máy chủ.', en: 'The English interface now covers what was still in Vietnamese: Profile › Connect Claude, a task’s submitted/reviewed lines, reminders, the Stats charts, Admin › Services and the server’s messages.' },
    ],
  },
  {
    id: '2026-11-14-7',
    date: '14/11/2026',
    items: [
      { kind: 'fix', vi: 'Trên điện thoại: trang công việc xếp một cột (chi tiết nằm dưới, tên việc dài xuống dòng đủ chữ); trang Workspace vừa màn hình — nút Tạo, các kiểu xem, ô tìm và thanh Inbox/Planner/Board/Đổi board không còn bị cắt, bong bóng chat không che thanh nữa.', en: 'On phones: a task’s page is one column (details below it, a long title wraps in full); the Workspace page fits the screen — the Create buttons, the view tabs, the search and the Inbox/Planner/Board/Switch board bar are no longer cut off, and the chat bubble no longer covers the bar.' },
    ],
  },
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
      { kind: 'new', vi: "Bỏ hẳn khái niệm Dịch vụ, chỉ còn Dịch vụ của khách: Khách hàng → Dịch vụ → Công việc. Mỗi dịch vụ cũ thành một dịch vụ cùng tên (tạo trong danh mục nếu chưa có) và luôn mang tên dịch vụ; trang Dịch vụ thành trang Dịch vụ; tạo hoặc sửa chỉ cần chọn khách và dịch vụ. File sheet có cột \"Dịch vụ\" hay \"Dịch vụ\" đều nhập được.", en: "Services are gone, only customers' services remain: Customer → Service → Task. Each old service became a service of the same name (added to the catalogue if missing) and always carries its service's name; the Services page is now Services; making or editing one only takes a customer and a service. Sheets with a \"Dịch vụ\" or \"Dịch vụ\" column both import." },
      { kind: 'fix', vi: 'Thẻ dịch vụ trên board hiện tên dịch vụ và danh sách công việc bên trong (bước, hạn chót, bấm để mở), thêm được công việc mới cho dịch vụ. Thẻ thường chưa gắn công việc khi mở sẽ tự thành công việc, có đủ thanh quy trình, việc con và các trường; công việc bắt đầu ở đúng bước của cột.', en: 'A service\'s card on a board shows the service\'s name and the tasks under it (step, due date, click to open), and takes new tasks for the service. A plain card with no task becomes one when opened, with the workflow bar, subtasks and fields; the task starts at its column\'s step.' },
      { kind: 'fix', vi: 'Bỏ dạng xem Thẻ ở trang Dịch vụ: chỉ còn Danh sách và Bảng.', en: 'The Services page drops its Cards view: List and Table remain.' },
      { kind: 'fix', vi: 'Mỗi dịch vụ là một dịch vụ của khách: chỉ chọn một dịch vụ (trang dịch vụ, sửa dịch vụ, tạo nhanh). Tổng quan trong trang dịch vụ cuộn được. Ô trả lời bình luận gọn lại: tên người được trả lời một dòng, nút × nhỏ, ô nhập rộng hết khung.', en: 'A service is one service of its customer: pick one service only (service page, service editing, quick create). The Overview on a service page scrolls. The comment reply box is tidier: who is answered on one line, a small ×, a full-width box.' },
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
      { kind: 'new', vi: 'Dịch vụ thay cho Dịch vụ, giống Base Wework: Khách hàng → Dịch vụ → Công việc. Khi tạo hay sửa công việc, và trên thẻ của board, chỉ cần chọn Khách hàng và Dịch vụ; công việc tự vào đúng nhóm dịch vụ đó của khách (tự tạo nếu khách chưa có).', en: 'Services replace Services, like Base Wework: Client → Service → Task. When creating or editing a task, and on a board card, just pick the Client and the Service; the work goes into that service of the client automatically (created if the client doesn’t have it yet).' },
      { kind: 'new', vi: 'Trang khách hàng có tab Dịch vụ thay cho Dịch vụ: thêm dịch vụ cho khách từ danh mục, bấm vào một dịch vụ để xem và giao công việc của dịch vụ đó.', en: 'A client’s page has a Services tab instead of Services: add a service from the catalogue, and click one to see and assign its tasks.' },
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
      { kind: 'fix', vi: 'Nút trở về của trình duyệt quay về đúng màn hình trước (danh sách khách hàng, danh sách dịch vụ, tất cả board) thay vì thoát khỏi trang hay hiện màn hình trắng.', en: 'The browser’s Back button returns to the previous screen (the client list, the service list, all boards) instead of leaving the page or showing a blank screen.' },
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
      { kind: 'new', vi: 'Danh sách board: kéo một công việc thả vào dịch vụ để chuyển công việc vào dịch vụ đó, hoặc thả xuống vùng cuối để bỏ khỏi dịch vụ.', en: 'Board list: drag a task onto a service to move it in, or onto the space below to take it out of its service.' },
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
      { kind: 'new', vi: 'Dịch vụ cho từng công việc (và thẻ): chọn gọn bằng nút +, dịch vụ của dịch vụ được gợi ý trước. Ô chọn dịch vụ của dịch vụ cũng gọn hơn.', en: 'Services on each task (and card): pick them with a small +, the service’s services suggested first. The service’s service picker is tidier too.' },
      { kind: 'new', vi: 'Nút chọn chế độ xem ở mỗi workspace: Board, Danh sách board (bấm một board để xem các dịch vụ và công việc bên trong dạng cây) hoặc Dashboard. Dashboard có số việc đang mở, quá hạn, sắp đến hạn và biểu đồ theo khách hàng, theo dịch vụ: bấm vào để lọc. Mỗi khách một khung với công việc dạng cây (việc con nằm dưới việc cha): kéo thả một việc lên việc khác để thành việc con, bấm để mở việc hoặc trang khách hàng. Danh sách dài có chọn trang.', en: 'A view switch on each workspace: Board, Board list (click a board to see its services and tasks as a tree) or Dashboard. The dashboard shows open, overdue and due-soon work, with charts by client and by service that filter when clicked. Each client gets a box with its work as a tree (subtasks under their task): drag a task onto another to make it a subtask, click to open the task or the client. Long lists come in pages.' },
    ],
  },
  {
    id: '2026-11-09',
    date: '09/11/2026',
    items: [
      { kind: 'new', vi: 'Dịch vụ theo dịch vụ: mỗi dịch vụ chọn dịch vụ từ danh mục; dịch vụ của khách hàng tự lấy từ các dịch vụ của khách.', en: 'Services per service: each service picks its services from the catalogue; a client’s services come from its services.' },
      { kind: 'new', vi: 'Gắn board với khách hàng: khi tạo board hoặc trong menu của board, chọn khách có sẵn hoặc tạo khách hàng mới ngay tại chỗ.', en: 'Link a board to a client: when creating a board or from the board menu, pick a client or create one on the spot.' },
      { kind: 'new', vi: 'Nút Sửa dịch vụ: đổi tên, khách hàng, dịch vụ và trạng thái trong một hộp thoại.', en: 'Edit service: name, client, services and status in one dialog.' },
      { kind: 'new', vi: 'Dán ảnh (Ctrl/⌘ V) vào tin nhắn Messenger và vào yêu cầu Hỗ trợ (tối đa 3 ảnh).', en: 'Paste pictures (Ctrl/⌘ V) into Messenger and into Support requests (up to 3).' },
      { kind: 'new', vi: 'Kéo nút Messenger đi chỗ khác trên màn hình; vị trí được nhớ.', en: 'Drag the Messenger bubble anywhere on the screen; it stays there.' },
      { kind: 'new', vi: 'Dán link thư mục Drive ngay ở thẻ Drive trong phần Tổng quan của khách hàng.', en: 'Paste a Drive folder link right on the Drive card of a client’s overview.' },
      { kind: 'new', vi: 'Giao diện tiếng Anh đầy đủ hơn: ngày tháng, thứ trong tuần và các nút còn sót tiếng Việt giờ đã là tiếng Anh (chọn English ở menu tài khoản).', en: 'A complete English interface: dates, weekdays and the buttons still in Vietnamese are now in English (choose English in the account menu).' },
      { kind: 'fix', vi: 'Số tin nhắn chưa đọc giờ đúng trên mọi máy và mất đi khi đã đọc.', en: 'Unread message counts are right on every device and clear once read.' },
      { kind: 'fix', vi: 'Đóng được bong bóng chat; nó chỉ hiện lại khi có tin nhắn mới.', en: 'Chat bubbles close and stay closed until a new message arrives.' },
      { kind: 'fix', vi: 'Người được phân quyền “Tạo khách hàng” thêm được khách ở trang Khách hàng.', en: 'People given “Create client” in Permissions can add clients on the Client page.' },
      { kind: 'fix', vi: 'Dán link vào mô tả thẻ không còn hiện chữ <div>.', en: 'Pasting a link into a card description no longer shows <div>.' },
      { kind: 'fix', vi: 'Ảnh đại diện hiện trên thanh trên; danh sách dịch vụ không còn chồng chữ khi cuộn ngang.', en: 'Your profile picture shows on the top bar; the service list no longer overlaps text when scrolled sideways.' },
      { kind: 'fix', vi: 'Trên điện thoại: thanh trên vừa màn hình và nút Messenger không che thanh dưới.', en: 'On phones: the top bar fits the screen and the Messenger bubble no longer covers the bottom bar.' },
    ],
  },
];
