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
