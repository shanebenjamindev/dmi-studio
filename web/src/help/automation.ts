// Trợ giúp › Tự động hoá: the guide to Quản trị › Tự động hoá (admin/pages/Automation.tsx, server/automation.ts), in the
// order Bizfly CRM's help puts its rules guide: what a rule is, how to make one, each block and every box in it, real
// examples, and what to watch out for. Plain HTML, shown by components/Help.tsx.
import type { Article } from './types';

const cat = 'Tự động hoá';
export const AUTOMATION: Article[] = [
  {
    slug: 'tu-dong-hoa-khai-niem', cat, title: '1. Khái niệm và quy tắc',
    html: `
<p>Tự động hoá giúp phần mềm <b>tự làm thay bạn</b> những việc lặp đi lặp lại: giao việc, nhắc hạn, báo người duyệt, chia khách hàng cho sale, tạo việc định kỳ, gửi dữ liệu sang n8n hay Zapier… Mỗi việc như vậy là một <b>luật</b>.</p>
<h3>Một luật gồm những gì</h3>
<p>Luật chạy theo logic <b>“Nếu … thì …”</b>, giống hàm IF trong Excel:</p>
<ol>
  <li><b>Kích hoạt</b> (khi nào): một sự kiện, ví dụ “Công việc được tạo”, “Khách hàng mới”, “Sắp đến hạn”, “Theo lịch mỗi thứ Hai 8:30”.</li>
  <li><b>Điều kiện</b> (với bản ghi nào, tuỳ chọn): ví dụ chỉ việc của khách hàng X, chỉ việc chưa có người làm.</li>
  <li><b>Các bước</b> (làm gì), chạy lần lượt từ trái sang phải: hành động (gửi thông báo, giao việc…), khối <b>Nếu / Thì</b> rẽ hai nhánh, khối <b>Đợi, hẹn giờ</b> chờ rồi chạy tiếp.</li>
</ol>
<p>Trên màn hình, một luật là một chuỗi <b>node</b> (ô vuông) nối với nhau bằng dây, giống n8n: node đầu tiên (cạnh trái bo tròn, có dấu tia sét) là Kích hoạt.</p>
<h3>Ba loại luật</h3>
<table>
  <tr><th>Loại</th><th>Kích hoạt</th><th>Làm việc trên</th></tr>
  <tr><td>Luật công việc</td><td>Được tạo, chuyển bước, trường thay đổi, có bình luận, quá hạn, sắp đến hạn</td><td>Một công việc: có thể giao việc, bình luận, đổi hạn, chuyển bước…</td></tr>
  <tr><td>Luật khách hàng</td><td>Khách hàng mới, đổi trạng thái, đổi người phụ trách</td><td>Một khách hàng: có thể chia người phụ trách, đổi trạng thái…</td></tr>
  <tr><td>Luật theo lịch / webhook</td><td>Theo lịch, Webhook gọi vào</td><td>Không gắn bản ghi nào: thường tạo việc định kỳ, gửi thông báo, gọi webhook.</td></tr>
</table>
<h3>Quy tắc quan trọng</h3>
<ul>
  <li><b>Luật chạy bằng quyền của người lưu luật.</b> Người bấm Lưu sau cùng là người “thực hiện” các hành động: bình luận hiện dưới tên họ, và luật chỉ làm được những gì họ được phép làm. Nếu người đó bị khoá tài khoản, luật báo lỗi; hãy mở luật và lưu lại bằng tài khoản khác.</li>
  <li><b>Luật không kích hoạt luật khác.</b> Thay đổi do một luật tạo ra (ví dụ luật A giao việc) không làm luật khác chạy theo, để tránh vòng lặp vô tận.</li>
  <li><b>Chỉ áp dụng cho sự kiện xảy ra sau khi bật luật.</b> Dữ liệu đã có từ trước không tự chạy; muốn áp dụng thì dùng <b>Chạy cho dữ liệu có sẵn</b> (xem bài 8).</li>
  <li>Luật có thể <b>bật / tắt</b> bất cứ lúc nào bằng công tắc ở danh sách luật hoặc trên thanh trên của trình soạn.</li>
</ul>
<aside class="tip"><b>Ai dùng được</b> — Trang Quản trị › Tự động hoá cần quyền <b>Tự động hoá › Xem</b>; tạo, sửa, chạy thử và xoá luật cần <b>Tự động hoá › Quản lý</b>. Super Admin và Admin có sẵn; người khác được cấp ở Quản trị › Phân quyền.</aside>`,
  },
  {
    slug: 'tu-dong-hoa-cach-tao', cat, title: '2. Cách tạo một luật, từng bước',
    html: `
<ol>
  <li>Vào <b>Quản trị › Tự động hoá › Luật tự động</b>.</li>
  <li>Bấm <b>Tạo luật</b> (hoặc bấm một <b>Mẫu</b> bên dưới danh sách để bắt đầu từ luật có sẵn). Trình soạn mở toàn màn hình.</li>
  <li>Bấm vào tên “Luật mới” ở góc trên bên trái để đặt tên dễ hiểu, ví dụ “Chia khách mới cho sale”.</li>
  <li>Bấm ô <b>Thêm bước đầu tiên…</b> và chọn <b>kích hoạt</b> ở bảng bên phải. Cửa sổ chi tiết của node mở ra để bạn điền thông số (xem bài 3).</li>
  <li>Bấm <b>Về canvas</b>. Ở cuối dây có nút <b>+</b>: bấm để thêm bước tiếp theo. Bảng “Bước tiếp theo là gì?” chia theo nhóm: Logic (Lọc, Nếu/Thì, Đợi), Tin nhắn, Nhân sự, Dữ liệu, Ứng dụng. Gõ vào ô tìm để lọc nhanh.</li>
  <li>Mỗi bước mới mở ngay cửa sổ chi tiết. Điền các ô, rồi bấm <b>Về canvas</b>. Lặp lại cho các bước khác.</li>
  <li>Bấm <b>Lưu</b> ở góc trên bên phải. Thanh trên hiện “Chưa lưu” khi có thay đổi chưa lưu.</li>
  <li>Bấm <b>Chạy thử luật</b> (nút xanh ở giữa đáy màn hình) để thử ngay trên một công việc hoặc khách hàng (dán mã hoặc link). Kết quả xem ở tab <b>Lịch sử chạy</b>.</li>
</ol>
<h3>Thao tác trên canvas</h3>
<table>
  <tr><th>Muốn</th><th>Làm</th></tr>
  <tr><td>Mở / sửa một bước</td><td>Bấm vào node.</td></tr>
  <tr><td>Di chuyển node</td><td>Giữ chuột (hoặc ngón tay) trên node và kéo đi; dây tự uốn theo. Vị trí được lưu cùng luật.</td></tr>
  <tr><td>Di chuyển cả canvas</td><td>Kéo vào chỗ trống trên lưới chấm.</td></tr>
  <tr><td>Phóng to / thu nhỏ</td><td>Các nút + / − ở góc dưới bên trái; nút mũi tên chéo để về giữa; nút lưới để <b>Sắp xếp lại</b> mọi node thành hàng.</td></tr>
  <tr><td>Chèn bước vào giữa</td><td>Rê chuột lên canvas, bấm nút + nhỏ nằm giữa dây nối hai bước.</td></tr>
  <tr><td>Đổi thứ tự bước</td><td>Mở bước, bấm mũi tên ‹ / › trên đầu cửa sổ (chạy sớm hơn / muộn hơn một bước).</td></tr>
  <tr><td>Xoá bước</td><td>Rê chuột lên node, bấm biểu tượng thùng rác phía trên; hoặc mở bước và bấm thùng rác.</td></tr>
</table>
<h3>Cửa sổ chi tiết của một node</h3>
<p>Giống n8n, cửa sổ chia ba cột:</p>
<ul>
  <li><b>Đầu vào</b> (trái): các <b>trường</b> có thể chèn vào chữ, ví dụ <code>{{task.title}}</code>. Bấm vào ô chữ cần chèn trước, rồi bấm trường: trường được chèn đúng chỗ con trỏ. Xem danh sách đầy đủ ở bài 6.</li>
  <li><b>Tham số</b> (giữa): các ô cần điền của bước. Mỗi ô có một dòng giải thích ngay bên dưới.</li>
  <li><b>Đầu ra</b> (phải): kết quả lần chạy gần nhất của luật (thành công hay lỗi, từng bước đã làm gì).</li>
</ul>
<p>Nút <b>Hướng dẫn</b> trên đầu cửa sổ mở bài trợ giúp của đúng loại bước đó trong tab mới.</p>
<h3>Tuỳ chọn của luật</h3>
<p>Bấm biểu tượng bánh răng trên thanh trên (cạnh công tắc Bật): <b>Mỗi công việc / khách hàng chỉ chạy một lần</b> và <b>Chỉ chạy trong giờ làm việc</b>. Xem bài 7.</p>`,
  },
  {
    slug: 'tu-dong-hoa-kich-hoat', cat, title: '3. Kích hoạt: khi nào luật chạy',
    html: `
<p>Node Kích hoạt luôn đứng đầu luật. Bấm vào nó để đổi loại hoặc thông số.</p>
<aside class="warn"><b>Đổi loại kích hoạt</b> — Đổi sang loại khác nhóm (ví dụ từ “Công việc được tạo” sang “Khách hàng mới” hoặc “Theo lịch”) sẽ <b>xoá điều kiện và các bước</b>, vì chúng làm việc trên loại dữ liệu khác. Đổi trong cùng nhóm thì giữ nguyên.</aside>
<h3>Nhóm Công việc</h3>
<table>
  <tr><th>Kích hoạt</th><th>Chạy khi</th><th>Ô cần điền</th></tr>
  <tr><td>Công việc được tạo</td><td>Có công việc mới: tạo ở trang Công việc, thêm thẻ trên board, hoặc do Claude tạo.</td><td>Không có.</td></tr>
  <tr><td>Công việc chuyển bước</td><td>Công việc sang một bước của quy trình duyệt (ACCOUNT, EXECUTION, REVIEW, COMPLETED, REJECTED), từ trang công việc hay kéo thẻ trên board.</td><td><b>Sang bước</b>: chỉ chạy khi vào đúng bước này; để “Bất kỳ bước nào” thì chạy mỗi lần đổi bước.</td></tr>
  <tr><td>Trường dữ liệu thay đổi</td><td>Một trường của công việc đổi giá trị.</td><td><b>Trường</b>: Hạn chót (đặt, đổi, bỏ), Người thực hiện (giao, đổi), Dịch vụ.</td></tr>
  <tr><td>Có bình luận mới</td><td>Có người bình luận vào công việc.</td><td>Không có. Dùng điều kiện “Nội dung bình luận có chứa …” để lọc, ví dụ chữ “gấp”.</td></tr>
  <tr><td>Công việc quá hạn</td><td>Công việc chưa xong vừa qua hạn chót.</td><td>Không có. Kiểm tra mỗi phút.</td></tr>
  <tr><td>Sắp đến hạn</td><td>Còn một số giờ nữa là tới hạn chót của công việc chưa xong.</td><td><b>Trước hạn</b>: số giờ, ví dụ 24 = nhắc trước một ngày.</td></tr>
</table>
<h3>Nhóm Khách hàng</h3>
<table>
  <tr><th>Kích hoạt</th><th>Chạy khi</th><th>Ô cần điền</th></tr>
  <tr><td>Khách hàng mới</td><td>Có khách hàng mới được thêm (ở trang Khách hàng hoặc Drive).</td><td>Không có.</td></tr>
  <tr><td>Khách hàng đổi trạng thái</td><td>Trạng thái của khách hàng thay đổi.</td><td><b>Sang trạng thái</b>: chỉ chạy khi sang đúng trạng thái này; để “Bất kỳ” thì chạy mỗi lần đổi.</td></tr>
  <tr><td>Đổi người phụ trách khách</td><td>Khách hàng được giao cho người phụ trách khác.</td><td>Không có.</td></tr>
</table>
<h3>Nhóm Khác</h3>
<table>
  <tr><th>Kích hoạt</th><th>Chạy khi</th><th>Ô cần điền</th></tr>
  <tr><td>Theo lịch</td><td>Đến giờ đã hẹn.</td><td><b>Lặp lại</b>: hằng ngày / hằng tuần / hằng tháng. <b>Vào</b>: thứ trong tuần hoặc ngày trong tháng (1–28). <b>Lúc</b>: giờ Việt Nam. Danh sách luật hiện “Lần tới …”.</td></tr>
  <tr><td>Webhook gọi vào</td><td>Một hệ thống khác (n8n, Zapier, Make, form trên website…) gửi POST tới địa chỉ riêng của luật.</td><td>Không cần điền. Sau khi <b>Lưu</b>, node hiện địa chỉ webhook và nút <b>Chép</b>. Dữ liệu JSON gửi kèm dùng được trong chữ bằng <code>{{body.tên_trường}}</code>.</td></tr>
</table>
<aside class="tip"><b>Ví dụ gọi webhook</b> — Từ n8n: thêm node HTTP Request, Method POST, URL = địa chỉ đã chép, Body JSON <code>{"msg": "Có đơn mới", "khach": "Garage A"}</code>. Trong luật, viết thông báo “{{body.msg}} từ {{body.khach}}”. Giữ bí mật địa chỉ này: ai có địa chỉ đều chạy được luật.</aside>`,
  },
  {
    slug: 'tu-dong-hoa-dieu-kien', cat, title: '4. Điều kiện: Lọc và Nếu / Thì',
    html: `
<p>Có hai chỗ đặt điều kiện:</p>
<ul>
  <li><b>Lọc</b> (node màu cam ngay sau kích hoạt): điều kiện chung. Bản ghi không thoả thì luật <b>không chạy</b> và không ghi vào lịch sử. Thêm bằng nút + đầu tiên, chọn “Lọc (điều kiện chung)”.</li>
  <li><b>Nếu / Thì</b> (một bước trong chuỗi): rẽ <b>hai nhánh</b>. Node có hai cổng ra: <b>Đúng</b> (xanh, phía trên) và <b>Sai</b> (đỏ, phía dưới). Mỗi nhánh có nút + riêng để thêm bước. Chạy xong nhánh, luật chạy tiếp các bước sau khối Nếu/Thì. Có thể đặt Nếu/Thì lồng trong một nhánh (tối đa hai tầng).</li>
</ul>
<h3>Cách điền một điều kiện</h3>
<p>Mỗi dòng điều kiện có ba ô: <b>trường</b> — <b>phép so sánh</b> — <b>giá trị</b>.</p>
<table>
  <tr><th>Trường (luật công việc)</th><th>Phép so sánh</th><th>Giá trị</th></tr>
  <tr><td>Khách hàng</td><td>là / không phải / đang trống / đã có</td><td>Chọn khách hàng</td></tr>
  <tr><td>Dịch vụ</td><td>là / không phải / đang trống / đã có</td><td>Chọn dịch vụ (khách · nhãn hàng · dịch vụ)</td></tr>
  <tr><td>Người thực hiện</td><td>là / không phải / đang trống / đã có</td><td>Chọn người. “Đang trống” = chưa giao cho ai.</td></tr>
  <tr><td>Bước</td><td>là / không phải</td><td>ACCOUNT, EXECUTION, REVIEW, COMPLETED, REJECTED</td></tr>
  <tr><td>Hạn chót</td><td>là / không phải</td><td>Đã quá hạn, Đến hạn hôm nay, Trong 7 ngày tới, Chưa có hạn</td></tr>
  <tr><td>Tên công việc</td><td>có chứa / không phải (không chứa)</td><td>Gõ từ khoá (không phân biệt hoa thường)</td></tr>
  <tr><td>Nội dung bình luận</td><td>có chứa / không phải</td><td>Gõ từ khoá. Chỉ có nghĩa với kích hoạt “Có bình luận mới”.</td></tr>
</table>
<table>
  <tr><th>Trường (luật khách hàng)</th><th>Phép so sánh</th><th>Giá trị</th></tr>
  <tr><td>Trạng thái khách</td><td>là / không phải / đang trống / đã có</td><td>Chọn trạng thái</td></tr>
  <tr><td>Người phụ trách khách</td><td>là / không phải / đang trống / đã có</td><td>Chọn người. “Đang trống” = chưa có ai phụ trách.</td></tr>
  <tr><td>Tên khách hàng</td><td>có chứa / không phải</td><td>Gõ từ khoá</td></tr>
</table>
<h3>Tất cả hay một trong</h3>
<p>Dòng đầu “Chạy khi <b>tất cả</b> / <b>một trong</b> các điều kiện sau đúng” quyết định cách ghép nhiều điều kiện: <b>tất cả</b> = VÀ (mọi dòng đều đúng), <b>một trong</b> = HOẶC (chỉ cần một dòng đúng).</p>
<aside class="tip"><b>Dữ liệu mới nhất</b> — Nếu/Thì kiểm tra công việc / khách hàng <b>tại lúc chạy tới bước đó</b>, nghĩa là đã tính các thay đổi của bước trước và sau khi Đợi. Ví dụ “Đợi 8 giờ → Nếu Bước là ACCOUNT” sẽ biết việc đã được giao hay chưa sau 8 giờ.</aside>`,
  },
  {
    slug: 'tu-dong-hoa-hanh-dong', cat, title: '5. Hành động: từng ô cần điền',
    html: `
<p>Hành động là việc luật làm. Một số hành động chỉ có ở luật công việc hoặc luật khách hàng; bảng chọn bước chỉ hiện những hành động dùng được.</p>
<h3 id="notify">Gửi thông báo</h3>
<ul>
  <li><b>Gửi cho</b>: chọn vai trò để luật tự tìm đúng người của từng bản ghi — Người thực hiện, Người tạo, Người duyệt, Người theo dõi, Người phụ trách khách — hoặc chọn tên cụ thể. Chọn được nhiều.</li>
  <li><b>Tiêu đề</b>: dòng chữ đậm, ví dụ “Việc chờ bạn duyệt: <code>{{task.title}}</code>”.</li>
  <li><b>Nội dung</b>: dòng nhỏ bên dưới (tuỳ chọn), ví dụ “<code>{{customer}}</code> · Hạn <code>{{task.due}}</code>”.</li>
</ul>
<p>Thông báo hiện ở chuông của người nhận, bấm vào mở thẳng công việc / khách hàng; ai bật email ở Hồ sơ thì nhận cả email.</p>
<h3 id="comment">Thêm bình luận</h3>
<p><b>Bình luận</b>: nội dung viết vào công việc, dưới tên người lưu luật. Người trong công việc nhận thông báo như bình luận thường.</p>
<h3 id="assign">Giao việc / Giao người phụ trách khách</h3>
<ul>
  <li><b>Cách chia</b>:
    <ul>
      <li><b>Cố định</b>: luôn người đầu tiên trong danh sách (người đó nghỉ thì người kế tiếp).</li>
      <li><b>Chia đều vòng tròn</b>: lần lượt A → B → C → A…</li>
      <li><b>Theo tỷ trọng</b>: mỗi người một số “phần”; ví dụ A 4 phần, B 1 phần thì A nhận khoảng 80%, B 20%.</li>
      <li><b>Người ít việc nhất</b>: người đang có ít công việc chưa xong nhất.</li>
    </ul>
  </li>
  <li><b>Nhân sự</b>: những người có thể được giao. Người có tên trong <b>Danh sách nghỉ</b> hôm nay được bỏ qua; nếu tất cả đều nghỉ, bước báo lỗi.</li>
</ul>
<p>“Giao việc” thay người thực hiện của công việc. “Giao người phụ trách khách” đổi người phụ trách của khách hàng.</p>
<h3 id="follow">Thêm người theo dõi</h3>
<p><b>Thêm</b>: những người được thêm vào danh sách theo dõi; người đã theo dõi giữ nguyên.</p>
<h3 id="reviewer">Đặt người duyệt</h3>
<p><b>Người duyệt</b>: người chấm PASS / REDO / FAIL ở bước REVIEW.</p>
<h3 id="update_task">Cập nhật hạn chót</h3>
<ul>
  <li><b>Hạn chót</b>: “Đặt sau một số ngày” hoặc “Bỏ hạn chót”.</li>
  <li><b>Sau</b>: số ngày tính từ lúc luật chạy; hạn là 23:59 của ngày đó. Ví dụ 2 = cuối ngày kia.</li>
</ul>
<h3 id="flow">Chuyển bước quy trình</h3>
<p><b>Chuyển</b>: Giao việc (ACCOUNT → EXECUTION, công việc phải có người thực hiện), Nộp duyệt (→ REVIEW), Duyệt PASS (→ COMPLETED). Người lưu luật phải có quyền làm bước đó, ví dụ duyệt PASS cần là người duyệt hoặc Admin; không có quyền thì bước báo lỗi.</p>
<h3 id="customer_status">Đổi trạng thái khách</h3>
<p><b>Trạng thái</b>: trạng thái mới của khách hàng.</p>
<h3 id="create_task">Tạo công việc</h3>
<ul>
  <li><b>Tên việc</b> (bắt buộc), có thể chèn trường: “Gọi lại cho <code>{{customer}}</code>”.</li>
  <li><b>Mô tả</b> (tuỳ chọn).</li>
  <li><b>Dịch vụ</b>: việc mới thuộc dịch vụ nào (và lên board của dịch vụ đó); để trống là việc chung.</li>
  <li><b>Giao cho</b>: người làm; để trống thì việc chờ ở ACCOUNT.</li>
  <li><b>Hạn</b>: số ngày sau khi tạo; để trống là không có hạn.</li>
</ul>
<h3 id="webhook">Gọi webhook</h3>
<ul>
  <li><b>URL</b>: địa chỉ nhận, phải bắt đầu bằng <code>https://</code>.</li>
</ul>
<p>Luật gửi POST với JSON gồm: <code>rule</code>, <code>by</code> (người lưu luật), <code>from</code> / <code>to</code> (giá trị trước / sau khi đổi), <code>body</code> (dữ liệu webhook gọi vào), <code>comment</code>, <code>at</code>, <code>task</code> (id, title, stage, dueAt, customer, service, assignees, link) và <code>customer</code> (id, name, status, owner, link). Nơi nhận trả lỗi (mã 4xx/5xx) hoặc không trả lời sau 8 giây thì bước báo lỗi.</p>`,
  },
  {
    slug: 'tu-dong-hoa-doi-hen-gio', cat, title: '6. Đợi, hẹn giờ và các trường {{…}}',
    html: `
<h3>Khối Đợi, hẹn giờ</h3>
<ul>
  <li><b>Đợi</b>: số lượng và đơn vị (phút, giờ, ngày).</li>
  <li><b>Chỉ tính giờ làm việc</b>: bật thì chỉ tính thời gian trong giờ làm việc (Cài đặt chung). Ví dụ giờ làm 8:00–17:30, đợi 2 giờ làm việc từ 16:30 thứ Sáu sẽ chạy tiếp lúc 9:00 thứ Hai.</li>
</ul>
<p>Khi tới khối Đợi, luật dừng lại và xếp một lượt <b>chạy tiếp</b>. Các lượt này xem ở tab <b>Đang chờ</b> của luật (giờ chạy tiếp, bản ghi, tại bước nào), huỷ được từng lượt. Khi chạy tiếp, luật đọc lại dữ liệu mới nhất của bản ghi. Tắt luật thì các lượt chờ không chạy.</p>
<h3>Các trường chèn vào chữ</h3>
<p>Ở các ô chữ (tiêu đề, nội dung, bình luận, tên việc), gõ hoặc bấm chèn trường trong cột <b>Đầu vào</b>. Khi chạy, trường được thay bằng giá trị thật.</p>
<table>
  <tr><th>Trường</th><th>Thành</th><th>Dùng trong luật</th></tr>
  <tr><td><code>{{task.title}}</code></td><td>Tên công việc</td><td>Công việc</td></tr>
  <tr><td><code>{{task.link}}</code></td><td>Link mở công việc</td><td>Công việc</td></tr>
  <tr><td><code>{{task.due}}</code></td><td>Hạn chót (giờ, ngày)</td><td>Công việc</td></tr>
  <tr><td><code>{{task.stage}}</code></td><td>Bước hiện tại (ACCOUNT…)</td><td>Công việc</td></tr>
  <tr><td><code>{{assignee}}</code></td><td>Tên người thực hiện</td><td>Công việc</td></tr>
  <tr><td><code>{{customer}}</code></td><td>Tên khách hàng</td><td>Công việc, khách hàng</td></tr>
  <tr><td><code>{{service}}</code></td><td>Tên dịch vụ</td><td>Công việc</td></tr>
  <tr><td><code>{{customer.link}}</code>, <code>{{customer.status}}</code>, <code>{{customer.owner}}</code></td><td>Link, trạng thái, người phụ trách của khách</td><td>Khách hàng</td></tr>
  <tr><td><code>{{from}}</code>, <code>{{to}}</code></td><td>Giá trị trước và sau khi đổi (bước, trạng thái)</td><td>Chuyển bước, đổi trạng thái</td></tr>
  <tr><td><code>{{comment}}</code></td><td>Nội dung bình luận</td><td>Có bình luận mới</td></tr>
  <tr><td><code>{{body.tên}}</code></td><td>Một trường trong JSON gửi vào</td><td>Webhook gọi vào</td></tr>
  <tr><td><code>{{rule}}</code></td><td>Tên luật</td><td>Mọi luật</td></tr>
</table>`,
  },
  {
    slug: 'tu-dong-hoa-cai-dat', cat, title: '7. Cài đặt chung và tuỳ chọn của luật',
    html: `
<h3>Cài đặt chung</h3>
<p>Nút <b>Cài đặt chung</b> trên đầu trang Tự động hoá. Áp dụng cho mọi luật:</p>
<ul>
  <li><b>Ngày làm việc</b>: bấm chọn các thứ làm việc (mặc định Thứ Hai – Thứ Sáu).</li>
  <li><b>Giờ làm việc</b>: giờ bắt đầu và kết thúc, giờ Việt Nam (mặc định 08:00 – 17:30).</li>
  <li><b>Danh sách nghỉ</b>: mỗi dòng một người và khoảng ngày nghỉ (từ – đến). Trong những ngày đó, người ấy không được chia việc hay khách hàng tự động.</li>
</ul>
<h3>Tuỳ chọn của từng luật</h3>
<p>Bấm biểu tượng bánh răng trên thanh trên của trình soạn:</p>
<ul>
  <li><b>Mỗi công việc / khách hàng chỉ chạy một lần</b>: bản ghi đã chạy luật này rồi thì lần sau bỏ qua. Nên bật cho luật chia khách, chào mừng khách mới…</li>
  <li><b>Chỉ chạy trong giờ làm việc</b>: sự kiện xảy ra ngoài giờ thì luật chờ tới đầu giờ làm việc kế tiếp mới chạy (lượt chờ hiện ở tab Đang chờ).</li>
</ul>`,
  },
  {
    slug: 'tu-dong-hoa-theo-doi', cat, title: '8. Theo dõi, chạy thử và chạy cho dữ liệu có sẵn',
    html: `
<h3>Ở danh sách luật</h3>
<p>Mỗi dòng cho biết kích hoạt, lần cập nhật, lần chạy gần nhất (hoặc <b>Lần tới</b> với luật theo lịch), số lượt <b>đang chờ</b>, và chữ đỏ <b>lần cuối lỗi</b> nếu lần chạy gần nhất lỗi. Nút <b>⋯</b>: Mở, Lịch sử chạy, Đang chờ, Chạy thử, Chạy cho dữ liệu có sẵn, Nhân bản, Xoá.</p>
<h3>Số liệu trên từng node</h3>
<p>Góc dưới bên phải mỗi node hiện số lần bước đó <b>chạy thành công</b> (xanh) và <b>lỗi</b> (đỏ). Cổng Đúng / Sai của Nếu/Thì hiện số lần đi vào mỗi nhánh. Nhờ đó biết luật hiệu quả tới đâu, bước nào hay lỗi.</p>
<h3>Lịch sử chạy</h3>
<p>Tab <b>Lịch sử chạy</b> liệt kê 100 lần chạy gần nhất: thời gian, bản ghi, thành công hay lỗi. Bấm một lần chạy để xem từng bước đã làm gì (ví dụ “Nếu: Đúng → Đã giao cho Huy → Đợi tới 09:00 …”). Nút <b>CSV</b> tải toàn bộ danh sách.</p>
<h3>Chạy thử</h3>
<p>Nút <b>Chạy thử luật</b> (hoặc ⋯ › Chạy thử): luật chạy ngay, bỏ qua điều kiện Lọc, trên công việc / khách hàng bạn dán mã hoặc link. Đây là lần chạy thật (thông báo gửi đi thật, việc giao thật), hãy thử trên dữ liệu thử.</p>
<h3>Chạy cho dữ liệu có sẵn</h3>
<p>⋯ › <b>Chạy cho dữ liệu có sẵn</b>: chạy luật cho tối đa 300 công việc đang mở (hoặc khách hàng) mới nhất, theo đúng điều kiện và tuỳ chọn “chỉ chạy một lần”. Dùng khi vừa tạo luật mà muốn áp dụng cho dữ liệu cũ.</p>`,
  },
  {
    slug: 'tu-dong-hoa-vi-du', cat, title: '9. Ví dụ thực tế',
    html: `
<h3>Chia khách hàng mới cho sale theo vòng tròn</h3>
<ol>
  <li>Kích hoạt: <b>Khách hàng mới</b>. Tuỳ chọn: bật <b>Mỗi khách hàng chỉ chạy một lần</b>.</li>
  <li>Bước 1: <b>Nếu / Thì</b>, điều kiện “Người phụ trách khách — đang trống”.</li>
  <li>Nhánh Đúng: <b>Giao người phụ trách khách</b>, Cách chia “Chia đều vòng tròn”, Nhân sự: các bạn sale.</li>
  <li>Bước 2 (sau khối Nếu/Thì): <b>Gửi thông báo</b> cho “Người phụ trách khách”, tiêu đề “Bạn được giao khách mới: <code>{{customer}}</code>”.</li>
</ol>
<p>Kết quả: khách mới chưa có người phụ trách được chia lần lượt cho từng sale (bỏ qua người đang nghỉ), và người được giao nhận thông báo.</p>
<h3>Nhắc lại việc chưa được giao sau một ngày làm việc</h3>
<ol>
  <li>Kích hoạt: <b>Công việc được tạo</b>.</li>
  <li><b>Đợi, hẹn giờ</b>: 8 giờ, bật “Chỉ tính giờ làm việc”.</li>
  <li><b>Nếu / Thì</b>: “Bước — là — ACCOUNT”. Nhánh Đúng: <b>Gửi thông báo</b> cho Người tạo “Việc chưa được giao sau 1 ngày: <code>{{task.title}}</code>”.</li>
</ol>
<h3>Báo người duyệt ngay khi việc chờ duyệt</h3>
<ol>
  <li>Kích hoạt: <b>Công việc chuyển bước</b>, Sang bước: REVIEW.</li>
  <li><b>Gửi thông báo</b> cho Người duyệt: “Việc chờ bạn duyệt: <code>{{task.title}}</code>”, nội dung “<code>{{customer}}</code> · <code>{{service}}</code>”.</li>
</ol>
<h3>Việc quá hạn: báo và gia hạn</h3>
<ol>
  <li>Kích hoạt: <b>Công việc quá hạn</b>. Lọc (tuỳ chọn): Khách hàng là …</li>
  <li><b>Gửi thông báo</b> cho Người thực hiện và Người tạo.</li>
  <li><b>Cập nhật hạn chót</b>: đặt sau 2 ngày.</li>
</ol>
<h3>Báo cáo tuần tự tạo mỗi thứ Hai</h3>
<ol>
  <li>Kích hoạt: <b>Theo lịch</b>, Hằng tuần, Thứ Hai, 08:30.</li>
  <li><b>Tạo công việc</b> “Báo cáo tuần”, Giao cho trưởng nhóm, Hạn 4 ngày.</li>
</ol>
<h3>Đẩy việc mới sang n8n để gửi Telegram / Google Sheets</h3>
<ol>
  <li>Trong n8n: tạo workflow bắt đầu bằng node <b>Webhook</b> (POST), chép Production URL.</li>
  <li>Trong DMI: kích hoạt <b>Công việc được tạo</b> → <b>Gọi webhook</b>, URL là địa chỉ vừa chép.</li>
  <li>Trong n8n: dùng <code>{{$json.body.task.title}}</code>… để gửi tin Telegram hoặc ghi một dòng Google Sheets.</li>
</ol>`,
  },
  {
    slug: 'tu-dong-hoa-luu-y', cat, title: '10. Lưu ý và xử lý lỗi',
    html: `
<ul>
  <li><b>Luật không chạy?</b> Kiểm tra: luật đang Bật; sự kiện xảy ra sau khi bật; bản ghi thoả điều kiện Lọc; với “chỉ chạy một lần” thì bản ghi đã chạy trước đó sẽ bị bỏ qua; với “chỉ chạy trong giờ làm việc” thì xem tab Đang chờ.</li>
  <li><b>Thay đổi do luật làm không kích hoạt luật khác.</b> Ví dụ luật A giao việc sẽ không làm luật “Trường dữ liệu thay đổi — Người thực hiện” chạy.</li>
  <li><b>Lỗi “Bạn không có quyền …”</b> trong lịch sử chạy: người lưu luật không có quyền với công việc / khách hàng đó. Cho họ quyền, hoặc để người có quyền mở luật và bấm Lưu.</li>
  <li><b>Lỗi “Người lưu luật không còn hoạt động”</b>: tài khoản đã bị khoá. Mở luật và lưu lại bằng tài khoản khác.</li>
  <li><b>Lỗi “Mọi người được chọn đều đang nghỉ”</b>: thêm người vào danh sách Nhân sự hoặc sửa Danh sách nghỉ.</li>
  <li><b>Một bước lỗi thì các bước sau không chạy</b> ở lần đó; lịch sử chạy ghi rõ bước nào lỗi và vì sao.</li>
  <li><b>Kích hoạt theo thời gian</b> (quá hạn, sắp đến hạn, theo lịch, đợi) được kiểm tra mỗi phút nên có thể trễ tối đa khoảng một phút.</li>
  <li><b>Chạy thử là chạy thật</b>: thông báo và thay đổi là thật. Hãy thử trên dữ liệu thử, rồi xem Lịch sử chạy.</li>
  <li><b>Luật nhiều bản ghi</b>: luật kích hoạt rộng (ví dụ mọi lần “Trường dữ liệu thay đổi”) có thể chạy rất nhiều lần; dùng điều kiện Lọc để thu hẹp.</li>
</ul>`,
  },
];
