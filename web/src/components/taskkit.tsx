// What a task's state looks like (its badge) and how its moments read, shared by the task pages and the cards that are tasks.
import { Icon } from './ui';
import type { TaskItem, TaskState } from '../types';
import { FLOW_STAGES, isClosedStage, type FlowStage } from '../../../shared/task-flow';

export const STATE: Record<TaskState, [string, string, string]> = {
  done: ['Hoàn thành', 'ok', 'check'], done_late: ['Hoàn thành muộn', 'late', 'check'], overdue: ['Quá hạn', 'bad', 'clock'], doing: ['Đang thực hiện', 'doing', 'play'],
  todo: ['Chưa thực hiện', 'idle', 'clock'], paused: ['Tạm dừng', 'idle', 'pause'], cancelled: ['Đã huỷ', 'idle', 'x'], other: ['', 'idle', 'info'],
};
export const when = (t: number | null) => (t ? new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
/** Where a task stands: its step of the review workflow (ACCOUNT, EXECUTION…; late while open: red), else its status. */
export function Badge({ t }: { t: Pick<TaskItem, 'state' | 'status' | 'stage'> }) {
  if (t.stage) {
    const late = t.state === 'overdue' && !isClosedStage(t.stage), icon = STEP_ICON[t.stage];
    return <span className={'tk-badge ' + (late ? 'bad' : 'tf-tint tf-' + t.stage)} title={late ? 'Quá hạn' : undefined}><Icon name={late ? 'clock' : icon} size={11} />{stepCode(t.stage)}</span>;
  }
  const [label, tone, icon] = STATE[t.state];
  return <span className={'tk-badge ' + tone}><Icon name={icon} size={11} />{label || t.status || 'Chưa có trạng thái'}</span>;
}
/** Each step's icon; its colour is the step's own (Quản trị › Quy trình công việc). */
const STEP_ICON: Record<FlowStage, string> = { account: 'clock', execution: 'play', review: 'eye', completed: 'check', rejected: 'x' };
export const stepCode = (stage: FlowStage) => FLOW_STAGES.find((x) => x.key === stage)!.code;
/** Tasks in groups by step, in the workflow's order (a task of no step: by its state). */
export const STEP_ORDER: string[] = FLOW_STAGES.map((x) => x.key);
export const stepGroup = (t: Pick<TaskItem, 'state' | 'status' | 'stage'>) => t.stage ? { key: t.stage as string, label: stepCode(t.stage) } : { key: t.state as string, label: STATE[t.state]?.[0] || t.status || 'Khác' };
