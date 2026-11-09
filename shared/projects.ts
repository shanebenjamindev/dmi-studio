// A project's own workflow, apart from its tasks' (their statuses, the board's columns) and its customer's (Tiềm năng…):
// it follows its tasks (none started, some under way, all done) unless its managers put it on hold or cancel it.
export type ProjectStage = 'not_started' | 'in_progress' | 'paused' | 'done' | 'cancelled';
export const PROJECT_STAGES: [ProjectStage, string][] = [['not_started', 'Chưa bắt đầu'], ['in_progress', 'Đang thực hiện'], ['paused', 'Tạm dừng'], ['done', 'Hoàn thành'], ['cancelled', 'Đã huỷ']];
/** What its managers may set by hand; anything else comes from its tasks. */
export type ProjectHold = 'paused' | 'cancelled';
export const isHold = (x: unknown): x is ProjectHold => x === 'paused' || x === 'cancelled';
/** `tasks`: its tasks still meant to be done (cancelled ones left out); `started`: those under way or done. */
export function projectStage(c: { tasks: number; started: number; done: number }, hold?: string | null): ProjectStage {
  if (isHold(hold)) return hold;
  if (!c.tasks) return 'not_started';
  if (c.done >= c.tasks) return 'done';
  return c.started ? 'in_progress' : 'not_started';
}
