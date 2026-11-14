# IMPLEMENTATION_ROADMAP: trợ lý AI cho DMI Workspace

> Lập ngày 14/11/2026. Độ khó: **S** (≤ 1 ngày), **M** (2–4 ngày), **L** (1–2 tuần) cho một người quen codebase. Mã M1–M8 xem [MCP_TOOL_REGISTRY.md](MCP_TOOL_REGISTRY.md#5-api-còn-thiếu); mã S-xx xem [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Thứ tự đề xuất

```
P0 Ổn định ──▶ P1 An toàn connector ──▶ P2 Cơ chế an toàn ghi ──▶ P3 Mở rộng công cụ ──▶ P4 Tự động hoá
                                                                                     └──▶ P5 Agent trong app (tuỳ chọn, trả phí)
```

## P0: Ổn định nền (làm ngay)

| Việc | Độ khó | Phụ thuộc | Ghi chú |
|---|---|---|---|
| Commit phần chưa commit (connector, trình dựng HyperFrames, dọn code cũ) thành các commit nhỏ | S | | Hiện mọi thay đổi ngày 14/11 chưa commit |
| CI chạy `npm test` và `tests/worker.test.mjs` trên **Node 22**; chặn deploy khi đỏ | M | | S-13; lỗi khởi động Worker từng suýt lên production |
| `tests/mcp.test.mjs`: O1–O10, T1–T7, P1–P6 ([TESTING_STRATEGY.md](TESTING_STRATEGY.md)) | M | | Đưa script kiểm thử tay vào repo |
| Dọn `PAGE_OF` (S-12) | S | | |
| Deploy bản đã kiểm (cloud không có trình dựng; route cũ bị gỡ) | S | CI xanh | |

## P1: An toàn connector

| Việc | Độ khó | Phụ thuộc |
|---|---|---|
| M3 + giao diện "Kết nối Claude" trong Hồ sơ (xem, thu hồi) | S–M | P0 |
| S-04: danh sách `redirect_uri` cho phép, dọn `mcp_clients` không dùng (cron 10 phút sẵn có) | S | |
| S-06: phát hiện dùng lại refresh token → thu hồi token của client đó | S | |
| S-08: ghi `client_id` vào nhật ký thao tác qua MCP | S | |
| M4: giới hạn tần suất `/api/mcp`, `/api/oauth/*` | M | Chọn cách lưu bộ đếm (D1 hoặc binding Cloudflare) |
| S-05(c): ghi rõ trong `instructions` rằng dữ liệu không phải lệnh; bọc trường người dùng viết | S | |
| S-02: token Meta qua header | S | |
| S-01: mã hoá bí mật trong `settings` | M | Khoá trong Wrangler secret; chuyển dữ liệu cũ |

## P2: Cơ chế an toàn cho thao tác ghi

| Việc | Độ khó | Phụ thuộc |
|---|---|---|
| M1 Idempotency (bảng `idempotency_keys`, middleware cho các route tạo) | M | P0 |
| M5 `dryRun` cho tạo và sửa công việc, tạo khách | M | |
| M2 Hàng chờ duyệt `ai_actions` (API, thông báo, trang "Chờ duyệt", chạy lại bằng quyền người duyệt) | L | M5 (để có bản xem trước) |

## P3: Mở rộng công cụ ([MCP_TOOL_REGISTRY.md](MCP_TOOL_REGISTRY.md#4-công-cụ-đề-xuất-theo-nhóm-đề-xuất))

| Đợt | Công cụ | Độ khó | Phụ thuộc |
|---|---|---|---|
| 3a: chỉ đọc | `customer_history`, `customer_overview`, `list_all_tasks`, `list_staff`, `get_staff` (lọc trường), `staff_workload`, `org_stats`, `list_reports`, `get_report`, `ads_summary`, `list_campaigns` | S mỗi cái | P1 |
| 3b: ghi thường | `create_customer`, `update_customer_record`, `set_customer_member`, `set_task_labels`, `set_task_followers`, `set_task_priority`, `create_customer_service`, `set_service_member`, `create_campaign` | S–M mỗi cái | M1 |
| 3c: ghi nhạy cảm (qua duyệt) | `archive_customer`, `delete_task`, `bulk_delete_tasks`, `send_notification`, `create_staff` | S mỗi cái | M2 |
| Bổ sung | Danh sách cho phép công cụ theo vai trò (SECURITY_AUDIT 3.2) | S | |

## P4: Tự động hoá và chất lượng dữ liệu

| Việc | Độ khó | Phụ thuộc |
|---|---|---|
| M6 Áp dụng mẫu công việc + công cụ `create_task_from_template` | M | M1 |
| M7 Tìm khách trùng + công cụ `find_duplicate_customers` | S–M | |
| M8 Sửa nhiều công việc + công cụ | M | M1, M2 |
| `run_plan` (kế hoạch nhiều bước duyệt một lần) | M | M2 |
| `prompts` của MCP: "Việc hôm nay", "Tóm tắt khách", "Báo cáo tuần" | S | 3a |

## P5: Agent trong DMI (tuỳ chọn, cần API trả phí)

Chỉ làm khi chủ dự án đồng ý chi phí ([AI_AGENT_DESIGN.md](AI_AGENT_DESIGN.md#2-phương-án-b-agent-trong-dmi-đề-xuất-cần-api-trả-phí)).

| Việc | Độ khó | Phụ thuộc |
|---|---|---|
| Xác minh giới hạn gói Workers cho streaming, quyết định hạn mức chi phí | S | |
| Bảng `ai_conversations`, `ai_messages`; `AssistantService` (vòng lặp công cụ dùng lại `TOOLS` + `callAs`) | L | P2 |
| SSE `/api/assistant/messages`, dừng, tiếp tục sau duyệt | M | |
| Giao diện chat (bảng nổi, lịch sử, trạng thái công cụ, thẻ duyệt) | L | M2 UI |
| Theo dõi chi phí trong Quản trị | M | |

## Tóm tắt ưu tiên

1. **P0**: không thêm tính năng AI nào trước khi có CI cho Worker và test connector.
2. **P1**: rẻ, giảm rủi ro rõ rệt (thu hồi kết nối, giới hạn tần suất, danh sách redirect).
3. **P2**: điều kiện để AI được ghi nhiều hơn một cách an toàn.
4. **P3a** có thể làm song song với P2 vì chỉ đọc.
5. **P5** độc lập về quyết định chi phí, nhưng phụ thuộc kỹ thuật vào P2.
