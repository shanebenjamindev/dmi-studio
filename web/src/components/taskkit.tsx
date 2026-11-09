// What a task's state looks like (its badge) and how its moments read, shared by the task pages and the cards that are tasks.
import { Icon } from './ui';
import type { TaskItem, TaskState } from '../types';

export const STATE: Record<TaskState, [string, string, string]> = {
  done: ['Hoàn thành', 'ok', 'check'], done_late: ['Hoàn thành muộn', 'late', 'check'], overdue: ['Quá hạn', 'bad', 'clock'], doing: ['Đang thực hiện', 'doing', 'play'],
  todo: ['Chưa thực hiện', 'idle', 'clock'], paused: ['Tạm dừng', 'idle', 'pause'], cancelled: ['Đã huỷ', 'idle', 'x'], other: ['', 'idle', 'info'],
};
export const when = (t: number | null) => (t ? new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export function Badge({ t }: { t: Pick<TaskItem, 'state' | 'status'> }) {
  const [label, tone, icon] = STATE[t.state];
  return <span className={'tk-badge ' + tone}><Icon name={icon} size={11} />{label || t.status || 'Chưa có trạng thái'}</span>;
}
