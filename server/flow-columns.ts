// Which step of the review workflow (shared/task-flow.ts) a board column stands for, by what its name means, so every
// board follows the workflow whatever its columns are called: a step's own code (ACCOUNT, EXECUTION…, the columns a
// board is made with), else Cần làm / Cần dựng / Khách mới → ACCOUNT, Đang làm /
// Đang dựng / Cần sửa → EXECUTION, Chờ duyệt → REVIEW, Xong / Đã giao / Hoàn tất → COMPLETED, Đã huỷ → REJECTED.
// A column of no step (Tạm dừng, a board's own) keeps its cards as they are; Quá hạn is no step at all: being late is
// the due date's, not a column's.
import { normName, statusKey } from './taskimport';
import { FLOW_STAGES, type FlowStage } from '../shared/task-flow';

export const FLOW_ORDER: FlowStage[] = ['account', 'execution', 'review', 'completed', 'rejected'];
/** The name a column takes when a board has none for a step, and the columns a new board is made with: the step's code. */
export const FLOW_COLUMN = Object.fromEntries(FLOW_STAGES.map((s) => [s.key, s.code])) as Record<FlowStage, string>;
export const FLOW_COLUMNS = FLOW_ORDER.map((s) => FLOW_COLUMN[s]);
/** The step a column named after its code stands for (ACCOUNT → account), else null. */
export const codeStage = (name: string): FlowStage | null => FLOW_ORDER.find((s) => normName(name) === s) ?? null;
/** The Vietnamese names columns had before they took the codes: a board of only these (and Quá hạn, Tạm dừng…) is a
 *  board as it was made, and its columns are renamed to the codes (board-flow.ts). */
export const OLD_COLUMN: Record<FlowStage, string[]> = {
  account: ['can lam', 'chua lam', 'chua thuc hien', 'chua bat dau', 'viec can lam', 'to do', 'todo'], execution: ['dang lam', 'dang thuc hien', 'doing', 'in progress'],
  review: ['cho duyet', 'dang danh gia', 'in review'], completed: ['xong', 'da xong', 'hoan thanh', 'done'], rejected: ['da huy', 'cancelled', 'canceled'],
};

export function columnStage(name: string): FlowStage | null {
  const n = normName(name), key = statusKey(name);
  const code = codeStage(name);
  if (code) return code;
  if (key === 'overdue') return null;
  if (/danh gia|duyet|review/.test(n)) return 'review';
  if (key === 'cancelled' || /tu choi|khong dat|reject|fail/.test(n)) return 'rejected';
  if (key === 'done' || key === 'done_late' || /^da (giao|ban giao|bao cao|xong|gui bao cao)|hoan tat|xong$|delivered/.test(n)) return 'completed';
  if (/can sua|lam lai|redo|toi uu|^fix/.test(n)) return 'execution';
  if (key === 'doing' || /^dang /.test(n)) return 'execution';
  if (key === 'todo' || /^can |khach moi|chuan bi|tiep nhan|backlog|^moi$/.test(n)) return 'account';
  return null;
}
export const isOverdueColumn = (name: string) => statusKey(name) === 'overdue';
