import {EntitySelect,QuickCreateButton,useEntityRefresh} from './QuickCreate';
import { ResizeHandle } from './ResizeHandle';
// The back of a card (the window a card opens in, like Trello's): title and list, members, labels, dates and the
// "done" mark, the customer the task is for, description, the work's result (files of that customer's Drive folder and
// a note), attachments (links), checklists, and the comments with the card's history; on the side, what can be added to
// the card (members, labels, checklist, dates, customer, attachment, cover) and done with it (move, copy, archive,
// delete). Someone who only views the board (observer) reads everything and comments.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { toast, useStore, goto, openTask } from '../store';
import { Icon } from './ui';
import { MemberChoices } from './EmployeePicker';
import { MemberAvatar } from './MemberAvatar';
import { RichEditor, RichView } from './RichText';
import { COLOR, COLOR_NAME, Avatar, Pop, activityText, ago, dateIn, dueState, fullDate, timeIn, fileThumb } from './boardkit';
import type { Board, BoardLabel, CardDetail, DriveFile, TaskDetail, TaskMeta, User } from '../types';

export type PopKind = 'add' | 'members' | 'labels' | 'label' | 'checklist' | 'dates' | 'customer' | 'project' | 'files' | 'attach' | 'cover' | 'move' | 'copy' | 'actions';

/** A card's window over the board; `embedded`: the same card laid into a page instead (a task's own page on Công việc,
 *  as task and card are one piece of work), with `extra` (the task's own facts) above its description. */
export function CardModal({ id, board, me, onClose, onChanged, embedded = false, extra, topActions }: { id: string; board: Board; me: User; onClose: () => void; onChanged: () => void; embedded?: boolean; extra?: ReactNode; topActions?: ReactNode }) {
  const [c, setC] = useState<CardDetail | null>(null);
  const [pop, setPop] = useState<{ kind: PopKind; el: HTMLElement; label?: BoardLabel | null } | null>(null);
  const [commentsOpen,setCommentsOpen]=useState(!embedded);
  const [details, setDetails] = useState(false);
  const [pending, setPending] = useState(0);
  // Result files come from the customer's folder, which only people with the Drive page open.
  const drive = useStore((s) => s.pages.includes('workspace'));
  const load = () => api.card(id).then(setC).catch((e) => { toast(e.message, true); onClose(); });
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (embedded) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog.qc-dialog[open]')) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, embedded]);
  /** Do something to the card, then show it (and the board) as the server has it. */
  const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setPending((n) => n + 1);
    try {
      await fn();
      await load();
      onChanged();
      return true;
    } catch (e: any) {
      toast(e.message, true);
      return false;
    } finally { setPending((n) => n - 1); }
  };
  const open = (kind: PopKind) => (e: React.MouseEvent<HTMLElement>) => setPop({ kind, el: e.currentTarget });
  if (!c) return <div className={embedded ? 'cm-embed cm-card-back' : 'cm-back cm-card-back'}><div className="cm cm-loading">Đang mở thẻ…</div></div>;
  const labels = board.labels.filter((l) => c.labels.includes(l.id));
  const members = board.members.filter((m) => c.members.includes(m.id));
  const due = dueState(c.dueAt, c.done);
  const edit = board.level !== 'observer';
  const links = c.attachments.filter((a) => !a.key);

  const top = (
    <div className="cm-top">
      {edit ? <button className="cm-list-b" onClick={open('move')} title="Chuyển sang danh sách khác">{c.listName}<Icon name="chevron" size={12} /></button> : <span className="cm-list-b">{c.listName}</span>}
      <span className="cm-gap" />
      <button className="cm-top-b" onClick={()=>setCommentsOpen(v=>!v)} aria-label={commentsOpen?'Ẩn bình luận':'Hiện bình luận'} aria-expanded={commentsOpen} aria-controls="card-comments" title={commentsOpen?'Ẩn bình luận':'Hiện bình luận'}><Icon name="comment" size={16}/></button>
      {edit && <button className="cm-top-b" onClick={open('cover')} aria-label="Ảnh bìa" title="Ảnh bìa"><Icon name="cover" size={16} /></button>}
      <button className="cm-top-b" onClick={open('actions')} aria-label="Thao tác với thẻ" title="Thao tác"><Icon name="more" size={16} /></button>
      {embedded ? topActions : <button className="cm-top-b" onClick={onClose} aria-label="Đóng" title="Đóng (Esc)"><Icon name="x" size={18} /></button>}
    </div>
  );

  return (
    <div className={embedded ? 'cm-embed cm-card-back' : 'cm-back cm-card-back'} onMouseDown={(e) => { if (!embedded && e.target === e.currentTarget) onClose(); }}>
      <div className={'cm' + (c.cover ? ' has-cover' : '')} role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-label={c.title} aria-busy={pending > 0}>
        {/* Like Trello's card: the cover, the list and the title stay put while the two panes below scroll. */}
        <div className="cm-fixed">
          {c.cover ? <div className="cm-cover" style={{ background: COLOR[c.cover] }}>{top}</div> : top}
          {c.archived && edit && (
            <div className="cm-archived"><Icon name="archive" size={16} />Thẻ này đã được lưu trữ.
              <button className="btn btn-gray btn-sm" onClick={() => act(() => api.updateCard(c.id, { archived: false }))}>Khôi phục</button>
              {(me.role === 'admin' || (c.createdBy ? c.createdBy === me.id : board.level === 'admin')) && <button className="btn btn-sm cm-danger" onClick={async () => { if (!confirm('Xoá hẳn thẻ này? Không khôi phục được.')) return; try { await api.deleteCard(c.id); onChanged(); onClose(); } catch (e: any) { toast(e.message, true); } }}>Xoá</button>}
            </div>
          )}

        </div>
        {pending > 0 && <p className="cm-saving" role="status">Đang lưu…</p>}
        <div className={'cm-panes'+(!commentsOpen?' comments-hidden':'')}>
          <main className="cm-left">
          <header className={'cm-head' + (c.linkedTask ? ' has-task' : '')}>
            <button className={'cm-done' + (c.done ? ' on' : '')} disabled={!edit} onClick={() => act(() => api.updateCard(c.id, { done: !c.done }))} aria-label={c.done ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'} title={c.done ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'}>
              {c.done ? <Icon name="check" size={14} /> : null}
            </button>
            <Title value={c.title} readOnly={!edit} onSave={(t) => act(() => api.updateCard(c.id, { title: t }))} />
            {c.linkedTask && !embedded && <button className="btn btn-gray btn-sm cm-task-open" onClick={() => { const taskId = c.linkedTask!.id; onClose(); openTask(taskId); }}><Icon name="checklist" size={14} />Mở trang công việc</button>}
          </header>
            {edit ? (
              <div className="cm-actions">
                <button className="cm-chip cm-add-chip" onClick={open('add')} aria-haspopup="dialog" aria-expanded={pop?.kind === 'add'}><Icon name="plus" size={14} />Thêm</button>
                {!c.customerId && <button className="cm-chip" onClick={open('customer')}><Icon name="folder" size={14} />Khách hàng</button>}
                {!c.projectId && <button className="cm-chip" onClick={open('project')}><Icon name="folder" size={14} />Dự án</button>}
                {!c.members.includes(me.id) && <button className="cm-chip" onClick={() => act(() => api.cardMember(c.id, me.id, true))}><Icon name="user" size={14} />Tham gia</button>}
                {labels.length === 0 && <button className="cm-chip" onClick={open('labels')}><Icon name="tag" size={14} />Nhãn</button>}
                {!c.dueAt && !c.startAt && <button className="cm-chip" onClick={open('dates')}><Icon name="clock" size={14} />Ngày</button>}
                <button className="cm-chip" onClick={open('checklist')}><Icon name="checklist" size={14} />Việc cần làm</button>
                {members.length === 0 && <button className="cm-chip" onClick={open('members')}><Icon name="user" size={14} />Thành viên</button>}
              </div>
            ) : <p className="cm-readonly"><Icon name="info" size={15} />Bạn chỉ có quyền xem board này: đọc và bình luận được, không sửa được thẻ.</p>}
            {(members.length > 0 || labels.length > 0 || c.dueAt || c.startAt || c.customerId || c.projectId) && (
              <div className="cm-meta">
                {c.customerId && <div><h4>Khách hàng</h4><div className="cm-row"><button className="cm-date" disabled={!edit} onClick={open('customer')}><Icon name="folder" size={14} />{c.customerName || 'Khách hàng đã xoá'}{edit && <Icon name="chevron" size={12} />}</button></div></div>}
                {c.projectId && <div><h4>Dự án</h4><div className="cm-row"><button className="cm-date" disabled={!edit} onClick={open('project')}><Icon name="folder" size={14} />{c.projectName || 'Dự án'}{edit && <Icon name="chevron" size={12} />}</button></div></div>}
                {members.length > 0 && <div><h4>Thành viên</h4><div className="cm-row">{members.map((m) => <MemberAvatar key={m.id} person={m} onUpdated={onChanged} onRemove={edit ? ()=>act(()=>api.cardMember(c.id,m.id,false)) : undefined}/>)}{edit && <button className="cm-plus employee-picker-add" onClick={open('members')} aria-label="Thêm thành viên"><Icon name="plus" size={22} /></button>}</div></div>}
                {labels.length > 0 && <div><h4>Nhãn</h4><div className="cm-row">{labels.map((l) => <button key={l.id} className="cm-label" style={{ background: COLOR[l.color] }} disabled={!edit} onClick={open('labels')}>{l.name || '\u00a0'}</button>)}{edit && <button className="cm-plus" onClick={open('labels')} aria-label="Thêm nhãn"><Icon name="plus" size={15} /></button>}</div></div>}
                {(c.dueAt || c.startAt) && (
                  <div><h4>{c.dueAt ? (c.startAt ? 'Ngày' : 'Ngày hết hạn') : 'Ngày bắt đầu'}</h4>
                    <div className="cm-row">
                      {c.dueAt && <input type="checkbox" className="cm-check" checked={c.done} disabled={!edit} onChange={() => act(() => api.updateCard(c.id, { done: !c.done }))} aria-label="Hoàn thành" />}
                      <button className="cm-date" disabled={!edit} onClick={open('dates')}>
                        {c.startAt && c.dueAt ? `${fullDate(c.startAt).split(' lúc')[0]} – ${fullDate(c.dueAt)}` : fullDate((c.dueAt || c.startAt)!)}
                        {due && <em className={'cm-due ' + due}>{due === 'done' ? 'Hoàn tất' : due === 'over' ? 'Quá hạn' : 'Sắp hết hạn'}</em>}
                        <Icon name="chevron" size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            
            {extra}
            <Description value={c.description} readOnly={!edit || !c.canEditDescription} onSave={(t) => act(() => api.updateCard(c.id, { description: t }))} />

            <WorkResult card={c} edit={edit} drive={drive} act={act} onAddFiles={open('files')} />

            {links.length > 0 && (
              <section className="cm-sec">
                <h3><Icon name="clip" size={18} />Đính kèm{edit && <button className="btn btn-gray btn-sm" onClick={open('attach')}>Thêm</button>}</h3>
                <ul className="cm-files">
                  {links.map((a) => (
                    <li key={a.id}>
                      <a className="cm-file-ico" href={a.url} target="_blank" rel="noreferrer">{/drive\.google|docs\.google/.test(a.url) ? 'DRIVE' : 'LINK'}</a>
                      <div><a href={a.url} target="_blank" rel="noreferrer"><b>{a.name}</b></a><span>Đã thêm {ago(a.createdAt)}{edit && <> · <button className="bk-link" onClick={() => act(() => api.deleteAttachment(a.id))}>Xoá</button></>}</span></div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {c.checklists.map((k) => <Checklist key={k.id} list={k} readOnly={!edit} act={act} />)}
          </main>

          {commentsOpen && <ResizeHandle side="after" cssVar="--cm-side-w" storage="comments" min={260} max={640} label="Đổi độ rộng khung bình luận" />}
          <aside id="card-comments" className="cm-right" hidden={!commentsOpen} aria-label="Bình luận và hoạt động">
            <h3 className="cm-right-h"><Icon name="comment" size={18} />Bình luận và hoạt động<button className="btn btn-gray btn-sm" onClick={() => setDetails(!details)}>{details ? 'Ẩn chi tiết' : 'Hiện chi tiết'}</button></h3>
            <CommentBox me={me} onSave={(t) => act(() => api.addComment(c.id, t))} />
            {!c.comments.length&&(!details||!c.activity.length)&&<p className="cm-feed-empty">Chưa có bình luận{details?' hoặc hoạt động':''}. Trao đổi về công việc tại đây.</p>}
            <ul className="cm-feed">
              {[...c.comments.map((x) => ({ at: x.createdAt, k: 'c' as const, x })), ...(details ? c.activity.map((x) => ({ at: x.createdAt, k: 'a' as const, x })) : [])]
                .sort((a, b) => b.at - a.at)
                .map((e) => e.k === 'c'
                  ? <Comment key={e.x.id} x={e.x} me={me} canDelete={e.x.userId === me.id || board.level === 'admin'} who={board.members.find((m) => m.id === e.x.userId) || { id: e.x.userId, name: e.x.userName }} act={act} />
                  : <li key={e.x.id} className="cm-act"><Avatar m={board.members.find((m) => m.id === e.x.userId) || { id: e.x.userId, name: e.x.userName }} size={28} /><div><p><b>{e.x.userName}</b> {activityText(e.x, true)}</p><span>{ago(e.x.createdAt)}</span></div></li>)}
            </ul>
          </aside>
        </div>
      </div>
      {pop && <CardPop pop={pop} card={c} board={board} me={me} edit={edit} setPop={setPop} act={act} onGone={() => { onChanged(); onClose(); }} />}
    </div>
  );
}

function Title({ value, readOnly, onSave }: { value: string; readOnly?: boolean; onSave: (t: string) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }, [v]);
  return <textarea ref={ref} className="cm-title" rows={1} value={v} readOnly={readOnly} onChange={(e) => setV(e.target.value)} aria-label="Tên thẻ"
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
    onBlur={() => { const t = v.replace(/\s+/g, ' ').trim(); if (!t) setV(value); else if (t !== value) onSave(t); }} />;
}

/** A text being written on the card: Lưu keeps it (and closes the box once it is saved), Huỷ drops it. */
function TextEdit({ value, placeholder, onSave, onClose }: { value: string; placeholder: string; onSave: (t: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  const save = async () => { if (saving) return; setSaving(true); try { if (await onSave(text)) onClose(); } finally { setSaving(false); } };
  return (
    <div className="cm-edit">
      <RichEditor value={value} onChange={setText} placeholder={placeholder} autoFocus disabled={saving} onSubmit={save} />
      <div className="cm-row"><button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? 'Đang lưu…' : 'Lưu'}</button><button className="btn btn-gray btn-sm" disabled={saving} onClick={onClose}>Huỷ</button></div>
    </div>
  );
}

function Description({ value, readOnly, onSave }: { value: string; readOnly?: boolean; onSave: (t: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  // A long description shows folded (its top, fading out) until "Hiện thêm", like Trello's.
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = box.current; setTall(!!el && el.scrollHeight > FOLD + 40); }, [value, editing]);
  if (readOnly && !value) return null;
  const text = (
    <>
      <div ref={box} className={'cm-desc' + (readOnly ? ' cm-desc-ro' : '') + (tall && !open ? ' folded' : '')} style={tall && !open ? { maxHeight: FOLD } : undefined}
        onClick={(e) => { if (!readOnly && !(e.target as HTMLElement).closest('a')) setEditing(true); }}><RichView text={value} /></div>
      {tall && <button className="btn btn-gray btn-sm cm-desc-more" onClick={() => setOpen(!open)}><Icon name={open ? 'up' : 'down'} size={14} />{open ? 'Thu gọn' : 'Hiện thêm'}</button>}
    </>
  );
  return (
    <section className="cm-sec">
      <h3><Icon name="lines" size={18} />Mô tả
        {tall && !editing && <button className="btn btn-gray btn-sm" onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : 'Mở rộng'}</button>}
        {!readOnly && value && !editing && <button className="btn btn-gray btn-sm" onClick={() => setEditing(true)}>Sửa</button>}
      </h3>
      {editing ? <TextEdit value={value} placeholder="Mô tả" onSave={onSave} onClose={() => setEditing(false)} />
        : value ? text
        : <button className="cm-desc-empty" onClick={() => setEditing(true)}>Thêm mô tả chi tiết hơn…</button>}
    </section>
  );
}
/** How tall a folded description is (px). */
const FOLD = 200;

/** The result note of the work: `text` is null for those who may not read it (`hidden` when there is one). */
type ResultNote = { text: string | null; hidden: boolean; save: (text: string) => Promise<unknown> };
/** A card linked to a task shows the task's note, on the task's terms (its people, its project's managers and members,
 *  admins); a card without a task keeps its own, for those who edit the card. */
function useResultNote(card: CardDetail): ResultNote | null {
  const taskId = card.linkedTask?.id;
  const [task, setTask] = useState<TaskDetail | null>(null);
  useEffect(() => { setTask(null); if (taskId) api.task(taskId).then(setTask, () => {}); }, [taskId]);
  if (!taskId) return { text: card.result, hidden: card.resultHidden, save: (text) => api.updateCard(card.id, { result: text }) };
  if (!task) return null;
  return { text: task.result, hidden: task.resultHidden, save: async (text) => { await api.updateTask(task.id, { result: text }); setTask({ ...task, result: text }); } };
}

/** Kết quả công việc: files of the customer's Drive folder put on the card, and the note (which can hold logins, so it
 *  shows only when asked). */
function WorkResult({ card, edit, drive, act, onAddFiles }: { card: CardDetail; edit: boolean; drive: boolean; act: (fn: () => Promise<unknown>) => Promise<boolean>; onAddFiles: (e: React.MouseEvent<HTMLElement>) => void }) {
  const note = useResultNote(card);
  const [editing, setEditing] = useState(false);
  const files = card.attachments.filter((a) => a.key);
  const canAdd = edit && drive && !!card.customerId;
  const writable = note?.text != null;
  if (!files.length && !canAdd && !writable && !note?.hidden) return null;
  return (
    <section className="cm-sec">
      <h3><Icon name="check" size={18} />Kết quả công việc{canAdd && <button className="btn btn-gray btn-sm" onClick={onAddFiles}>Thêm file</button>}</h3>
      {files.length > 0 && (
        <ul className="cm-files">
          {files.map((a) => (
            <li key={a.id}>
              <a className="cm-file-ico cm-video" href={a.url} target="_blank" rel="noreferrer"><Icon name="clip" size={18} />{drive && <img src={fileThumb(a)} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />}</a>
              <div><a href={a.url} target="_blank" rel="noreferrer"><b>{a.name}</b></a><span>Đã thêm {ago(a.createdAt)}{edit && <> · <button className="bk-link" onClick={() => act(() => api.deleteAttachment(a.id))}>Gỡ khỏi thẻ</button></>}</span></div>
            </li>
          ))}
        </ul>
      )}
      {note?.hidden && <p className="note">Chỉ người làm hoặc quản lý công việc này xem được ghi chú kết quả.</p>}
      {writable && (editing ? <TextEdit value={note.text!} placeholder="Ghi chú kết quả: link bài đăng, tài khoản bàn giao…" onSave={(t) => act(() => note.save(t))} onClose={() => setEditing(false)} />
        : !note.text ? <button className="cm-desc-empty" onClick={() => setEditing(true)}>Thêm ghi chú kết quả…</button>
        : <div className="cm-desc" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) setEditing(true); }}><RichView text={note.text} /></div>)}
    </section>
  );
}

function Checklist({ list, readOnly, act }: { list: CardDetail['checklists'][number]; readOnly?: boolean; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [adding, setAdding] = useState('');
  const [open, setOpen] = useState(false);
  const [hide, setHide] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const done = list.items.filter((i) => i.done).length, pct = list.items.length ? Math.round((done / list.items.length) * 100) : 0;
  const [saving, setSaving] = useState(false);
  const add = async () => { const t = adding.trim(); if (!t || saving) return; setSaving(true); try { if (await act(() => api.addItem(list.id, t))) setAdding(''); } finally { setSaving(false); } };
  return (
    <section className="cm-sec">
      <h3><Icon name="checklist" size={18} />
        {title !== null
          ? <input className="cm-inline" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              onBlur={() => { const t = (title || '').trim(); setTitle(null); if (t && t !== list.title) act(() => api.renameChecklist(list.id, t)); }} />
          : <span className="cm-k-title" onClick={() => !readOnly && setTitle(list.title)}>{list.title}</span>}
        {done > 0 && <button className="btn btn-gray btn-sm" onClick={() => setHide(!hide)}>{hide ? `Hiện mục đã chọn (${done})` : 'Ẩn mục đã chọn'}</button>}
        {!readOnly && <button className="btn btn-gray btn-sm" onClick={() => { if (confirm(`Xoá checklist “${list.title}”?`)) act(() => api.deleteChecklist(list.id)); }}>Xoá</button>}
      </h3>
      <div className="cm-progress"><span>{pct}%</span><i><b className={pct === 100 ? 'full' : ''} style={{ width: `${pct}%` }} /></i></div>
      <ul className="cm-items">
        {list.items.filter((i) => !(hide && i.done)).map((i) => (
          <li key={i.id} className={i.done ? 'done' : ''}>
            <input type="checkbox" className="cm-check" checked={i.done} disabled={readOnly} onChange={() => act(() => api.updateItem(i.id, { done: !i.done }))} aria-label={i.text} />
            {edit?.id === i.id
              ? <input className="cm-inline" autoFocus value={edit.text} onChange={(e) => setEdit({ id: i.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape' && !document.querySelector('dialog.qc-dialog[open]')) setEdit(null); }}
                  onBlur={() => { const t = edit.text.trim(); setEdit(null); if (t && t !== i.text) act(() => api.updateItem(i.id, { text: t })); }} />
              : <span onClick={() => !readOnly && setEdit({ id: i.id, text: i.text })}>{i.text}</span>}
            {!readOnly && <button className="cm-item-x" onClick={() => act(() => api.deleteItem(i.id))} aria-label="Xoá mục"><Icon name="trash" size={13} /></button>}
          </li>
        ))}
      </ul>
      {readOnly ? null : open ? (
        <div className="cm-edit">
          <textarea autoFocus rows={2} disabled={saving} value={adding} placeholder="Thêm một mục" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Escape' && !document.querySelector('dialog.qc-dialog[open]')) setOpen(false); }} />
          <div className="cm-row"><button className="btn btn-primary btn-sm" onClick={add} disabled={saving || !adding.trim()}>{saving ? 'Đang lưu…' : 'Thêm'}</button><button className="btn btn-gray btn-sm" onClick={() => setOpen(false)}>Huỷ</button></div>
        </div>
      ) : <button className="btn btn-gray btn-sm cm-additem" onClick={() => setOpen(true)}>Thêm một mục</button>}
    </section>
  );
}

function CommentBox({ me, onSave, initial = '', onCancel }: { me: User; onSave: (t: string) => Promise<boolean>; initial?: string; onCancel?: () => void }) {
  const [v, setV] = useState(initial);
  const [focus, setFocus] = useState(!!initial);
  const [saving, setSaving] = useState(false);
  const save = async () => { const t = v.trim(); if (!t || saving) return; setSaving(true); try { if (await onSave(t)) { setV(''); setFocus(false); onCancel?.(); } } finally { setSaving(false); } };
  return (
    <div className="cm-comment-new">
      {!onCancel && <Avatar m={me} size={32} />}
      <div className={'cm-comment-box' + (focus ? ' on' : '')}>
        {focus ? <RichEditor value={v} onChange={setV} placeholder="Viết bình luận…" autoFocus compact disabled={saving} onSubmit={save} />
          : <button type="button" className="cm-comment-start" onClick={() => setFocus(true)}>Viết bình luận…</button>}
        {focus && <div className="cm-row"><button className="btn btn-primary btn-sm" disabled={saving || !v.trim()} onClick={save}>{saving ? 'Đang lưu…' : 'Lưu'}</button><button className="btn btn-gray btn-sm" disabled={saving} onClick={() => { setV(initial); setFocus(!!initial); onCancel?.(); }}>Huỷ</button></div>}
      </div>
    </div>
  );
}

function Comment({ x, me, who, canDelete, act }: { x: CardDetail['comments'][number]; me: User; who: { id: string; name: string }; canDelete: boolean; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [edit, setEdit] = useState(false);
  return (
    <li className="cm-comment">
      <Avatar m={who} size={32} />
      <div>
        <p className="cm-comment-h"><b>{x.userName}</b><span>{ago(x.createdAt)}{x.edited ? ' (đã sửa)' : ''}</span></p>
        {edit ? <CommentBox me={me} initial={x.text} onCancel={() => setEdit(false)} onSave={(t) => act(() => api.editComment(x.id, t))} />
          : <div className="cm-comment-text"><RichView text={x.text} /></div>}
        {!edit && canDelete && (
          <span className="cm-comment-a">
            {x.userId === me.id && <button className="bk-link" onClick={() => setEdit(true)}>Sửa</button>}
            <button className="bk-link" onClick={() => { if (confirm('Xoá bình luận này?')) act(() => api.deleteComment(x.id)); }}>Xoá</button>
          </span>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- the small windows of the card
export function CardPop({ pop, card, board, me, edit, setPop, act, onGone }: {
  pop: { kind: PopKind; el: HTMLElement; label?: BoardLabel | null }; card: CardDetail; board: Board; me: User; edit: boolean;
  setPop: (p: { kind: PopKind; el: HTMLElement; label?: BoardLabel | null } | null) => void; act: (fn: () => Promise<unknown>) => Promise<boolean>; onGone: () => void;
}) {
  const close = () => setPop(null);
  const [q, setQ] = useState('');
  const drive = useStore((s) => s.pages.includes('workspace'));
  switch (pop.kind) {
    case 'add': {
      const items: { kind: PopKind; icon: string; title: string; desc: string }[] = [
        { kind: 'labels', icon: 'tag', title: 'Nhãn', desc: 'Phân loại và sắp xếp mức độ ưu tiên' },
        { kind: 'dates', icon: 'clock', title: 'Ngày', desc: 'Đặt ngày bắt đầu và hạn hoàn thành' },
        { kind: 'checklist', icon: 'checklist', title: 'Việc cần làm', desc: 'Thêm danh sách các việc nhỏ' },
        { kind: 'members', icon: 'user', title: 'Thành viên', desc: 'Giao thẻ cho thành viên trong board' },
        { kind: 'attach', icon: 'clip', title: 'Đính kèm', desc: 'Thêm liên kết và tài liệu' },
        { kind: 'cover', icon: 'cover', title: 'Ảnh bìa', desc: 'Chọn màu bìa cho thẻ' },
        { kind: 'customer', icon: 'folder', title: 'Khách hàng', desc: 'Liên kết thẻ với khách hàng' },
        { kind: 'project', icon: 'folder', title: 'Dự án', desc: 'Liên kết thẻ với dự án công việc' },
      ];
      return <Pop anchor={pop.el} title="Thêm vào thẻ" onClose={close}><div className="cm-add-menu">{items.map((item) => <button key={item.kind} onClick={() => setPop({ kind: item.kind, el: pop.el })}><span className="cm-add-icon"><Icon name={item.icon} size={19} /></span><span><b>{item.title}</b><small>{item.desc}</small></span></button>)}{drive && card.customerId && <button onClick={() => setPop({ kind: 'files', el: pop.el })}><span className="cm-add-icon"><Icon name="check" size={19} /></span><span><b>Kết quả công việc</b><small>Chọn file từ thư mục khách hàng</small></span></button>}</div></Pop>;
    }
    case 'members': {
      return <Pop anchor={pop.el} title="Thành viên" onClose={close}><CardMemberChoices board={board} card={card} onToggle={id=>act(()=>api.cardMember(card.id,id,!card.members.includes(id)))}/><QuickCreateButton kind="employee" label="Tạo nhân viên và thêm vào board / thẻ" onCreated={async r=>{if(!await act(async()=>{await api.setBoardMember(board.id,r.id,'normal');await api.cardMember(card.id,r.id,true);}))throw new Error('Chưa thêm được nhân viên vào thẻ');}}/></Pop>;
    }
    case 'labels': {
      const list = board.labels.filter((l) => !q.trim() || l.name.toLowerCase().includes(q.trim().toLowerCase()) || COLOR_NAME[l.color]?.includes(q.trim().toLowerCase()));
      return (
        <Pop anchor={pop.el} title="Nhãn" onClose={close}>
          <input className="bk-in" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhãn…" />
          <h5>Nhãn</h5>
          {list.map((l) => (
            <div key={l.id} className="bk-label-row">
              <input type="checkbox" className="cm-check" checked={card.labels.includes(l.id)} onChange={() => act(() => api.cardLabel(card.id, l.id, !card.labels.includes(l.id)))} aria-label={l.name || COLOR_NAME[l.color]} />
              <button className="bk-label" style={{ background: COLOR[l.color] }} onClick={() => act(() => api.cardLabel(card.id, l.id, !card.labels.includes(l.id)))}>{l.name}</button>
              {board.canShape && <button className="bk-x" onClick={() => setPop({ kind: 'label', el: pop.el, label: l })} aria-label="Sửa nhãn"><Icon name="text" size={13} /></button>}
            </div>
          ))}
          {board.canShape ? <button className="btn btn-gray bk-wide" onClick={() => setPop({ kind: 'label', el: pop.el, label: null })}>Tạo nhãn mới</button>
            : <p className="note">Tạo hay sửa nhãn: admin board (hoặc thành viên khi admin cho phép).</p>}
        </Pop>
      );
    }
    case 'label': return <LabelEdit cardId={card.id} anchor={pop.el} board={board} label={pop.label || null} onBack={() => setPop({ kind: 'labels', el: pop.el })} onClose={close} act={act} />;
    case 'checklist': return <ChecklistPop anchor={pop.el} onClose={close} onAdd={(t) => { close(); act(() => api.addChecklist(card.id, t)); }} />;
    case 'dates': return <DatesPop anchor={pop.el} card={card} onClose={close} act={act} />;
    case 'customer': return <CustomerPop anchor={pop.el} card={card} onClose={close} onPick={async(id)=>{const ok=await act(()=>api.updateCard(card.id,{customerId:id}));if(ok)close();return ok;}} />;
    case 'project': return <ProjectPop anchor={pop.el} card={card} onClose={close} onPick={async(id)=>{const ok=await act(()=>api.updateCard(card.id,{projectId:id}));if(ok)close();return ok;}} />;
    case 'files': return <DriveFilesPop anchor={pop.el} card={card} onClose={close} onAdd={(keys) => { close(); act(() => api.addCardFiles(card.id, keys)); }} />;
    case 'attach': return <AttachPop anchor={pop.el} onClose={close} onAdd={(url, name) => { close(); act(() => api.addAttachment(card.id, url, name)); }} />;
    case 'cover':
      return (
        <Pop anchor={pop.el} title="Ảnh bìa" onClose={close}>
          <h5>Màu</h5>
          <div className="bk-colors">{Object.keys(COLOR).map((k) => <button key={k} className={card.cover === k ? 'on' : ''} style={{ background: COLOR[k] }} aria-label={`Màu ${COLOR_NAME[k]}`} onClick={() => act(() => api.updateCard(card.id, { cover: k }))} />)}</div>
          {card.cover && <button className="btn btn-gray bk-wide" onClick={() => { close(); act(() => api.updateCard(card.id, { cover: null })); }}>Gỡ ảnh bìa</button>}
        </Pop>
      );
    case 'move': return <MovePop anchor={pop.el} board={board} card={card} onClose={close} act={act} />;
    case 'copy': return <CopyPop anchor={pop.el} card={card} onClose={close} act={act} />;
    // Trello's card menu: join or leave, move, copy, share the link, archive; only whoever made the card archives or deletes it.
    case 'actions': {
      // Cards from before makers were kept have no maker: the board's admins look after those.
      const joined = card.members.includes(me.id), mine = me.role === 'admin' || (card.createdBy ? card.createdBy === me.id : board.level === 'admin');
      const link = `${location.origin}${location.pathname}#boards/${board.id}/c/${card.id}`;
      return (
        <Pop anchor={pop.el} title="Thao tác" onClose={close}>
          <div className="bk-menu">
            {edit && (joined
              ? <button onClick={() => { close(); act(() => api.cardMember(card.id, me.id, false)); }}><Icon name="user" size={15} />Rời thẻ</button>
              : <button onClick={() => { close(); act(() => api.cardMember(card.id, me.id, true)); }}><Icon name="user" size={15} />Tham gia</button>)}
            {edit && <button onClick={() => setPop({ kind: 'move', el: pop.el })}><Icon name="arrow" size={15} />Di chuyển</button>}
            {edit && <button onClick={() => setPop({ kind: 'copy', el: pop.el })}><Icon name="copy" size={15} />Sao chép</button>}
            <button onClick={() => { close(); navigator.clipboard.writeText(link).then(() => toast('Đã sao chép link thẻ'), () => toast('Trình duyệt chặn clipboard', true)); }}><Icon name="share" size={15} />Sao chép link thẻ</button>
            {edit && mine && <>
              <hr />
              {card.archived
                ? <button onClick={() => { close(); act(() => api.updateCard(card.id, { archived: false })); }}><Icon name="refresh" size={15} />Khôi phục</button>
                : <button onClick={() => { close(); act(() => api.updateCard(card.id, { archived: true })); }}><Icon name="archive" size={15} />Lưu trữ</button>}
              {card.archived && <button className="bk-danger" onClick={async () => { if (!confirm('Xoá hẳn thẻ này? Không khôi phục được.')) return; close(); try { await api.deleteCard(card.id); onGone(); } catch (e: any) { toast(e.message, true); } }}><Icon name="trash" size={15} />Xoá thẻ</button>}
            </>}
            {edit && !mine && <p className="note bk-menu-note">Chỉ người tạo thẻ hoặc quản trị viên mới lưu trữ hay xoá được thẻ này.</p>}
          </div>
        </Pop>
      );
    }
  }
}

/** The board's people first, then everyone else in the company (picking one adds them to the board). */
function CardMemberChoices({ board, card, onToggle }: { board: Board; card: CardDetail; onToggle: (id: string) => void }) {
  const [people, setPeople] = useState<{ id: string; name: string; email: string }[]>([]);
  useEffect(() => { let on = true; api.boardMembers(board.id).then((r) => { if (on) setPeople(r.people); }, () => {}); return () => { on = false; }; }, [board.id, board.members.length]);
  return <MemberChoices people={board.members} others={people} selected={card.members} onToggle={onToggle} />;
}

function LabelEdit({ cardId, anchor, board, label, onBack, onClose, act }: { cardId:string; anchor: HTMLElement; board: Board; label: BoardLabel | null; onBack: () => void; onClose: () => void; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(label?.name || '');
  const [color, setColor] = useState(label?.color || 'green');
  const createdLabel=useRef<string|null>(null),savingRef=useRef(false);
  const[saving,setSaving]=useState(false);
  const save=async()=>{
    if(savingRef.current)return;savingRef.current=true;setSaving(true);
    try{if(await act(async()=>{
      if(label)await api.updateLabel(label.id,{name,color});
      else{
        if(!createdLabel.current)createdLabel.current=(await api.createLabel(board.id,{name,color})).id;
        else await api.updateLabel(createdLabel.current,{name,color});
        await api.cardLabel(cardId,createdLabel.current,true);
      }
    }))onBack();}finally{savingRef.current=false;setSaving(false);}
  };

  return (
    <Pop anchor={anchor} title={label ? 'Sửa nhãn' : 'Tạo nhãn mới'} onClose={onClose} onBack={onBack}>
      <div className="bk-label-prev"><span style={{ background: COLOR[color] }}>{name}</span></div>
      <h5>Tiêu đề</h5>
      <input className="bk-in" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <h5>Chọn một màu</h5>
      <div className="bk-colors">{Object.keys(COLOR).map((k) => <button key={k} className={k === color ? 'on' : ''} style={{ background: COLOR[k] }} aria-label={`Màu ${COLOR_NAME[k]}`} onClick={() => setColor(k)} />)}</div>
      <div className="cm-row bk-split">
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={()=>void save()}>{saving?'Đang lưu…':label?'Lưu':'Tạo và chọn'}</button>
        {label && <button className="btn btn-sm cm-danger" onClick={async () => { if (!confirm('Xoá nhãn này khỏi board và mọi thẻ?')) return; await act(() => api.deleteLabel(label.id)); onBack(); }}>Xoá</button>}
      </div>
    </Pop>
  );
}

function ChecklistPop({ anchor, onClose, onAdd }: { anchor: HTMLElement; onClose: () => void; onAdd: (t: string) => void }) {
  const [t, setT] = useState('Việc cần làm');
  return (
    <Pop anchor={anchor} title="Thêm danh sách công việc" onClose={onClose}>
      <h5>Tiêu đề</h5>
      <input className="bk-in" autoFocus value={t} onChange={(e) => setT(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={(e) => e.key === 'Enter' && t.trim() && onAdd(t.trim())} />
      <button className="btn btn-primary btn-sm" disabled={!t.trim()} onClick={() => onAdd(t.trim())}>Thêm</button>
    </Pop>
  );
}

function DatesPop({ anchor, card, onClose, act }: { anchor: HTMLElement; card: CardDetail; onClose: () => void; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const base = card.dueAt || Date.now() + 864e5;
  const [hasStart, setHasStart] = useState(!!card.startAt);
  const [start, setStart] = useState(dateIn(card.startAt || Date.now()));
  const [hasDue, setHasDue] = useState(!!card.dueAt || !card.startAt);
  const [due, setDue] = useState(dateIn(base));
  const [at, setAt] = useState(card.dueAt ? timeIn(card.dueAt) : '17:00');
  const ms = (d: string, t = '00:00') => new Date(`${d}T${t}`).getTime();
  return (
    <Pop anchor={anchor} title="Ngày" onClose={onClose}>
      <label className="bk-check"><input type="checkbox" checked={hasStart} onChange={(e) => setHasStart(e.target.checked)} />Ngày bắt đầu</label>
      <input className="bk-in" type="date" disabled={!hasStart} value={start} onChange={(e) => setStart(e.target.value)} />
      <label className="bk-check"><input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} />Ngày hết hạn</label>
      <div className="cm-row">
        <input className="bk-in" type="date" disabled={!hasDue} value={due} onChange={(e) => setDue(e.target.value)} />
        <input className="bk-in bk-time" type="time" disabled={!hasDue} value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      <button className="btn btn-primary bk-wide" onClick={() => { onClose(); act(() => api.updateCard(card.id, { startAt: hasStart && start ? ms(start) : null, dueAt: hasDue && due ? ms(due, at || '00:00') : null })); }}>Lưu</button>
      <button className="btn btn-gray bk-wide" onClick={() => { onClose(); act(() => api.updateCard(card.id, { startAt: null, dueAt: null })); }}>Gỡ bỏ</button>
    </Pop>
  );
}


function CustomerPop({ anchor, card, onClose, onPick }: { anchor: HTMLElement; card: CardDetail; onClose: () => void; onPick: (id: string | null) => void | Promise<boolean> }) {
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [q, setQ] = useState('');
  const reload=()=>api.boardCustomers().then(setList);
  useEffect(()=>{void reload().catch(e=>toast(e.message,true));},[]);
  useEntityRefresh(()=>{void reload().catch(()=>{});});
  const shown = (list || []).filter((k) => k.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Pop anchor={anchor} title="Khách hàng" onClose={onClose}>
      <input className="bk-in" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm khách hàng" />
      {list === null ? <p className="note">Đang tải…</p> : (
        <div className="bk-scroll">
          {shown.map((k) => (
            <button key={k.id} className="bk-opt" onClick={() => onPick(k.id)}>
              <Icon name="folder" size={16} /><span>{k.name}</span>{card.customerId === k.id && <Icon name="check" size={15} />}
            </button>
          ))}
          {!shown.length && <p className="note">{list.length ? 'Không có khách nào khớp.' : 'Chưa có khách hàng nào trong thư mục CLIENTS trên Drive.'}</p>}
        </div>
      )}
      <QuickCreateButton kind="customer" onCreated={async r=>{await reload();if(await onPick(r.id)===false)throw new Error('Chưa liên kết được khách hàng với thẻ');}}/>
      {card.customerId && <button className="btn btn-gray bk-wide" onClick={() => onPick(null)}>Bỏ chọn khách hàng</button>}
    </Pop>
  );
}

function ProjectPop({ anchor, card, onClose, onPick }: { anchor: HTMLElement; card: CardDetail; onClose: () => void; onPick: (id: string | null) => void | Promise<boolean> }) {
  const [meta, setMeta] = useState<TaskMeta | null>(null);
  const [q, setQ] = useState('');
  const reload = () => api.taskMeta().then(setMeta);
  useEffect(() => { void reload().catch((e) => toast(e.message, true)); }, []);
  useEntityRefresh(() => { void reload().catch(() => {}); });
  const projects = (meta?.projects || []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()) || (p.customerName && p.customerName.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <Pop anchor={anchor} title="Dự án" onClose={onClose}>
      <input className="bk-in" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm dự án…" />
      {meta === null ? <p className="note">Đang tải…</p> : (
        <div className="bk-scroll">
          {projects.map((p) => (
            <button key={p.id} className="bk-opt" onClick={() => onPick(p.id)}>
              <Icon name="folder" size={16} /><span>{p.name}{p.customerName ? ` (${p.customerName})` : ''}</span>{card.projectId === p.id && <Icon name="check" size={15} />}
            </button>
          ))}
          {!projects.length && <p className="note">{meta.projects.length ? 'Không có dự án nào khớp.' : 'Chưa có dự án công việc nào.'}</p>}
        </div>
      )}
      <QuickCreateButton kind="project" onCreated={async (r) => { await reload(); if (await onPick(r.id) === false) throw new Error('Chưa liên kết được dự án với thẻ'); }} />
      {card.projectId && <button className="btn btn-gray bk-wide" onClick={() => onPick(null)}>Bỏ chọn dự án</button>}
    </Pop>
  );
}

/** The files of the card's customer (its folder and the folders in it), to put on the card as the work's result. */
function DriveFilesPop({ anchor, card, onClose, onAdd }: { anchor: HTMLElement; card: CardDetail; onClose: () => void; onAdd: (keys: string[]) => void }) {
  const [files, setFiles] = useState<(DriveFile & { folder: string })[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  useEffect(() => {
    api.customer(card.customerId!).then((k) => setFiles([
      ...(k.files || []).map((f) => ({ ...f, folder: '' })),
      ...(k.folders || []).flatMap((d) => d.files.map((f) => ({ ...f, folder: d.name }))),
    ].filter((f) => f.kind !== 'folder')), (e) => { toast(e.message, true); setFiles([]); });
  }, [card.customerId]);
  const have = new Set(card.attachments.filter((a) => a.customerId === card.customerId).map((a) => a.key));
  const shown = (files || []).filter((f) => `${f.folder} ${f.name}`.toLowerCase().includes(q.trim().toLowerCase()));
  const flip = (k: string) => setPick((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <Pop anchor={anchor} title={`File của ${card.customerName || 'khách hàng'}`} onClose={onClose}>
      <input className="bk-in" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm file" />
      {files === null ? <p className="note">Đang đọc thư mục trên Drive…</p> : (
        <div className="bk-scroll">
          {shown.map((f) => (
            <label key={f.key} className={'bk-video' + (have.has(f.key) ? ' on' : '')}>
              <input type="checkbox" className="cm-check" checked={have.has(f.key) || pick.has(f.key)} disabled={have.has(f.key)} onChange={() => flip(f.key)} />
              <span className="bk-video-pic">{f.thumb ? <img src={f.thumb} alt="" loading="lazy" /> : <Icon name={f.kind === 'video' ? 'film' : 'clip'} size={16} />}</span>
              <span>{f.name}{f.folder && <small>{f.folder}</small>}</span>
            </label>
          ))}
          {!shown.length && <p className="note">{files.length ? 'Không có file nào khớp.' : 'Thư mục của khách chưa có file.'}</p>}
        </div>
      )}
      <button className="btn btn-primary bk-wide" disabled={!pick.size} onClick={() => onAdd([...pick])}>{pick.size ? `Thêm ${pick.size} file` : 'Chọn file để thêm'}</button>
    </Pop>
  );
}

function AttachPop({ anchor, onClose, onAdd }: { anchor: HTMLElement; onClose: () => void; onAdd: (url: string, name: string) => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const ok = /^https?:\/\/\S+$/.test(url.trim());
  return (
    <Pop anchor={anchor} title="Đính kèm" onClose={onClose}>
      <h5>Dán link (Google Drive, Sheet, trang web…)</h5>
      <input className="bk-in" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      <h5>Tên hiển thị (không bắt buộc)</h5>
      <input className="bk-in" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && onAdd(url.trim(), name.trim())} />
      <button className="btn btn-primary btn-sm" disabled={!ok} onClick={() => onAdd(url.trim(), name.trim())}>Chèn</button>
    </Pop>
  );
}

function MovePop({ anchor, board, card, onClose, act }: { anchor: HTMLElement; board: Board; card: CardDetail; onClose: () => void; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [list, setList] = useState(card.listId);
  const[extraLists,setExtraLists]=useState<Board['lists']>([]);
  const lists=[...board.lists,...extraLists.filter(x=>!board.lists.some(l=>l.id===x.id))];
  const target = lists.find((l) => l.id === list);
  const count = (target?.cards.filter((x) => x.id !== card.id).length || 0) + 1;
  const [at, setAt] = useState(() => Math.max(0, board.lists.find((l) => l.id === card.listId)?.cards.findIndex((x) => x.id === card.id) ?? 0));
  return (
    <Pop anchor={anchor} title="Di chuyển thẻ" onClose={onClose}>
      <h5>Chọn đích đến</h5>
      <label className="bk-field"><span>Danh sách</span><EntitySelect kind="list" context={{boardId:board.id}} value={list} onCreated={r=>setExtraLists(old=>[...old,{...r,cards:[]}])} onChange={v=>{setList(v);setAt(0);}}>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}{l.id === card.listId ? ' (hiện tại)' : ''}</option>)}</EntitySelect></label>
      <label className="bk-field"><span>Vị trí</span><select value={Math.min(at, count - 1)} onChange={(e) => setAt(Number(e.target.value))}>{Array.from({ length: count }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>
      <button className="btn btn-primary btn-sm" onClick={() => { onClose(); act(() => api.updateCard(card.id, { listId: list, index: Math.min(at, count - 1) })); }}>Di chuyển</button>
    </Pop>
  );
}

function CopyPop({ anchor, card, onClose, act }: { anchor: HTMLElement; card: CardDetail; onClose: () => void; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [t, setT] = useState(card.title);
  return (
    <Pop anchor={anchor} title="Sao chép thẻ" onClose={onClose}>
      <h5>Tiêu đề</h5>
      <textarea className="bk-in" rows={3} autoFocus value={t} onChange={(e) => setT(e.target.value)} />
      <p className="note">Bản sao giữ mô tả, ngày, ảnh bìa, nhãn và checklist; đặt ngay dưới thẻ này.</p>
      <button className="btn btn-primary btn-sm" disabled={!t.trim()} onClick={() => { onClose(); act(() => api.copyCard(card.id, t.trim())); }}>Tạo thẻ</button>
    </Pop>
  );
}
