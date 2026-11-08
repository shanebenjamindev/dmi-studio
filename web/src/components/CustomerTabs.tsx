// The tabs of one customer on the Customers page besides its projects, Drive and reports: an overview, its tasks, its
// members and the history of its record.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReadingTabs } from './ReadingLayout';
import { api } from '../api';
import { openTask, toast, useStore } from '../store';
import { Icon } from './ui';
import { Avatar, Pop, Rich } from './boardkit';
import { MemberAvatar } from './MemberAvatar';
import { MemberChoices } from './EmployeePicker';
import { BrandLoading } from './BrandLoading';
import type { CustomerMembersData, CustomerRecord, CustomerTag, CustomerTaskRow, RecordChange, ServiceRef } from '../types';
import type { CustomerView } from './CustomerDashboard';

const TZ = { timeZone: 'Asia/Ho_Chi_Minh' } as const;
const day = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString('vi-VN', { ...TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const time = (t: number) => new Date(t).toLocaleString('vi-VN', { ...TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const LEVEL: Record<string, string> = { admin: 'Quản lý', normal: 'Thành viên', observer: 'Chỉ xem' };

/** Loads with the tab and again on `reload`. */
function useData<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState('');
  const reload = () => fn().then((d) => { setData(d); setError(''); }, (e) => setError(e.message));
  useEffect(() => { setData(null); void reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload };
}
const State = ({ error, empty, icon, children }: { error: string; empty?: string; icon?: string; children?: React.ReactNode }) =>
  error ? <p className="note err" role="alert">{error}</p> : empty ? <div className="crm-empty"><Icon name={icon || 'inbox'} size={30} /><p>{empty}</p></div> : <>{children}</>;

const TONE: Record<string, string> = { done: 'ok', done_late: 'warn', cancelled: 'muted', todo: 'muted', paused: 'warn' };
const late = (t: CustomerTaskRow) => t.state === 'overdue';

function CustomerTaskViews({ rows, view }: { rows: CustomerTaskRow[]; view: CustomerView }) {
  if (view === 'kanban') {
    const cols = [
      { key: 'todo', label: 'Chưa thực hiện', color: '#64748b', items: rows.filter((t) => !late(t) && (t.category === 'todo' || t.category === 'paused' || t.category === 'other')) },
      { key: 'doing', label: 'Đang thực hiện', color: '#2563eb', items: rows.filter((t) => !late(t) && t.category === 'doing') },
      { key: 'overdue', label: 'Quá hạn', color: '#dc2626', items: rows.filter((t) => late(t)) },
      { key: 'done', label: 'Hoàn thành', color: '#16a34a', items: rows.filter((t) => t.category === 'done' || t.category === 'done_late') },
    ];
    return (
      <div className="cd-kanban crm-task-kanban">
        {cols.map((col) => (
          <section key={col.key} className="cd-col">
            <header><i style={{ background: col.color }} /><b>{col.label}</b><span>{col.items.length}</span></header>
            <div className="cd-col-cards">
              {col.items.map((t) => (
                <button key={t.id} className="cd-kcard" onClick={() => openTask(t.id)}>
                  <b>{t.title}</b>
                  {t.project?.name && <small>{t.project.name}</small>}
                  <footer>
                    <span>{t.assignees.map((a) => a.name).join(', ') || 'Chưa giao'}</span>
                    <span>{day(t.dueAt)}</span>
                  </footer>
                </button>
              ))}
              {!col.items.length && <p className="cd-col-empty">Trống</p>}
            </div>
          </section>
        ))}
      </div>
    );
  }
  if (view === 'grid') {
    return (
      <div className="cd-cards crm-task-cards">
        {rows.map((t) => (
          <button key={t.id} className="cd-customer" onClick={() => openTask(t.id)}>
            <header>
              <span className={'crm-status ' + (TONE[t.category] || '')}>{t.status}</span>
              {late(t) && <span className="crm-status bad">Quá hạn</span>}
            </header>
            <h3>{t.title}</h3>
            <p>{t.project?.name || 'Chưa gắn dự án'}</p>
            <footer>
              <span>{t.assignees.map((a) => a.name).join(', ') || 'Chưa giao'}</span>
              <span>Hạn: {day(t.dueAt)}</span>
            </footer>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="cd-table">
      <table>
        <thead><tr><th>Công việc</th><th>Trạng thái</th><th>Người làm</th><th>Thời hạn</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="crm-row" onClick={() => openTask(t.id)}>
              <td><b>{t.title}</b>{t.project?.name && <small className="crm-sub">{t.project.name}</small>}</td>
              <td><span className={'crm-status ' + (TONE[t.category] || '')}>{t.status}</span>{late(t) && <span className="crm-status bad">Quá hạn</span>}</td>
              <td>{t.assignees.map((a) => a.name).join(', ') || '—'}</td>
              <td>{day(t.dueAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- overview
export function CustomerOverview({ c, view = 'list', onTab, onChanged }: { c: CustomerRecord; view?: CustomerView; onTab: (tab: string) => void; onChanged?: () => void }) {
  const rec = useData(() => api.customerRecord(c.id), [c]);
  const tasks = useData(() => api.customerTaskList(c.id), [c.id]);
  const r = rec.data;
  const taskRows = tasks.data || [];
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  useEffect(() => { setEditingNotes(false); }, [c.id]);
  const saveNotes = async () => {
    if (savingNotes) return;
    setSavingNotes(true);
    try {
      await api.saveCustomerRecord(c.id, { notes: notesDraft });
      setEditingNotes(false);
      await rec.reload();
      onChanged?.();
      toast('Đã lưu ghi chú khách hàng');
    } catch (e: any) { toast(e.message, true); } finally { setSavingNotes(false); }
  };
  return <div className="crm-overview crm-overview-primary">
      <section className="crm-ov-card">
        <header><h3>Tiến độ công việc</h3><button className="btn btn-gray btn-sm" onClick={()=>onTab('tasks')}>Xem công việc</button></header>
        <div className="crm-ov-stats">
          <button onClick={() => onTab('campaigns')}><b>{c.projects || 0}</b><span>Dự án</span></button>
          <button onClick={() => onTab('tasks')}><b>{c.completed || 0}/{c.tasks || 0}</b><span>Công việc xong</span></button>
        </div>
        <progress aria-label="Tiến độ hoàn thành công việc" max={c.tasks || 1} value={c.completed || 0} />
        {(view !== 'list' || taskRows.length > 0) && (
          <div className="crm-ov-tasks">
            {!tasks.data && !tasks.error ? <BrandLoading compact /> : taskRows.length > 0 ? <CustomerTaskViews rows={view === 'list' ? taskRows.slice(0, 5) : taskRows} view={view} /> : <p className="note">Chưa có công việc nào của khách hàng này.</p>}
          </div>
        )}
      </section>
      <section className="crm-ov-card wide">
        <header>
          <h3>Ghi chú khách hàng</h3>
          {c.canManage && r && !editingNotes && <button className="btn btn-gray btn-sm" onClick={() => { setNotesDraft(r.notes || ''); setEditingNotes(true); }}><Icon name="edit" size={13} />{r.notes ? 'Sửa' : 'Thêm ghi chú'}</button>}
        </header>
        {rec.error ? <p className="note err" role="alert">{rec.error}</p>
          : !r ? <BrandLoading compact />
          : editingNotes ? (
            <div className="ax-form">
              <textarea className="bk-in" rows={5} maxLength={20000} autoFocus value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Ghi chú, thông tin thêm về khách hàng…" />
              <div className="tk-action-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={savingNotes} onClick={() => void saveNotes()}>{savingNotes ? 'Đang lưu…' : 'Lưu'}</button>
                <button type="button" className="btn btn-gray btn-sm" disabled={savingNotes} onClick={() => setEditingNotes(false)}>Huỷ</button>
              </div>
            </div>
          ) : r.notes ? (
            <div className="crm-ov-notes" style={c.canManage ? { cursor: 'pointer' } : undefined} title={c.canManage ? 'Bấm để chỉnh sửa ghi chú' : undefined} onClick={(e) => { if (c.canManage && !(e.target as HTMLElement).closest('a,button')) { setNotesDraft(r.notes || ''); setEditingNotes(true); } }}><Rich text={r.notes} /></div>
          ) : (
            <p className="note" style={c.canManage ? { cursor: 'pointer' } : undefined} onClick={() => { if (c.canManage) { setNotesDraft(''); setEditingNotes(true); } }}>{c.canManage ? 'Chưa có ghi chú. Bấm vào đây để thêm ghi chú…' : 'Chưa có ghi chú.'}</p>
          )}
      </section>
  </div>;
}

export function CustomerContext({c,onTab,onChanged}:{c:CustomerRecord;onTab:(tab:string)=>void;onChanged?:()=>void}) {
  const rec=useData(()=>api.customerRecord(c.id),[c]);
  const membersLoad=useData<CustomerMembersData>(()=>api.customerMembers(c.id),[c.id]);
  const r=rec.data,drive=r?.drive,d=membersLoad.data,mayDrive=useStore(s=>s.pages).includes('workspace');
  const contact = (r?.contact ?? c.contact) || '';
  const phone = (r?.phone ?? c.phone) || '';
  const email = (r?.email ?? c.email) || '';
  const manager = r?.manager || c.manager || r?.owner || c.owner || null;
  const owner = r?.owner || c.owner || null;
  const tags = r?.tags?.length ? r.tags : c.tags?.length ? c.tags : (r?.category ?? c.category) ? [(r?.category ?? c.category)!] : [];
  const source = r?.source ?? c.source;
  const needs = r?.needs?.length ? r.needs : c.needs;

  const [editContact, setEditContact] = useState(false);
  const [contactForm, setContactForm] = useState({ contact: '', phone: '', email: '', managerId: '' });
  const [managers, setManagers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [savingContact, setSavingContact] = useState(false);

  const [editMeta, setEditMeta] = useState(false);
  const [metaTags, setMetaTags] = useState<(CustomerTag | { id?: undefined; name: string; color?: undefined })[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [metaSourceId, setMetaSourceId] = useState('');
  const [metaNeeds, setMetaNeeds] = useState<string[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; color: string; active: number }[]>([]);
  const [sources, setSources] = useState<{ id: string; name: string; color: string; active: number }[]>([]);
  const [catalog, setCatalog] = useState<ServiceRef[]>([]);
  const [savingMeta, setSavingMeta] = useState(false);

  const [memberAnchor, setMemberAnchor] = useState<HTMLElement | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);

  useEffect(() => { setEditContact(false); setEditMeta(false); setMemberAnchor(null); }, [c.id]);

  const startEditContact = () => {
    if (!c.canManage) return;
    setContactForm({ contact, phone, email, managerId: manager?.id || '' });
    if (!managers.length) api.customerManagers().then(setManagers).catch(() => {});
    setEditContact(true);
  };
  const saveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingContact) return;
    setSavingContact(true);
    try {
      await api.saveCustomerRecord(c.id, {
        contact: contactForm.contact.trim(),
        phone: contactForm.phone.trim(),
        email: contactForm.email.trim(),
        managerId: contactForm.managerId || null,
      });
      setEditContact(false);
      await rec.reload();
      onChanged?.();
      toast('Đã cập nhật thông tin liên hệ');
    } catch (err: any) { toast(err.message, true); } finally { setSavingContact(false); }
  };

  const startEditMeta = () => {
    if (!c.canManage) return;
    setMetaTags(tags);
    setTagInput('');
    setMetaSourceId(source?.id || '');
    setMetaNeeds((needs || []).map((n) => n.id));
    if (!categories.length) api.customerClassifications().then(setCategories).catch(() => {});
    if (!sources.length) api.customerSources().then(setSources).catch(() => {});
    if (!catalog.length) api.serviceCatalog().then(setCatalog).catch(() => {});
    setEditMeta(true);
  };
  const addMetaTag = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, ' ');
    setTagInput('');
    if (!name || metaTags.some((t) => t.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) return;
    const known = categories.find((cat) => cat.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'));
    setMetaTags([...metaTags, known ? { id: known.id, name: known.name, color: known.color } : { name }]);
  };
  const saveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingMeta) return;
    setSavingMeta(true);
    try {
      const nextTags = tagInput.trim() ? [...metaTags, { name: tagInput.trim() }] : metaTags;
      await api.saveCustomerRecord(c.id, {
        tags: nextTags.map((t) => (t.id ? { id: t.id } : { name: t.name })),
        sourceId: metaSourceId || null,
        needs: metaNeeds,
      });
      setEditMeta(false);
      await rec.reload();
      onChanged?.();
      toast('Đã cập nhật Tag, nguồn và nhu cầu');
    } catch (err: any) { toast(err.message, true); } finally { setSavingMeta(false); }
  };

  const ownerPerson = d ? (d.members.find((m) => m.id === d.ownerId) || d.people.find((p) => p.id === d.ownerId)) : null;
  const memberRows = d ? [
    ...(d.ownerId ? [{ id: d.ownerId, name: ownerPerson?.name || owner?.name || 'Chủ khách hàng', email: ownerPerson?.email || '', isOwner: true }] : []),
    ...d.members.filter((m) => m.id !== d.ownerId).map((m) => ({ ...m, isOwner: false })),
  ] : [];
  const canEditMembers = d?.level === 'admin' || !!c.canManage;
  const allPeople = d ? [...new Map([...d.members, ...d.people].map((p) => [p.id, p])).values()] : [];
  const toggleMember = async (userId: string) => {
    if (memberBusy || !d || userId === d.ownerId) return;
    setMemberBusy(true);
    try {
      const exists = d.members.some((m) => m.id === userId);
      if (exists) await api.removeCustomerMember(c.id, userId);
      else await api.setCustomerMember(c.id, userId, 'normal');
      await membersLoad.reload();
      onChanged?.();
    } catch (err: any) { toast(err.message, true); } finally { setMemberBusy(false); }
  };

  return <aside className="crm-context" aria-label="Thông tin khách hàng">
      <section className="crm-ov-card">
        <header>
          <h3>Liên hệ</h3>
          {c.canManage && !editContact && <button type="button" className="btn btn-gray btn-sm" onClick={startEditContact}><Icon name="edit" size={13} />Sửa</button>}
        </header>
        {editContact ? (
          <form className="ax-form" onSubmit={saveContact}>
            <label className="tm-field"><span>Người liên hệ</span><input className="bk-in" autoFocus maxLength={200} value={contactForm.contact} onChange={(e) => setContactForm({ ...contactForm, contact: e.target.value })} /></label>
            <label className="tm-field"><span>Điện thoại</span><input className="bk-in" type="tel" maxLength={60} value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} /></label>
            <label className="tm-field"><span>Email</span><input className="bk-in" type="email" maxLength={320} value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} /></label>
            <label className="tm-field"><span>Phụ trách</span><select className="bk-in" value={contactForm.managerId} onChange={(e) => setContactForm({ ...contactForm, managerId: e.target.value })}><option value="">Chưa chọn</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <div className="tk-action-row" style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingContact}>{savingContact ? 'Đang lưu…' : 'Lưu'}</button>
              <button type="button" className="btn btn-gray btn-sm" disabled={savingContact} onClick={() => setEditContact(false)}>Huỷ</button>
            </div>
          </form>
        ) : (
          <dl className="crm-facts" style={c.canManage ? { cursor: 'pointer' } : undefined} title={c.canManage ? 'Bấm để chỉnh sửa trực tiếp' : undefined} onClick={(e) => { if (c.canManage && !(e.target as HTMLElement).closest('a,button')) startEditContact(); }}>
            <dt>Người liên hệ</dt><dd>{contact || '—'}</dd>
            <dt>Điện thoại</dt><dd>{phone ? <a href={'tel:' + phone.replace(/[^+\d]/g, '')}>{phone}</a> : '—'}</dd>
            <dt>Email</dt><dd>{email ? <a href={'mailto:' + email}>{email}</a> : '—'}</dd>
            <dt>Phụ trách</dt><dd>{manager?.name || '—'}</dd>
            {owner && owner.id !== manager?.id && <><dt>Chủ sở hữu</dt><dd>{owner.name}</dd></>}
          </dl>
        )}
      </section>
      <section className="crm-ov-card">
        <header>
          <h3>Tag & nguồn</h3>
          {c.canManage && !editMeta && <button type="button" className="btn btn-gray btn-sm" onClick={startEditMeta}><Icon name="edit" size={13} />Sửa</button>}
        </header>
        {editMeta ? (
          <form className="ax-form" onSubmit={saveMeta}>
            <div className="tm-field crm-tags">
              <span>Tag</span>
              <div className="crm-tag-box">
                {metaTags.map((t) => <span key={t.id || 'new:' + t.name} className="crm-tag" style={{ ['--c' as any]: t.color || '#64748b' }}>{t.name}<button type="button" onClick={() => setMetaTags(metaTags.filter((x) => x !== t))} aria-label={`Bỏ tag ${t.name}`}><Icon name="x" size={11} /></button></span>)}
                <input list="crm-inline-tag-list" value={tagInput} maxLength={40} onChange={(e) => setTagInput(e.target.value)} onBlur={() => addMetaTag(tagInput)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addMetaTag(tagInput); } }} placeholder="Thêm tag…" />
                <datalist id="crm-inline-tag-list">{categories.filter((cat) => cat.active && !metaTags.some((t) => t.id === cat.id)).map((cat) => <option key={cat.id} value={cat.name} />)}</datalist>
              </div>
            </div>
            <label className="tm-field"><span>Nguồn</span><select className="bk-in" value={metaSourceId} onChange={(e) => setMetaSourceId(e.target.value)}><option value="">Chưa rõ nguồn</option>{sources.filter((s) => s.active || s.id === metaSourceId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <div className="tm-field crm-needs">
              <span>Nhu cầu</span>
              {metaNeeds.length > 0 && <div className="crm-need-chips">{metaNeeds.map((nid) => { const s = catalog.find((x) => x.id === nid) || needs?.find((x) => x.id === nid); return <span key={nid} className="crm-need-chip">{s?.name || 'Dịch vụ'}<button type="button" onClick={() => setMetaNeeds(metaNeeds.filter((x) => x !== nid))}><Icon name="x" size={12} /></button></span>; })}</div>}
              {catalog.some((s) => !metaNeeds.includes(s.id)) && <select className="bk-in" value="" onChange={(e) => { if (e.target.value) setMetaNeeds([...metaNeeds, e.target.value]); }}><option value="">Thêm dịch vụ…</option>{catalog.filter((s) => !metaNeeds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
            </div>
            <div className="tk-action-row" style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingMeta}>{savingMeta ? 'Đang lưu…' : 'Lưu'}</button>
              <button type="button" className="btn btn-gray btn-sm" disabled={savingMeta} onClick={() => setEditMeta(false)}>Huỷ</button>
            </div>
          </form>
        ) : (
          <dl className="crm-facts" style={c.canManage ? { cursor: 'pointer' } : undefined} title={c.canManage ? 'Bấm để chỉnh sửa trực tiếp' : undefined} onClick={(e) => { if (c.canManage && !(e.target as HTMLElement).closest('a,button')) startEditMeta(); }}>
            <dt>Tag</dt><dd>{tags.length ? <span className="crm-tag-list">{tags.map((t) => <span key={t.id} className="crm-pill" style={{ ['--c' as any]: t.color }}>{t.name}</span>)}</span> : '—'}</dd>
            <dt>Nguồn</dt><dd>{source ? <span className="crm-pill" style={{ ['--c' as any]: source.color }}>{source.name}</span> : '—'}</dd>
            <dt>Nhu cầu</dt><dd>{needs?.length ? <span className="crm-need-chips">{needs.map((n) => <span key={n.id} className="crm-need-chip plain">{n.name}</span>)}</span> : '—'}</dd>
          </dl>
        )}
      </section>
      <section className="crm-ov-card">
        <header><h3>Drive</h3>{mayDrive && <button className="btn btn-gray btn-sm" onClick={() => onTab('drive')}><Icon name="folder" size={13} />Mở Drive</button>}</header>
        {rec.error ? <p className="note err" role="alert">{rec.error}</p> : !r ? <BrandLoading compact /> : drive ? <p className="crm-ov-drive"><Icon name="folder" size={16} /><b>{drive.label}</b>{drive.url && <a href={drive.url} target="_blank" rel="noreferrer">Mở trên Google Drive ↗</a>}</p> : <p className="note">Chưa liên kết thư mục Drive.{mayDrive && ' Liên kết ở tab Drive hoặc trong Sửa thông tin.'}</p>}
      </section>
      <section className="crm-ov-card" aria-label="Thành viên khách hàng">
        <header>
          <h3><Icon name="users" size={15} /> Thành viên {memberRows.length > 0 && <small>({memberRows.length})</small>}</h3>
          <button type="button" className="btn btn-gray btn-sm" onClick={() => onTab('members')}>Chi tiết</button>
        </header>
        {!d && !membersLoad.error ? <BrandLoading compact /> : (
          <div className="employee-picker-summary" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {memberRows.map((m) => (
              <MemberAvatar
                key={m.id}
                person={m}
                size={32}
                onRemove={canEditMembers && !m.isOwner ? () => void toggleMember(m.id) : undefined}
              />
            ))}
            {canEditMembers && d && (
              <button
                type="button"
                className="employee-picker-add"
                aria-label="Thêm hoặc gỡ thành viên khách hàng"
                aria-haspopup="dialog"
                aria-expanded={!!memberAnchor}
                disabled={memberBusy}
                onClick={(e) => setMemberAnchor(memberAnchor ? null : e.currentTarget)}
              >
                <Icon name="plus" size={20} />
              </button>
            )}
            {!memberRows.length && <span className="note">Chưa có thành viên.</span>}
          </div>
        )}
        {memberAnchor && d && createPortal(
          <Pop anchor={memberAnchor} title="Thành viên khách hàng" onClose={() => setMemberAnchor(null)}>
            <MemberChoices
              people={allPeople}
              selected={memberRows.map((m) => m.id)}
              onToggle={(id) => void toggleMember(id)}
            />
          </Pop>,
          document.body
        )}
      </section>
    <section className="crm-context-links"><button onClick={()=>onTab('history')}><Icon name="clock" size={15}/>Lịch sử thay đổi<Icon name="right" size={13}/></button></section>
  </aside>;
}

// ---------------------------------------------------------------- tasks of the customer's projects
export function CustomerTasks({ id, view = 'list' }: { id: string; view?: CustomerView }) {
  const load = useData(() => api.customerTaskList(id), [id]);
  const [show, setShow] = useState<'open' | 'done' | 'all'>('open'), [q, setQ] = useState('');
  const rows = (load.data || []).filter((t) => (view === 'kanban' || show === 'all' || (show === 'done' ? ['done', 'done_late'].includes(t.category) : !['done', 'done_late', 'cancelled'].includes(t.category))) && (!q || `${t.title} ${t.project?.name} ${t.assignees.map((a) => a.name).join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <section className="crm-tab-pane">
      {view !== 'kanban' && <ReadingTabs label="Trạng thái công việc" value={show} items={[{ value: 'open' as const, label: 'Đang làm', icon: 'play' }, { value: 'done' as const, label: 'Đã xong', icon: 'check' }, { value: 'all' as const, label: 'Tất cả', icon: 'checklist' }]} onChange={setShow} />}
      <div className="tk-toolbar">
        <label className="tk-find"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm công việc, dự án, người làm…" aria-label="Tìm công việc" /></label>
      </div>
      {!load.data && !load.error ? <BrandLoading compact /> : <State error={load.error} icon="checklist" empty={rows.length ? '' : show === 'open' && view !== 'kanban' ? 'Không có công việc đang làm.' : 'Chưa có công việc nào.'}>
        <CustomerTaskViews rows={rows} view={view} />
      </State>}
    </section>
  );
}

// ---------------------------------------------------------------- members
export function CustomerMembersTab({ id, onManage }: { id: string; onManage: () => void }) {
  const load = useData<CustomerMembersData>(() => api.customerMembers(id), [id]);
  const d = load.data;
  const ownerPerson = d ? (d.members.find((m) => m.id === d.ownerId) || d.people.find((p) => p.id === d.ownerId)) : null;
  const rows = d ? [
    ...(d.ownerId ? [{ id: d.ownerId, name: ownerPerson?.name || 'Chủ khách hàng', email: ownerPerson?.email || '', level: 'owner' }] : []),
    ...d.members.filter((m) => m.id !== d.ownerId),
  ] : [];
  return (
    <section className="crm-tab-pane">
      <div className="crm-tab-tools"><p className="note">Chỉ chủ khách hàng, trưởng phòng của chủ và người được thêm mới xem được khách hàng này.</p><button className="btn btn-gray btn-sm" onClick={onManage}><Icon name="users" size={13} />Quản lý thành viên</button></div>
      {!d && !load.error ? <BrandLoading compact /> : <State error={load.error} empty={rows.length ? '' : 'Chưa có thành viên nào.'}>
        <ul className="crm-members">{rows.map((m) => (
          <li key={m.id}><Avatar m={m} size={32} /><span><b>{m.name}</b><small>{m.email}</small></span><em>{m.level === 'owner' ? 'Chủ' : LEVEL[m.level] || m.level}</em></li>
        ))}</ul>
      </State>}
    </section>
  );
}

// ---------------------------------------------------------------- history
const FIELD: Record<string, string> = { name: 'Tên', contact: 'Người liên hệ', phone: 'Điện thoại', email: 'Email', folder: 'Thư mục Drive', notes: 'Khác', status: 'Trạng thái', category: 'Phân loại', category_id: 'Phân loại', source: 'Nguồn', source_id: 'Nguồn', manager: 'Phụ trách', manager_id: 'Phụ trách', archived: 'Lưu trữ', archived_at: 'Lưu trữ', interaction: 'Tương tác' };
const val = (v: unknown) => (v === null || v === undefined || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
export function CustomerHistory({ id }: { id: string }) {
  const load = useData<RecordChange[]>(() => api.customerHistory(id), [id]);
  return (
    <section className="crm-tab-pane">
      {!load.data && !load.error ? <BrandLoading compact /> : <State error={load.error} icon="clock" empty={load.data?.length ? '' : 'Chưa có thay đổi nào được ghi lại (lịch sử bắt đầu từ khi có module quản trị).'}>
        <ol className="crm-history">{(load.data || []).map((h, i) => (
          <li key={i}><div><b>{h.action}</b><small>{h.by || 'Hệ thống'} · {time(h.at)}</small></div>
            <dl>{Object.keys({ ...(h.before || {}), ...(h.after || {}) }).map((k) => <div key={k}><dt>{FIELD[k] || k}</dt><dd>{h.before && <del>{val(h.before[k])}</del>}{h.before && h.after && ' → '}{h.after && <ins>{val(h.after[k])}</ins>}</dd></div>)}</dl></li>
        ))}</ol>
      </State>}
    </section>
  );
}
