// A list in groups (by due date, status, project…): each group's heading folds it away and can start a new item in it;
// rows show a tick box when they can be finished, the name, then a few narrow columns. Used by Công việc and Khách hàng.
import { useState, type ReactNode } from 'react';
import { Icon } from './ui';

/** `end`: kept in view at the right edge while the table scrolls sideways (its actions). */
export interface GroupColumn<T> { key: string; label: string | ReactNode; render: (row: T) => ReactNode; width?: number; wide?: boolean; end?: boolean }
export interface Group<T> { key: string; label: string; rows: T[]; color?: string; onAdd?: () => void }

export function GroupedList<T extends { id: string }>({ groups, columns, name, nameLabel, check, selection, onOpen, selected, foldKey, addLabel = 'Tạo mới', hideEmpty }: {
  groups: Group<T>[]; columns: GroupColumn<T>[]; name: (row: T) => ReactNode; nameLabel: string;
  check?: { done: (row: T) => boolean; toggle: (row: T) => void; label: (row: T) => string; all?: boolean; toggleAll?: (checked: boolean) => void; canCheck?: (row: T) => boolean };
  selection?: { selected: string[]; toggle: (id: string) => void; all?: boolean; toggleAll?: (checked: boolean) => void };
  onOpen: (row: T) => void; selected?: string | null; foldKey: string; addLabel?: string; hideEmpty?: boolean;
}) {
  // Which groups are folded, remembered per list in this browser.
  const [folded, setFolded] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(foldKey) || '[]'); } catch { return []; } });
  const fold = (k: string) => { const next = folded.includes(k) ? folded.filter((x) => x !== k) : [...folded, k]; setFolded(next); try { localStorage.setItem(foldKey, JSON.stringify(next)); } catch { /* private mode */ } };
  const span = columns.length + 1 + (selection ? 1 : 0);
  return (
    <div className="gl-wrap" role="region" aria-label={nameLabel} tabIndex={0}>
      <table className="gl">
        <thead>
          <tr>
            {selection && (
              <th className="gl-sel" style={{ width: 36, minWidth: 36, textAlign: 'center' }}>
                {selection.toggleAll && (
                  <input
                    type="checkbox"
                    checked={!!selection.all}
                    onChange={(e) => selection.toggleAll!(e.target.checked)}
                    aria-label="Chọn tất cả để thao tác"
                  />
                )}
              </th>
            )}
            <th className="gl-name">{check?.toggleAll ? <span className="gl-title"><input type="checkbox" checked={!!check.all} onChange={(e) => check.toggleAll!(e.target.checked)} aria-label="Chọn tất cả" /><span>{nameLabel}</span></span> : nameLabel}</th>
            {columns.map((c) => <th key={c.key} style={{ minWidth: c.width }} className={(c.wide ? '' : 'gl-narrow') + (c.end ? ' gl-end' : '')}>{c.label}</th>)}
          </tr>
        </thead>
        {groups.filter((g) => !hideEmpty || g.rows.length).map((g) => {
          const shut = folded.includes(g.key);
          return (
            <tbody key={g.key} className={shut ? 'shut' : ''}>
              <tr className="gl-group">
                <th className="gl-name" colSpan={selection ? 2 : 1}><div className="gl-group-h">
                  <button className="gl-fold" onClick={() => fold(g.key)} aria-expanded={!shut}><Icon name="chevron" size={13} className={shut ? 'gl-closed' : ''} />{g.color && <i style={{ background: g.color }} />}<b>{g.label}</b><span>({g.rows.length})</span></button>
                  {g.onAdd && <button className="gl-add" onClick={g.onAdd}><Icon name="plus" size={13} />{addLabel}</button>}
                </div></th>
                <td colSpan={columns.length} />
              </tr>
              {!shut && g.rows.map((r) => (
                <tr key={r.id} className={'gl-row' + (selected === r.id ? ' on' : '') + (selection?.selected.includes(r.id) ? ' checked' : '')} onClick={() => onOpen(r)}>
                  {selection && (
                    <td className="gl-sel" style={{ width: 36, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selection.selected.includes(r.id)}
                        onChange={() => selection.toggle(r.id)}
                        aria-label={`Chọn ${r.id}`}
                      />
                    </td>
                  )}
                  <th className="gl-name" scope="row">
                    <span className="gl-title">
                      {check && (!check.canCheck || check.canCheck(r)) && <input type="checkbox" checked={check.done(r)} aria-label={check.label(r)} onClick={(e) => e.stopPropagation()} onChange={() => check.toggle(r)} />}
                      <span>{name(r)}</span>
                    </span>
                  </th>
                  {columns.map((c) => <td key={c.key} className={(c.wide ? '' : 'gl-narrow') + (c.end ? ' gl-end' : '')}>{c.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

/** Groups by due date, as people plan: past, today, tomorrow, the next 7 days, later, and none (Vietnam days). */
export function byDueDate<T extends { dueAt: number | null }>(rows: T[], onAdd?: (key: string) => void) {
  const VN = 7 * 3600e3, DAY = 86400e3, today = Math.floor((Date.now() + VN) / DAY) * DAY - VN;
  const slot = (t: number | null) => (t === null ? 'none' : t < today ? 'past' : t < today + DAY ? 'today' : t < today + 2 * DAY ? 'tomorrow' : t < today + 8 * DAY ? 'week' : 'later');
  const order: [string, string][] = [['past', 'Trước đây'], ['today', 'Hôm nay'], ['tomorrow', 'Ngày mai'], ['week', '7 ngày tới'], ['later', 'Trong tương lai'], ['none', 'Không thời hạn']];
  return order.map(([key, label]) => ({ key, label, rows: rows.filter((r) => slot(r.dueAt) === key).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)), onAdd: onAdd && (() => onAdd(key)) }));
}
/** Groups by any key, in the order given (then the rest, then the rows with none). */
export function byKey<T>(rows: T[], keyOf: (r: T) => { key: string; label: string; color?: string } | null, none: string, order: string[] = []) {
  const groups = new Map<string, Group<T & { id: string }>>();
  for (const r of rows) {
    const k = keyOf(r) || { key: '_none', label: none };
    if (!groups.has(k.key)) groups.set(k.key, { key: k.key, label: k.label, color: k.color, rows: [] });
    groups.get(k.key)!.rows.push(r as T & { id: string });
  }
  const rank = (k: string) => (k === '_none' ? 1e9 : order.includes(k) ? order.indexOf(k) : order.length + 1);
  return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || (a.label || '').localeCompare(b.label || '', 'vi'));
}
