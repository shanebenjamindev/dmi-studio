// Tiến độ của một Dịch vụ thuộc Nhãn hàng: tự suy từ các task bên trong (chưa bắt đầu, đang thực hiện, hoàn thành)
// trừ khi quản lý đặt tạm dừng hoặc đã huỷ.
export type BrandServiceStage = 'not_started' | 'in_progress' | 'paused' | 'done' | 'cancelled';
export const BRAND_SERVICE_STAGES: [BrandServiceStage, string][] = [
  ['not_started', 'Chưa bắt đầu'],
  ['in_progress', 'Đang thực hiện'],
  ['paused', 'Tạm dừng'],
  ['done', 'Hoàn thành'],
  ['cancelled', 'Đã huỷ'],
];
/** What its managers may set by hand; anything else comes from its tasks. */
export type ServiceHold = 'paused' | 'cancelled';
export const isHold = (x: unknown): x is ServiceHold => x === 'paused' || x === 'cancelled';
/** `tasks`: its tasks still meant to be done (cancelled ones left out); `started`: those under way or done. */
export function brandServiceStage(c: { tasks: number; started: number; done: number }, hold?: string | null): BrandServiceStage {
  if (isHold(hold)) return hold;
  if (!c.tasks) return 'not_started';
  if (c.done >= c.tasks) return 'done';
  return c.started ? 'in_progress' : 'not_started';
}

/** @deprecated Giữ tương thích tạm thời trong quá trình chuyển UI, dùng BrandServiceStage. */
export type ProjectStage = BrandServiceStage;
/** @deprecated Dùng BRAND_SERVICE_STAGES. */
export const PROJECT_STAGES = BRAND_SERVICE_STAGES;
/** @deprecated Dùng ServiceHold. */
export type ProjectHold = ServiceHold;
/** @deprecated Dùng brandServiceStage. */
export const projectStage = brandServiceStage;
