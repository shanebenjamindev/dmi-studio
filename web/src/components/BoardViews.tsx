import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import { ScheduleViews } from './ScheduleViews';
import { CardPop, type PopKind } from './CardModal';
import { COLOR } from './boardkit';
import type { Board, BoardCard, BoardViewKind, CardDetail, User } from '../types';
import { DayRangeField } from './DateRange';


export function QuickCard({ id, rect, board, me, onClose, onOpen, onChanged }: { id: string; rect: DOMRect; board: Board; me: User; onClose: () => void; onOpen: () => void; onChanged: () => void }) {
  const [card, setCard] = useState<CardDetail | null>(null);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [pop, setPop] = useState<{ kind: PopKind; el: HTMLElement } | null>(null);
  useEffect(() => { let active = true; api.card(id).then((c) => { if (active) { setCard(c); setTitle(c.title); } }, (e) => { toast(e.message, true); onClose(); }); return () => { active = false; }; }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  const edit = board.level !== 'observer';
  const canDelete = edit && card && (me.role === 'admin' || (card.createdBy ? card.createdBy === me.id : board.level === 'admin'));
  const act = async (fn: () => Promise<unknown>) => {
    setPending(true);
    try { await fn(); setCard(await api.card(id)); onChanged(); return true; }
    catch (e: any) { toast(e.message, true); return false; }
    finally { setPending(false); }
  };
  const save = async () => { if (title.trim() && await act(() => api.updateCard(id, { title: title.trim() }))) onClose(); };
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - 536));
  const top = Math.max(12, Math.min(rect.top, window.innerHeight - 440));
  return createPortal(<div className="bq-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}>
    <section className="bq-editor" style={{ left, top }} role="dialog" aria-label="Thao tác nhanh với thẻ" aria-busy={pending}>
      <div className="bq-title"><div className="bq-card" style={card?.cover ? { borderTop: `20px solid ${COLOR[card.cover]}` } : undefined}>
        <textarea autoFocus aria-label="Tên thẻ" value={title} readOnly={!edit || !card} maxLength={500} placeholder="Đang mở thẻ…" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && edit) { e.preventDefault(); if (!pending) save(); } }} />
      </div>{edit && <button className="btn btn-primary" disabled={!card || pending || !title.trim()} onClick={save}>{pending ? 'Đang lưu…' : 'Lưu'}</button>}</div>
      <nav className="bq-actions" aria-label="Thao tác thẻ">
        <button onClick={onOpen}><Icon name="boards" size={16} />Mở thẻ</button>
        {edit && (['labels', 'members', 'cover', 'dates', 'move', 'copy'] as PopKind[]).map((kind, i) => <button key={kind} disabled={!card || pending} onClick={(e) => setPop({ kind, el: e.currentTarget })}><Icon name={['tag', 'user', 'cover', 'clock', 'arrow', 'copy'][i]} size={16} />{['Sửa nhãn', 'Đổi thành viên', 'Đổi ảnh bìa', 'Sửa ngày', 'Di chuyển', 'Sao chép thẻ'][i]}</button>)}
        <button onClick={async () => { try { await navigator.clipboard.writeText(`${location.href.split('#')[0]}#boards/${board.id}/c/${id}`); toast('Đã sao chép liên kết'); } catch { toast('Không sao chép được liên kết', true); } }}><Icon name="share" size={16} />Sao chép liên kết</button>
        {canDelete && <button disabled={pending} onClick={async () => { if (await act(() => api.updateCard(id, { archived: true }))) onClose(); }}><Icon name="archive" size={16} />Lưu trữ</button>}
        {canDelete && <button className="bq-delete" disabled={pending} onClick={async () => {
          if (!confirm('Xoá hẳn thẻ này? Không khôi phục được.')) return;
          setPending(true);
          try { await api.deleteCard(id); onChanged(); onClose(); }
          catch (e: any) { toast(e.message, true); }
          finally { setPending(false); }
        }}><Icon name="x" size={16} />Xoá thẻ</button>}
      </nav>
    </section>
    {pop && card && <CardPop key={pop.kind} pop={pop} card={card} board={board} me={me} edit={edit} setPop={setPop} act={act} onGone={() => { onChanged(); onClose(); }} />}
  </div>, document.body);
}

/** A card added from a view other than the columns: into one of the lists, due on a day if one is picked (at 17:00, like
 *  a card's usual due time). It stays open for the next one. */
function AddCard({ lists, onAdd }: { lists: { id: string; name: string }[]; onAdd: (listId: string, title: string, dueAt: number | null) => Promise<unknown> }) {
  const [open, setOpen] = useState(false), [title, setTitle] = useState(''), [list, setList] = useState(lists[0].id), [due, setDue] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!open) return <button className="bv-add-b" onClick={() => setOpen(true)}><Icon name="plus" size={15} />Thêm thẻ</button>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try { await onAdd(lists.some((l) => l.id === list) ? list : lists[0].id, t, due ? new Date(`${due}T17:00`).getTime() : null); setTitle(''); }
    catch { /* onAdd says what went wrong; the title stays to try again */ }
    finally { setBusy(false); input.current?.focus(); }
  };
  return <form className="bv-add" onSubmit={submit}>
    <input ref={input} autoFocus aria-label="Tên thẻ" placeholder="Nhập tên thẻ…" maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
    <select aria-label="Danh sách" value={list} onChange={(e) => setList(e.target.value)}>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
    <DayRangeField single from="" to={due} endLabel="Thời hạn" placeholder="Thời hạn" onChange={(_, t) => setDue(t)} />
    <button className="btn btn-primary btn-sm" disabled={!title.trim() || busy}>{busy ? 'Đang thêm…' : 'Thêm thẻ'}</button>
    <button type="button" className="bd-icon" onClick={() => setOpen(false)} aria-label="Đóng"><Icon name="x" size={15} /></button>
  </form>;
}

export function BoardAlternative({ board, view, filter, onOpen, onAdd }: { board: Board; view: BoardViewKind; filter: (c: BoardCard) => boolean; onOpen: (id: string) => void; onAdd?: (listId: string, title: string, dueAt: number | null) => Promise<unknown> }) {
  return <div className="bv-wrap">
    {onAdd && board.lists.length > 0 && <AddCard lists={board.lists} onAdd={onAdd} />}
    <AlternativeView board={board} view={view} filter={filter} onOpen={onOpen} />
  </div>;
}
function AlternativeView({ board, view, filter, onOpen }: { board: Board; view: BoardViewKind; filter: (c: BoardCard) => boolean; onOpen: (id: string) => void }) {
  const cards = board.lists.flatMap((l) => l.cards.filter(filter).map((c) => ({ ...c, listName: l.name })));
  if (view === 'dashboard') return <section className="bv-panel"><h2>Tổng quan board</h2><div className="bv-stats">{[['Tổng số thẻ', cards.length], ['Hoàn thành', cards.filter((c) => c.done).length], ['Quá hạn', cards.filter((c) => !c.done && c.dueAt && c.dueAt < Date.now()).length], ['Chưa có hạn', cards.filter((c) => !c.dueAt).length]].map(([name, n]) => <div key={name}><strong>{n}</strong><span>{name}</span></div>)}</div>{board.lists.map((l) => { const list = cards.filter((c) => c.listId === l.id); return <div className="bv-progress" key={l.id}><b>{l.name}</b><progress max={list.length || 1} value={list.filter((c) => c.done).length} /><span>{list.filter((c) => c.done).length}/{list.length} hoàn thành</span></div>; })}</section>;
  return <ScheduleViews view={view === 'calendar' || view === 'timeline' ? view : 'table'} groups={board.lists.map((l) => l.name)} cards={cards.map((c) => ({ id: c.id, title: c.title, group: c.listName, labels: board.labels.filter((l) => c.labels.includes(l.id)).map((l) => ({ name: l.name, color: COLOR[l.color] })), members: board.members.filter((m) => c.members.includes(m.id)).map((m) => m.name), startAt: c.startAt, dueAt: c.dueAt, done: c.done }))} onOpen={onOpen} />;
}
