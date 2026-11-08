// What Quản trị and the Customers page say about a customer: where it stands.
export const CUSTOMER_STATUS = { lead: 'Tiềm năng', caring: 'Đang chăm sóc', active: 'Đang dùng dịch vụ', paused: 'Tạm dừng', ended: 'Ngừng hợp tác' } as const;
export type CustomerStatus = keyof typeof CUSTOMER_STATUS;
