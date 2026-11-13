// The filters behind Tổng quan's numbers (web/src/components/FlowOverview.tsx): a step of the review workflow, or what
// needs a hand (late, waiting long for its review, sent back with REDO), or when an open task falls due. The server's
// task list filters with the same rules (server/tasks.ts), so a number and the list it opens always agree.
import type { FlowStage } from './task-flow';

export const FLOW_FILTERS = ['account', 'execution', 'review', 'completed', 'rejected', 'overdue', 'waiting', 'redo', 'due-today', 'due-week', 'due-later', 'no-due'] as const;
export type FlowFilter = (typeof FLOW_FILTERS)[number];
/** A review waiting longer than this is "waiting long". */
export const REVIEW_WAIT_HOURS = 24;
export const FLOW_FILTER_LABEL: Record<FlowFilter, string> = {
  account: 'ACCOUNT', execution: 'EXECUTION', review: 'REVIEW', completed: 'COMPLETED', rejected: 'REJECTED',
  overdue: 'Quá hạn', waiting: `Chờ duyệt quá ${REVIEW_WAIT_HOURS} giờ`, redo: 'Bị trả về (REDO)',
  'due-today': 'Đến hạn hôm nay', 'due-week': 'Đến hạn trong 7 ngày', 'due-later': 'Đến hạn sau 7 ngày', 'no-due': 'Chưa có hạn',
};
export const isFlowFilter = (x: unknown): x is FlowFilter => FLOW_FILTERS.includes(x as FlowFilter);

const HOUR = 3600e3, DAY = 24 * HOUR, VN = 7 * HOUR;
/** The end of today in Vietnam (UTC+7), whatever the clock's zone. */
const endOfToday = (now: number) => Math.floor((now + VN) / DAY) * DAY + DAY - VN;

export type FlowFacts = { stage?: FlowStage | null; dueAt: number | null; revision?: number; submittedAt?: number | null };
export function flowMatch(t: FlowFacts, f: FlowFilter, now = Date.now()) {
  const open = !!t.stage && t.stage !== 'completed' && t.stage !== 'rejected', due = t.dueAt, eod = endOfToday(now);
  switch (f) {
    case 'overdue': return open && !!due && due < now;
    case 'waiting': return t.stage === 'review' && !!t.submittedAt && now - t.submittedAt > REVIEW_WAIT_HOURS * HOUR;
    case 'redo': return open && (t.revision || 0) > 0;
    case 'due-today': return open && !!due && due >= now && due < eod;
    case 'due-week': return open && !!due && due >= eod && due < now + 7 * DAY;
    case 'due-later': return open && !!due && due >= Math.max(eod, now + 7 * DAY);
    case 'no-due': return open && !due;
    default: return t.stage === f;
  }
}
