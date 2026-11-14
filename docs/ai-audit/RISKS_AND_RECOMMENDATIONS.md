# RISKS_AND_RECOMMENDATIONS

> Audit ngày 14/11/2026. Rủi ro bảo mật chi tiết: [SECURITY_AUDIT.md](SECURITY_AUDIT.md). Ở đây là rủi ro kỹ thuật, sản phẩm và vận hành.

## Rủi ro

| ID | Rủi ro | Khả năng | Ảnh hưởng | Bằng chứng | Giảm thiểu |
|---|---|---|---|---|---|
| R-01 | **Chi phí và chính sách**: khung chat trong DMI (phương án B) cần Claude API trả phí, trái yêu cầu hiện tại | Chắc chắn nếu làm B | Cao | [AI_AGENT_DESIGN.md](AI_AGENT_DESIGN.md#0-ràng-buộc-quyết-định) | Làm A trước; B chỉ khi có quyết định chi phí và hạn mức |
| R-02 | **Lỗi runtime Worker không được test bắt**: Miniflare không chạy trên máy dev | Đã xảy ra (vòng import làm Worker không khởi động, phát hiện trước khi deploy) | Cao (sập production) | `tests/worker.test.mjs` | CI với Node 22, chặn deploy khi đỏ (P0) |
| R-03 | **Thay đổi lớn chưa commit**: connector, trình dựng mới, xoá khoảng 8.700 dòng code cũ | Hiện tại | Cao (mất việc, khó review) | `git status` | Commit theo từng phần, review, deploy có kiểm |
| R-04 | **Bản production lệch bản local**: production `085bb279` có connector nhưng chưa có phần dọn dẹp và trình dựng mới | Hiện tại | TB | [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md#8-trợ-lý-ai-hiện-có-hiện-có-chưa-commit-một-phần) | Deploy sau P0 |
| R-05 | **Prompt injection** từ dữ liệu người dùng viết | TB | Cao khi có công cụ ghi nhạy cảm | S-05 | Duyệt phía server (M2), danh sách công cụ theo vai trò |
| R-06 | **Tạo trùng** khi client AI thử lại | TB | TB | Không có idempotency | M1 |
| R-07 | **Lộ thông tin nhân sự**: `GET /api/tasks/meta` trả email mọi người cho mọi thành viên; AI làm việc tra cứu dễ hơn | TB | Thấp–TB | S-07 | Thu hẹp trường hoặc quyền |
| R-08 | **Nhầm hai nghĩa "project"**: `task_projects` (dịch vụ khách) và `projects` (dự án video) | TB | TB (AI thao tác sai bảng) | [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md#4-dữ-liệu-hiện-có) | Tên công cụ tách bạch (`*_service` và `*_video_project`), đã áp dụng |
| R-09 | **Giới hạn D1**: khoảng 100 tham số mỗi câu, `GET /api/tasks` đọc toàn bảng rồi lọc trong bộ nhớ | Tăng theo dữ liệu | TB (chậm, timeout) | [server/tasks.ts](../../server/tasks.ts) `GET /api/tasks` | Đo với dữ liệu lớn (R3); thêm lọc SQL và phân trang trước khi AI gọi thường xuyên |
| R-10 | **Phụ thuộc client Claude**: hành vi xác nhận công cụ ghi, cách hiện kết quả tuỳ client và có thể đổi | TB | TB | | Không dựa vào client cho an toàn: kiểm quyền và duyệt ở server |
| R-11 | **Gói Team**: Owner phải thêm connector; người dùng không phải Owner không tự thêm được | Chắc chắn | Thấp | | Hướng dẫn trong trang "Kết nối Claude" |
| R-12 | **Trình dựng phụ thuộc máy Mac** (ffmpeg, HyperFrames, RAM 8 GB); preview nhúng chỉ khi mở DMI trên chính Mac | Chắc chắn | TB | `npx hyperframes doctor` cảnh báo RAM | Render bản nháp, đóng app khác khi render; xem bản render ở máy khác |
| R-13 | **Bí mật dạng thường** trong `settings` và bản sao lưu | Thấp | Cao | S-01 | Mã hoá (P1) |
| R-14 | **Không có giới hạn tần suất** | Thấp–TB | TB (lạm dụng, chi phí D1) | S-03 | M4 |
| R-15 | **Thư mục Drive có file trùng** làm phí giới hạn 150 footage | Đã xảy ra | Thấp | Dự án "PPF - NewVer" | Đã lọc trùng khi quét (chưa deploy); người dùng bấm "Đọc lại sheet" cho dự án cũ |

## Khuyến nghị (ưu tiên)

1. **Chốt hướng**: giữ phương án A (miễn phí) làm chính. Quyết định riêng về B kèm hạn mức chi phí.
2. **Ổn định trước khi mở rộng**: CI cho Worker, test connector, commit phần đang dở (P0).
3. **Kiểm soát trước khi cho AI ghi nhiều**: thu hồi kết nối, giới hạn tần suất, danh sách redirect (P1); idempotency, dry-run, hàng chờ duyệt (P2).
4. **Mở rộng công cụ theo thứ tự đọc → ghi thường → ghi nhạy cảm** (P3), mỗi công cụ gọi route có sẵn, không viết lại logic.
5. **Không đưa vào AI**: SQL trực tiếp, phân quyền, khoá hoặc đăng xuất tài khoản, cấu hình hệ thống, khoá site, sao lưu.
6. **Đo hiệu năng** `GET /api/tasks` và `GET /api/customers/directory` với dữ liệu thật trước khi AI gọi thường xuyên.
7. **Giữ nguyên database và xác thực hiện có**: D1/SQLite và phiên cookie đang đáp ứng; OAuth của connector đã xây trên chính phiên này. Không có lý do thay.
