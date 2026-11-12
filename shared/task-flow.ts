// A task's review workflow, apart from its status (the board's columns, Quản trị's list): Account takes the request and
// gives it out, Execution does it and submits it, Review grades it. PASS completes it, FAIL rejects it, REDO sends it
// back to Execution with feedback, as many rounds as it takes. A completed or rejected task stays closed until its
// reviewer (or an admin) reopens it. Its status follows the stage (server/task-flow.ts).
export type FlowStage = 'account' | 'execution' | 'review' | 'completed' | 'rejected';
export type FlowOutcome = 'pass' | 'redo' | 'fail';
export type FlowAction = 'start' | 'submit' | FlowOutcome | 'reopen' | 'reviewer';
/** Each stage: its code (the same for everyone, in every language) and what it is called. */
export const FLOW_STAGES: { key: FlowStage; code: string; vi: string; en: string }[] = [
  { key: 'account', code: 'ACCOUNT', vi: 'Tiếp nhận', en: 'Intake' },
  { key: 'execution', code: 'EXECUTION', vi: 'Thực hiện', en: 'In progress' },
  { key: 'review', code: 'REVIEW', vi: 'Chờ duyệt', en: 'In review' },
  { key: 'completed', code: 'COMPLETED', vi: 'Hoàn thành', en: 'Completed' },
  { key: 'rejected', code: 'REJECTED', vi: 'Từ chối', en: 'Rejected' },
];
export const FLOW_OUTCOMES: { key: FlowOutcome; code: string; vi: string; en: string }[] = [
  { key: 'pass', code: 'PASS', vi: 'Đạt', en: 'Passed' },
  { key: 'redo', code: 'REDO', vi: 'Làm lại', en: 'Revision required' },
  { key: 'fail', code: 'FAIL', vi: 'Không đạt', en: 'Rejected' },
];
export const isFlowStage = (x: unknown): x is FlowStage => FLOW_STAGES.some((s) => s.key === x);
export const isClosedStage = (s: FlowStage | null | undefined) => s === 'completed' || s === 'rejected';
/** The stage each outcome leads to. */
export const OUTCOME_STAGE: Record<FlowOutcome, FlowStage> = { pass: 'completed', redo: 'execution', fail: 'rejected' };

/** What admins set in Quản trị › Công việc › Quy trình công việc: each stage's name and the status it gives a task, and
 *  the reminders (a review waiting `reviewRemindHours`, sent from `remindHour` Vietnam time, for `remindDays` days). */
export interface FlowConfig {
  stages: Record<FlowStage, { name: string; status: string }>;
  reviewRemindHours: number; remindDays: number; remindHour: number;
}
export const DEFAULT_FLOW: FlowConfig = {
  stages: {
    account: { name: 'Tiếp nhận', status: 'Chưa thực hiện' }, execution: { name: 'Thực hiện', status: 'Đang thực hiện' },
    review: { name: 'Chờ duyệt', status: 'Đang đánh giá' }, completed: { name: 'Hoàn thành', status: 'Hoàn thành' }, rejected: { name: 'Từ chối', status: 'Đã huỷ' },
  },
  reviewRemindHours: 24, remindDays: 7, remindHour: 8,
};
/** A stored (or sent) setting made whole: what is missing or out of range takes the default. */
export function flowConfig(x: any): FlowConfig {
  const num = (v: unknown, min: number, max: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
  const str = (v: unknown, d: string) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60); return t || d; };
  const stages = {} as FlowConfig['stages'];
  for (const { key } of FLOW_STAGES) stages[key] = { name: str(x?.stages?.[key]?.name, DEFAULT_FLOW.stages[key].name), status: str(x?.stages?.[key]?.status, DEFAULT_FLOW.stages[key].status) };
  return { stages, reviewRemindHours: num(x?.reviewRemindHours, 1, 720, 24), remindDays: num(x?.remindDays, 1, 60, 7), remindHour: num(x?.remindHour, 0, 23, 8) };
}
