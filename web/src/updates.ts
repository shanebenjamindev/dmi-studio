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
