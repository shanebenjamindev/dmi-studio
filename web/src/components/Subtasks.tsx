// Subtasks: the branch under a task (its subtasks, theirs and so on) and the field that adds them, on a task's page and on
// the card that is the task.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import { Badge, when } from './taskkit';
import { ServicePicker } from './ServicePicker';
import type { TaskDetail, TaskItem } from '../types';

/** Opens the field that adds subtasks under a task (in its branch). A tree not shown yet (a card linking its task first)
 *  opens it when it comes. */
let asked: string | null = null;
export const addSubtask = (taskId: string) => { asked = taskId; window.dispatchEvent(new CustomEvent('dms:add-subtask', { detail: taskId })); };

/** The branch under a task: its subtasks, theirs and so on, folded or unfolded, each opened by its name. A subtask can be
 *  added under the task or under any task in the branch, as many as needed: the field stays open for the next one. */
export function SubtaskTree({ task, onOpen, onChanged, hideEmpty }: { task: TaskDetail; onOpen: (id: string) => void; onChanged: () => void; hideEmpty?: boolean }) {
  const below = useMemo(() => {
    const m = new Map<string, TaskItem[]>();
    for (const k of task.childTasks) { const p = k.parent?.id || task.id; m.set(p, [...(m.get(p) || []), k]); }
    return m;
  }, [task.childTasks, task.id]);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState<string | null>(null); // the task a subtask is being added under
  const addUnder = (id: string) => { setAdding(id); setFolded((f) => { const n = new Set(f); n.delete(id); return n; }); };
  useEffect(() => {
    const show = (e: Event) => { if ((e as CustomEvent<string>).detail === task.id) { asked = null; addUnder(task.id); } };
    if (asked === task.id) { asked = null; addUnder(task.id); } else setAdding(null);
    window.addEventListener('dms:add-subtask', show);
    return () => window.removeEventListener('dms:add-subtask', show);
  }, [task.id]);
  const done = task.childTasks.filter((k) => k.state === 'done' || k.state === 'done_late').length;
  const adder = (parent: TaskItem) => <SubtaskAdder parent={parent} onAdded={onChanged} onClose={() => setAdding(null)} />;
  const node = (k: TaskItem): ReactNode => {
    const kids = below.get(k.id) || [], open = !folded.has(k.id);
    return <li key={k.id}>
      <div className="tk-branch-row">
        {kids.length
          ? <button className="tk-fold" aria-expanded={open} aria-label={open ? 'Thu gọn' : 'Mở rộng'} onClick={() => setFolded((f) => { const n = new Set(f); if (open) n.add(k.id); else n.delete(k.id); return n; })}><Icon name={open ? 'down' : 'right'} size={12} /></button>
          : <span className="tk-fold" />}
        <button className="tk-branch-open" onClick={() => onOpen(k.id)}><Badge t={k} /><span>{k.title}</span>{kids.length > 0 && <em>{kids.length}</em>}<small>{when(k.dueAt)}</small></button>
        {task.canEdit && <button className="tk-branch-add" onClick={() => addUnder(k.id)} aria-label="Thêm việc con" title="Thêm việc con vào việc này"><Icon name="plus" size={14} /></button>}
      </div>
      {open && (kids.length > 0 || adding === k.id) && <ul>{kids.map(node)}{adding === k.id && <li>{adder(k)}</li>}</ul>}
    </li>;
  };
  const top = below.get(task.id) || [];
  if (hideEmpty && !task.childTasks.length && adding !== task.id) return null;
  return <div className="tk-child-tasks-block">
    <h4>Việc con {task.childTasks.length > 0 && <em>{done}/{task.childTasks.length}</em>}</h4>
    {top.length > 0 && <ul className="tk-branch">{top.map(node)}</ul>}
    {task.canEdit && (adding === task.id ? adder(task) : <button className="btn btn-gray btn-sm tk-kid-add" onClick={() => addUnder(task.id)}><Icon name="plus" size={14} />Thêm việc con</button>)}
  </div>;
}

/** Adds subtasks under a task one after another: Enter adds and keeps the field for the next one, and several lines (pasted)
 *  add one subtask each. They go into the parent's project, due when it is. */
function SubtaskAdder({ parent, onAdded, onClose }: { parent: TaskItem; onAdded: () => void; onClose: () => void }) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const titles = text.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const add = async () => {
    if (!titles.length || busy) return;
    setBusy(true);
    let made = 0;
    try { for (const title of titles) { await api.createTask({ title: title.slice(0, 500), projectId: parent.project?.id || null, parentId: parent.id, dueAt: parent.dueAt }); made++; } }
    catch (e: any) { toast(e.message, true); }
    finally { setText(titles.slice(made).join('\n')); setBusy(false); if (made) onAdded(); requestAnimationFrame(() => field.current?.focus()); }
  };
  return <div className="tk-kid-new">
    <textarea ref={field} className="bk-in" autoFocus rows={titles.length > 1 ? Math.min(titles.length, 6) : 1} value={text} readOnly={busy} aria-label="Tên việc con"
      placeholder="Tên việc con… (mỗi dòng một việc)"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void add(); } if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }} />
    <div className="cm-row">
      <button className="btn btn-primary btn-sm" disabled={busy || !titles.length} onClick={() => void add()}>{busy ? 'Đang thêm…' : titles.length > 1 ? `Thêm ${titles.length} việc con` : 'Thêm'}</button>
      <button className="btn btn-gray btn-sm" disabled={busy} onClick={onClose}>Xong</button>
    </div>
  </div>;
}


/** What the task a card is adds to the card: its services, and its subtasks once there are some (or one is being added). */
export function CardSubtasks({ taskId, onOpen, onChanged }: { taskId: string; onOpen: (id: string) => void; onChanged: () => void }) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const load = () => api.task(taskId).then((t) => { setTask(t); setIds((t.services || []).map((x) => x.id)); }, () => setTask(null));
  useEffect(() => { void load(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!task) return null;
  const save = async (next: string[]) => {
    const before = ids;
    setIds(next);
    try { await api.updateTask(task.id, { services: next }); void load(); onChanged(); } catch (e: any) { setIds(before); toast(e.message, true); }
  };
  return <>
    {(task.canEdit || ids.length > 0) && <div className="cm-svc"><h4>Dịch vụ</h4><ServicePicker value={ids} onChange={(next) => void save(next)} known={task.services} disabled={!task.canEdit} /></div>}
    <section className="cm-sec cm-subtasks"><SubtaskTree task={task} hideEmpty onOpen={onOpen} onChanged={() => { void load(); onChanged(); }} /></section>
  </>;
}
