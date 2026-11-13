// Thông báo: what was sent from Quản trị and who has read it, writing a new one (to people, departments, teams or
// everyone the sender's scope reaches), templates, and the email delivery log.
import { useState } from 'react';
import { useStore, toast } from '../../store';
import { Icon } from '../../components/ui';
import { admin, type NotifTemplate, type Sent as SentRow } from '../api';
import { goAdmin } from '../nav';
import { PageHead, Toolbar, Select, Table, Pager, Drawer, Field, Badge, Async, Empty, ErrorState, Loading, useLoad, useDebounced, useCan, useScope, act, fmtTime, fmtNum, fold, type Col } from '../kit';
import { SCOPE_LABEL } from '../../../../shared/permissions';
import { askConfirm } from '../../components/AskDialog';

export function Sent() {
  const can = useCan();
  const [q, setQ] = useState(''), [page, setPage] = useState(1), [open, setOpen] = useState<string | null>(null);
  const term = useDebounced(q);
  const load = useLoad(() => admin.sent({ q: term, page, size: 25, sort: 'at' }), [term, page]);
  const cols: Col<SentRow>[] = [
    { key: 'title', label: 'Thông báo', render: (n) => <span className="ax-stack"><b>{n.title}</b><small className="ax-clamp">{n.body || '—'}</small></span> },
    { key: 'audience', label: 'Gửi tới', render: (n) => <span className="ax-clamp">{n.audience}</span>, hideSm: true },
    { key: 'read', label: 'Đã đọc', align: 'right', render: (n) => <span className="ax-read"><b>{fmtNum(n.read)}</b>/{fmtNum(n.recipients)}<span><i style={{ width: `${n.recipients ? (n.read / n.recipients) * 100 : 0}%` }} /></span></span> },
    { key: 'emailed', label: 'Email', align: 'right', render: (n) => fmtNum(n.emailed), hideSm: true },
    { key: 'at', label: 'Gửi lúc', render: (n) => <span className="ax-stack"><span>{fmtTime(n.at)}</span><small>{n.sentBy || '—'}</small></span> },
  ];
  return (
    <>
      <PageHead title="Thông báo đã gửi" sub="Thông báo gửi từ Quản trị hiện ở chuông thông báo của người nhận (và email nếu họ bật). Số đã đọc cập nhật khi người nhận mở."
        actions={can('notifications.create') && <button className="btn btn-primary btn-sm" onClick={() => goAdmin('notify', 'create')}><Icon name="plus" size={14} />Tạo thông báo</button>} />
      <Toolbar search={q} onSearch={(v) => { setQ(v); setPage(1); }} placeholder="Tìm tiêu đề, nội dung…" />
      <div className="ax-card flush"><Async load={load}>{(d) => <>
        <Table cols={cols} rows={d.items} onRow={(n) => setOpen(n.id)} empty={<Empty icon="bell" title="Chưa gửi thông báo nào" />} />
        <Pager page={d.page} size={d.size} total={d.total} onPage={setPage} />
      </>}</Async></div>
      {open && <SentDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
function SentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const load = useLoad(() => admin.sentOne(id), [id]);
  const n = load.data;
  return (
    <Drawer open title={n?.title || 'Thông báo'} sub={n ? `${n.sentBy || '—'} · ${fmtTime(n.at)}` : undefined} onClose={onClose}>
      {load.error ? <ErrorState error={load.error} onRetry={load.reload} /> : !n ? <Loading /> : <>
        <dl className="ax-facts"><dt>Nội dung</dt><dd className="ax-pre">{n.body || '—'}</dd><dt>Liên kết</dt><dd className="mono">{n.link || '—'}</dd><dt>Gửi tới</dt><dd>{n.audience}</dd><dt>Đã đọc</dt><dd>{n.people.filter((p) => p.readAt).length}/{n.recipients}</dd><dt>Gửi email</dt><dd>{n.emailed} người</dd></dl>
        <ul className="ax-list">{n.people.map((p) => <li key={p.id}><span><b>{p.name}</b><small>{p.email}</small></span>{p.readAt ? <Badge tone="ok">Đã đọc {fmtTime(p.readAt)}</Badge> : <Badge tone="muted">Chưa đọc</Badge>}</li>)}</ul>
      </>}
    </Drawer>
  );
}

export function Compose() {
  const scope = useScope('notifications.create'), departments = useStore((s) => s.roles), can = useCan();
  const people = useLoad(() => admin.staff({ size: 200, status: 'active' }).catch(() => null), []);
  const teams = useLoad(() => (can('org.view') ? admin.teams() : Promise.resolve([])), []);
  const templates = useLoad(() => admin.notifTemplates(), []);
  const [f, setF] = useState({ title: '', body: '', link: '', templateId: '' }), [type, setType] = useState('users'), [ids, setIds] = useState<string[]>([]), [q, setQ] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false);
  const options = type === 'users' ? (people.data?.items || []).map((p) => ({ id: p.id, name: p.name, sub: p.email })) : type === 'departments' ? departments.map((d) => ({ id: d.id, name: d.name, sub: `${d.members} người` })) : type === 'teams' ? (teams.data || []).map((t) => ({ id: t.id, name: t.name, sub: `${t.members.length} người` })) : [];
  const useTemplate = (id: string) => { const t = templates.data?.find((x) => x.id === id); setF(t ? { title: t.title, body: t.body, link: t.link, templateId: t.id } : { ...f, templateId: '' }); };
  const send = async () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = 'Hãy nhập tiêu đề';
    if (f.link && !/^#[A-Za-z0-9/_\-?=&.%]+$/.test(f.link)) e.link = 'Liên kết phải là địa chỉ trong ứng dụng, bắt đầu bằng # (vd. #tasks)';
    if (type !== 'all' && !ids.length) e.to = 'Hãy chọn người nhận';
    setErrors(e); if (Object.keys(e).length) return;
    if (type === 'all' && !await askConfirm('Gửi thông báo tới toàn bộ nhân viên đang hoạt động?')) return;
    setBusy(true);
    try { const r = await admin.send({ ...f, audience: { type, ids } }); toast(`Đã gửi tới ${r.recipients} người${r.emailed ? `, ${r.emailed} email` : ''}`); setF({ title: '', body: '', link: '', templateId: '' }); setIds([]); goAdmin('notify', 'list'); }
    catch (x: any) { toast(x.message, true); } finally { setBusy(false); }
  };
  const shown = options.filter((o) => !q.trim() || fold(`${o.name} ${o.sub}`).includes(fold(q.trim())));
  return (
    <>
      <PageHead title="Tạo thông báo" sub={<>Phạm vi gửi của bạn: <b>{scope ? SCOPE_LABEL[scope] : '—'}</b>. Người nhận nằm ngoài phạm vi sẽ bị từ chối.</>} />
      <div className="ax-compose">
        <section className="ax-card ax-form">
          {!!templates.data?.length && <Field label="Dùng mẫu"><select className="bk-in" value={f.templateId} onChange={(e) => useTemplate(e.target.value)}><option value="">Không dùng mẫu</option>{templates.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
          <Field label="Tiêu đề *" error={errors.title}><input className="bk-in" value={f.title} maxLength={150} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Nội dung"><textarea className="bk-in" rows={5} maxLength={2000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <Field label="Liên kết trong ứng dụng" error={errors.link} hint="Tuỳ chọn. Người nhận bấm thông báo sẽ mở địa chỉ này, vd. #tasks hoặc #boards."><input className="bk-in" value={f.link} maxLength={300} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="#tasks" /></Field>
        </section>
        <section className="ax-card ax-form">
          <Field label="Gửi tới" error={errors.to}><select className="bk-in" value={type} onChange={(e) => { setType(e.target.value); setIds([]); }}>
            <option value="users">Cá nhân</option><option value="departments">Phòng ban</option>{!!teams.data?.length && <option value="teams">Nhóm</option>}{scope === 'organization' && <option value="all">Toàn hệ thống</option>}
          </select></Field>
          {type === 'all' ? <p className="note">Mọi nhân viên đang hoạt động (trừ bạn) sẽ nhận thông báo.</p> : <>
            <input className="bk-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm…" aria-label="Tìm người nhận" />
            <ul className="ax-pick tall">{shown.map((o) => <li key={o.id} className={ids.includes(o.id) ? 'on' : ''}><label><input type="checkbox" checked={ids.includes(o.id)} onChange={(e) => setIds(e.target.checked ? [...ids, o.id] : ids.filter((x) => x !== o.id))} /><span>{o.name}</span><small>{o.sub}</small></label></li>)}</ul>
            <small className="note">Đã chọn {ids.length}</small>
          </>}
          <button className="btn btn-primary" disabled={busy} onClick={send}><Icon name="send" size={14} />{busy ? 'Đang gửi…' : 'Gửi thông báo'}</button>
        </section>
      </div>
    </>
  );
}

export function Templates() {
  const can = useCan();
  const load = useLoad(() => admin.notifTemplates(), []);
  const [edit, setEdit] = useState<NotifTemplate | 'new' | null>(null);
  return (
    <>
      <PageHead title="Mẫu thông báo" sub="Nội dung soạn sẵn để gửi nhanh ở trang Tạo thông báo." actions={can('notifications.manage') && <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><Icon name="plus" size={14} />Tạo mẫu</button>} />
      <div className="ax-card flush"><Async load={load}>{(rows) => <Table rows={rows} onRow={(t) => setEdit(t)} empty={<Empty icon="mail" title="Chưa có mẫu thông báo" />} cols={[
        { key: 'name', label: 'Mẫu', render: (t) => <span className="ax-stack"><b>{t.name}</b><small>{t.title}</small></span> },
        { key: 'body', label: 'Nội dung', render: (t) => <span className="ax-clamp">{t.body || '—'}</span>, hideSm: true },
        { key: 'updated', label: 'Cập nhật', render: (t) => <small>{t.updatedBy || '—'} · {fmtTime(t.updatedAt)}</small>, hideSm: true },
      ]} />}</Async></div>
      {edit && <TemplateForm tpl={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load.reload(); }} />}
    </>
  );
}
function TemplateForm({ tpl, onClose, onSaved }: { tpl: NotifTemplate | null; onClose: () => void; onSaved: () => void }) {
  const can = useCan(), editable = can('notifications.manage');
  const [f, setF] = useState({ name: tpl?.name || '', title: tpl?.title || '', body: tpl?.body || '', link: tpl?.link || '' }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    if (!f.name.trim() || !f.title.trim()) return setError('Hãy nhập tên mẫu và tiêu đề');
    if (f.link && !/^#[A-Za-z0-9/_\-?=&.%]+$/.test(f.link)) return setError('Liên kết phải bắt đầu bằng #');
    setBusy(true); setError('');
    try { await admin.saveNotifTemplate(tpl?.id || null, f); toast('Đã lưu mẫu'); onSaved(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer open title={tpl ? tpl.name : 'Tạo mẫu thông báo'} onClose={onClose} footer={<>
      {tpl && editable && <button className="btn btn-gray btn-sm" onClick={async () => await askConfirm(`Xoá mẫu “${tpl.name}”?`) && act(() => admin.removeNotifTemplate(tpl.id), 'Đã xoá mẫu', onSaved)}><Icon name="trash" size={14} />Xoá</button>}
      <button className="btn btn-gray btn-sm" onClick={onClose}>Đóng</button>{editable && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>}
    </>}>
      <fieldset className="ax-form" disabled={!editable}>
        {error && <p className="note err" role="alert">{error}</p>}
        <Field label="Tên mẫu *"><input className="bk-in" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Tiêu đề *"><input className="bk-in" value={f.title} maxLength={150} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Nội dung"><textarea className="bk-in" rows={5} maxLength={2000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="Liên kết"><input className="bk-in" value={f.link} maxLength={300} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="#tasks" /></Field>
      </fieldset>
    </Drawer>
  );
}

const MAIL: Record<string, [string, 'ok' | 'bad' | 'muted' | 'warn']> = { sent: ['Đã gửi', 'ok'], pending: ['Đang chờ', 'warn'], failed: ['Lỗi', 'bad'], cancelled: ['Đã huỷ', 'muted'] };
export function MailLog() {
  const [q, setQ] = useState(''), [state, setState] = useState(''), [page, setPage] = useState(1);
  const term = useDebounced(q);
  const load = useLoad(() => admin.mailLog({ q: term, state, page, size: 30 }), [term, state, page]);
  return (
    <>
      <PageHead title="Lịch sử gửi email" sub="Mọi email thông báo hệ thống gửi (giao việc, cập nhật, thông báo từ Quản trị…) tới người trong phạm vi của bạn." />
      <Toolbar search={q} onSearch={(v) => { setQ(v); setPage(1); }} placeholder="Tìm người nhận, tiêu đề, lỗi…"><Select value={state} onChange={(v) => { setState(v); setPage(1); }} label="Trạng thái"><option value="">Mọi trạng thái</option>{Object.entries(MAIL).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</Select></Toolbar>
      <div className="ax-card flush"><Async load={load}>{(d) => <>
        {!d.sender && <p className="ax-card-note">Chưa kết nối tài khoản Gmail gửi thông báo: email đang chờ sẽ được gửi khi kết nối (Cấu hình thông báo).</p>}
        <div className="ax-kpis small inset">{Object.entries(MAIL).map(([k, [v]]) => <div key={k} className="ax-mini"><small>{v}</small><b>{fmtNum(d.counts[k] || 0)}</b></div>)}</div>
        <Table rows={d.items} empty={<Empty icon="mail" title="Chưa có email nào" />} cols={[
          { key: 'at', label: 'Thời gian', render: (m) => fmtTime(m.at) },
          { key: 'to', label: 'Người nhận', render: (m) => m.to || '—' },
          { key: 'title', label: 'Tiêu đề', render: (m) => <span className="ax-stack"><span>{m.title}</span>{m.error && <small className="ax-bad">{m.error}</small>}</span> },
          { key: 'state', label: 'Trạng thái', render: (m) => <Badge tone={MAIL[m.state]?.[1]}>{MAIL[m.state]?.[0] || m.state}</Badge> },
          { key: 'attempts', label: 'Lần thử', align: 'right', render: (m) => m.attempts, hideSm: true },
        ]} />
        <Pager page={d.page} size={d.size} total={d.total} onPage={setPage} />
      </>}</Async></div>
    </>
  );
}
