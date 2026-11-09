// The type of a board: the view it opens in (Board, table, calendar, overview or timeline), picked when it is made and
// changed in its menu; the other views stay a click away on its bar.
import { Icon } from './ui';
import type { BoardViewKind } from '../types';

export type { BoardViewKind };
export const VIEW_NAMES: Record<BoardViewKind, string> = { board: 'Board', table: 'Danh sách', calendar: 'Lịch', dashboard: 'Tổng quan', timeline: 'Dòng thời gian' };
export const VIEW_ICONS: Record<BoardViewKind, string> = { board: 'boards', table: 'list', calendar: 'calendar', dashboard: 'grid', timeline: 'lines' };

export function BoardTypePicker({ value, onChange, labelledBy }: { value: BoardViewKind; onChange: (v: BoardViewKind) => void; labelledBy?: string }) {
  return <div className="bd-types" role="radiogroup" aria-labelledby={labelledBy}>
    {(Object.keys(VIEW_NAMES) as BoardViewKind[]).map((v) => <button type="button" key={v} role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}><Icon name={VIEW_ICONS[v]} size={18} /><span>{VIEW_NAMES[v]}</span></button>)}
  </div>;
}
