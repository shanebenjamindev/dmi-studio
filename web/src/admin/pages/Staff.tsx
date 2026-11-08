// Nhân viên: the staff list (search, filters, sorting, pages) with each person's profile, work, sign-ins and history in a
// drawer; Admin accounts; departments; positions; teams.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { setState, toast, useStore } from '../../store';
import { Icon } from '../../components/ui';
import { DepartmentsCard, StaffChart } from '../../components/Users';
import { admin, download, type Staff, type StaffDetail, type Team, type Role } from '../api';
import { ADMIN_RANK, SCOPES, SCOPE_LABEL, type Scope } from '../../../../shared/permissions';
import { routeParam, setRouteParam, goAdmin } from '../nav';
import {
  PageHead, Toolbar, Select, Table, Pager, Drawer, Field, Section, Badge, ScopeBadge, Person, ChangeList, Async, Empty, ErrorState, Loading,
  useLoad, useListState, useDebounced, useCan, act, fmtAgo, fmtTime, fmtDate, fmtNum, fold, type Col,
} from '../kit';

const LEVEL: Record<string, string> = { admin: 'Quản lý phòng', normal: 'Thành viên', observer: 'Chỉ xem' };
const STATE_LABEL: Record<string, string> = { todo: 'Chưa làm', doing: 'Đang làm', review: 'Đang đánh giá', paused: 'Tạm dừng', overdue: 'Quá hạn', done: 'Hoàn thành', done_late: 'Hoàn thành muộn', cancelled: 'Đã huỷ', other: 'Khác' };
export const StatusBadge = ({ s }: { s: Pick<Staff, 'disabled' | 'lastLogin'> }) => (s.disabled ? <Badge tone="bad">Đã khoá</Badge> : s.lastLogin ? <Badge tone="ok">Hoạt động</Badge> : <Badge tone="muted">Chưa đăng nhập</Badge>);
export const RoleBadges = ({ s }: { s: Pick<Staff, 'roles'> }) => <span className="ax-badges">{s.roles.length ? s.roles.map((r) => <Badge key={r.id} tone={r.rank >= ADMIN_RANK ? 'accent' : undefined}>{r.name}{r.scope ? ` · ${SCOPE_LABEL[r.scope]}` : ''}</Badge>) : <Badge tone="muted">Member</Badge>}</span>;
const who = (s: Staff) => <span className="ax-person"><Person p={s} size={30} /><span><b>{s.name}</b><small>{s.email}</small></span></span>;

// ---------------------------------------------------------------- list
export function StaffList() {
  const can = useCan(), departments = useStore((s) => s.roles);
  const [q, setQ] = useState(''), [dept, setDept] = useState(''), [team, setTeam] = useState(''), [status, setStatus] = useState('all'), [role, setRole] = useState('');
  const L = useListState('name'), term = useDebounced(q);
  const params = { q: term, dept, team, status, role, sort: L.sort, dir: L.dir, page: L.page, size: 25 };
  const load = useLoad(() => admin.staff(params), [JSON.stringify(params)]);
  const roles = useLoad(() => (can('rbac.view') ? admin.roles() : Promise.resolve([] as Role[])), []);
  const teams = useLoad(() => (can('org.view') ? admin.teams() : Promise.resolve([] as Team[])), []);
  const [open, setOpen] = useState<string | null>(() => routeParam('id'));
  useEffect(() => { L.setPage(1); }, [term, dept, team, status, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = (id: string | null) => { setOpen(id); setRouteParam('id', id); };
  const cols: Col<Staff>[] = [
    { key: 'name', label: 'Nhân viên', sort: true, render: who },
    { key: 'department', label: 'Phòng ban · Chức vụ', sort: true, render: (s) => s.department ? <span className="ax-stack"><Badge color={s.department.color}>{s.department.name}</Badge><small>{s.position?.name || 'Chưa có chức vụ'}</small></span> : <span className="ax-muted">Chưa có phòng ban</span> },
    { key: 'teams', label: 'Nhóm', render: (s) => s.teams.length ? <span className="ax-badges">{s.teams.map((t) => <Badge key={t.id} color={t.color}>{t.name}{t.leader ? ' ★' : ''}</Badge>)}</span> : <span className="ax-muted">—</span>, hideSm: true },
    { key: 'roles', label: 'Vai trò', render: (s) => <RoleBadges s={s} />, hideSm: true },
    { key: 'status', label: 'Trạng thái', render: (s) => <StatusBadge s={s} /> },
    { key: 'lastLogin', label: 'Đăng nhập gần nhất', sort: true, render: (s) => <span title={fmtTime(s.lastLogin)}>{fmtAgo(s.lastLogin)}</span>, hideSm: true },
    { key: 'open', label: 'Việc đang làm', sort: true, align: 'right', render: (s) => <span>{fmtNum(s.work.open)}{s.work.overdue ? <Badge tone="bad">{s.work.overdue} quá hạn</Badge> : null}</span>, hideSm: true },
  ];
  return (
    <>
      <PageHead title="Danh sách nhân viên" sub="Hồ sơ, phòng ban, chức vụ, nhóm, vai trò và trạng thái tài khoản của nhân viên trong phạm vi của bạn."
        actions={<>{can('staff.export') && <button className="btn btn-gray btn-sm" onClick={() => act(() => download(`/api/admin/staff/export${admin.q({ q: term, dept, team, status, role })}`, 'nhan-vien.csv'))}><Icon name="download" size={14} />Xuất CSV</button>}
          {can('staff.create') && <button className="btn btn-primary btn-sm" onClick={() => show('new')}><Icon name="plus" size={14} />Thêm nhân viên</button>}</>} />
      <Toolbar search={q} onSearch={setQ} placeholder="Tìm tên, email, số điện thoại…">
        <Select value={dept} onChange={(v) => { setDept(v); setTeam(''); }} label="Phòng ban"><option value="">Mọi phòng ban</option><option value="none">Chưa có phòng ban</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        {!!teams.data?.length && <Select value={team} onChange={setTeam} label="Nhóm"><option value="">Mọi nhóm</option>{teams.data.filter((t) => !dept || dept === 'none' || !t.departmentId || t.departmentId === dept).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        <Select value={status} onChange={setStatus} label="Trạng thái"><option value="all">Mọi trạng thái</option><option value="active">Đang hoạt động</option><option value="locked">Đã khoá</option><option value="never">Chưa đăng nhập</option></Select>
        {!!roles.data?.length && <Select value={role} onChange={setRole} label="Vai trò"><option value="">Mọi vai trò</option>{roles.data.map((r) => <option key={r.id} value={r.key === 'member' ? 'member' : r.id}>{r.name}</option>)}</Select>}
      </Toolbar>
      <div className="ax-card flush">
        <Async load={load}>{(d) => <>
          <Table cols={cols} rows={d.items} sort={L.sort} dir={L.dir} onSort={L.onSort} onRow={(s) => show(s.id)} selected={open}
            empty={<Empty icon="users" title={term || dept || role || status !== 'all' ? 'Không có nhân viên phù hợp' : 'Chưa có nhân viên'} text="Đổi bộ lọc hoặc từ khoá tìm kiếm." />} />
          <Pager page={d.page} size={d.size} total={d.total} onPage={L.setPage} />
        </>}</Async>
      </div>
      {open === 'new' ? <StaffForm onClose={() => show(null)} onSaved={(s) => { show(s.id); load.reload(); }} />
        : open && <StaffDrawer id={open} onClose={() => show(null)} onChanged={load.reload} />}
    </>
  );
}

// ---------------------------------------------------------------- one person
function StaffDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const can = useCan(), me = useStore((s) => s.user)!;
  const load = useLoad(() => admin.staffOne(id), [id]);
  const [tab, setTab] = useState<'profile' | 'work' | 'access' | 'history'>('profile');
  const [editing, setEditing] = useState(false);
  const s = load.data, reload = () => { load.reload(); onChanged(); };
  const lock = () => s && confirm(s.disabled ? `Mở khoá tài khoản của ${s.name}?` : `Khoá tài khoản của ${s.name}? Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập được cho tới khi mở khoá.`)
    && act(() => admin.lockStaff(s.id, !s.disabled), s.disabled ? 'Đã mở khoá tài khoản' : 'Đã khoá tài khoản', reload);
  const signOut = () => s && confirm(`Đăng xuất ${s.name} khỏi mọi thiết bị (${s.sessions} phiên đang mở)?`) && act(() => admin.signOutStaff(s.id), 'Đã đăng xuất mọi thiết bị', reload);
  if (editing && s) return <StaffForm staff={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />;
  return (
    <Drawer open title={s?.name || 'Nhân viên'} sub={s?.email} onClose={onClose} wide footer={s && <>
      {s.canLock && <button className="btn btn-gray btn-sm" onClick={signOut} disabled={!s.sessions}><Icon name="back" size={14} />Đăng xuất mọi thiết bị</button>}
      {s.canLock && <button className={'btn btn-sm ' + (s.disabled ? 'btn-gray' : 'btn-danger')} onClick={lock}><Icon name="lock" size={14} />{s.disabled ? 'Mở khoá' : 'Khoá tài khoản'}</button>}
      {can('rbac.manage') && s.id !== me.id && <button className="btn btn-gray btn-sm" onClick={() => goAdmin('rbac', 'assign', { id: s.id })}><Icon name="key" size={14} />Phân quyền</button>}
      {s.canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Sửa hồ sơ</button>}
    </>}>
      {load.error ? <ErrorState error={load.error} onRetry={load.reload} /> : !s ? <Loading /> : <>
        <div className="ax-profile"><Avatar s={s} canEdit={!!s.canEdit} onChanged={reload} /><div><b>{s.name}</b><span>{s.position?.name || 'Chưa có chức vụ'}{s.department ? ` · ${s.department.name}` : ''}</span><span className="ax-badges"><StatusBadge s={s} /><RoleBadges s={s} /></span></div></div>
        <div className="ax-tabs" role="tablist">{([['profile', 'Hồ sơ'], ['work', 'Công việc'], ['access', 'Đăng nhập'], ['history', 'Lịch sử']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === 'profile' && <dl className="ax-facts">
          <dt>Email đăng nhập</dt><dd>{s.email}</dd><dt>Điện thoại</dt><dd>{s.phone || '—'}</dd><dt>Email nhận thông báo</dt><dd>{s.notifyEmail || '—'}</dd>
          <dt>Phòng ban</dt><dd>{s.department?.name || '—'}</dd><dt>Chức vụ</dt><dd>{s.position ? `${s.position.name} (${LEVEL[s.position.level] || s.position.level})` : '—'}</dd>
          <dt>Quản lý trực tiếp</dt><dd>{s.manager?.name || '—'}</dd><dt>Nhóm</dt><dd>{s.teams.length ? s.teams.map((t) => t.name + (t.leader ? ' (trưởng nhóm)' : '')).join(', ') : '—'}</dd>
          <dt>Ngày tạo</dt><dd>{fmtDate(s.createdAt)}</dd><dt>Cập nhật</dt><dd>{fmtTime(s.updatedAt)}</dd>
        </dl>}
        {tab === 'work' && <>
          <div className="ax-kpis small"><Mini label="Đang làm" v={s.work.open} /><Mini label="Quá hạn" v={s.work.overdue} bad /><Mini label="Hoàn thành" v={s.work.done} /><Mini label="Hoàn thành muộn" v={s.work.late} /></div>
          {s.tasks ? s.tasks.length ? <ul className="ax-list">{s.tasks.map((t) => <li key={t.id}><span><b>{t.title}</b><small>{t.project || 'Không thuộc dự án'} · Hạn {fmtDate(t.dueAt)}</small></span><Badge tone={t.state === 'overdue' ? 'bad' : t.state.startsWith('done') ? 'ok' : undefined}>{STATE_LABEL[t.state] || t.status}</Badge></li>)}</ul>
            : <p className="note">Chưa có công việc nào được giao.</p> : <p className="note">Bạn xem được số lượng; danh sách công việc cần quyền xem công việc trong phạm vi của người này.</p>}
        </>}
        {tab === 'access' && <>
          <Section title={`Phiên đang mở (${s.activeSessions.length})`}>{s.activeSessions.length ? <ul className="ax-list">{s.activeSessions.map((x, i) => <li key={i}><span><b>{device(x.agent)}</b><small>{x.ip || 'Không rõ IP'} · từ {fmtTime(x.at)}</small></span></li>)}</ul> : <p className="note">Không có phiên nào.</p>}</Section>
          <Section title="Lịch sử đăng nhập">{s.logins.length ? <ul className="ax-list">{s.logins.map((l, i) => <li key={i}><span><b>{l.ok ? 'Thành công' : `Thất bại: ${l.reason || ''}`}</b><small>{fmtTime(l.at)} · {l.method === 'google' ? 'Google' : l.method === 'setup' ? 'Tạo tài khoản' : 'Mật khẩu'} · {l.ip || '—'} · {device(l.agent)}</small></span><Badge tone={l.ok ? 'ok' : 'bad'}>{l.ok ? 'OK' : 'Lỗi'}</Badge></li>)}</ul> : <p className="note">Chưa có lần đăng nhập nào được ghi lại.</p>}</Section>
        </>}
        {tab === 'history' && <>
          <Section title="Thay đổi quyền"><ChangeList changes={s.roleHistory} empty="Chưa có thay đổi quyền nào." /></Section>
          <Section title="Thay đổi hồ sơ"><ChangeList changes={s.changes} /></Section>
          {s.actions && <Section title="Thao tác gần đây">{s.actions.length ? <ul className="ax-list">{s.actions.map((a, i) => <li key={i}><span><b>{a.action}</b><small>{a.label || ''} · {fmtTime(a.at)}</small></span>{a.status && a.status >= 400 ? <Badge tone="bad">{a.status}</Badge> : null}</li>)}</ul> : <p className="note">Chưa có thao tác nào.</p>}</Section>}
        </>}
      </>}
    </Drawer>
  );
}
const Mini = ({ label, v, bad }: { label: string; v: number; bad?: boolean }) => <div className={'ax-mini' + (bad && v ? ' bad' : '')}><small>{label}</small><b>{fmtNum(v)}</b></div>;
/** A browser and system from a user agent, briefly. */
export function device(ua: string | null) {
  if (!ua) return 'Không rõ thiết bị';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : 'Trình duyệt khác';
  const o = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}
/** The picture, made square and small in the browser before it is sent. */
function Avatar({ s, canEdit, onChanged }: { s: StaffDetail; canEdit: boolean; onChanged: () => void }) {
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return toast('Hãy chọn ảnh PNG, JPEG, WebP hoặc GIF', true);
    const img = await createImageBitmap(f).catch(() => null);
    if (!img) return toast('Không đọc được ảnh này', true);
    const c = document.createElement('canvas'), side = Math.min(img.width, img.height); c.width = c.height = 256;
    c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
    await act(() => admin.setAvatar(s.id, c.toDataURL('image/jpeg', 0.86)), 'Đã đổi ảnh đại diện', onChanged);
  };
  return (
    <div className="ax-avatar-edit">
      <Person p={s} size={64} />
      {canEdit && <span><label className="btn btn-gray btn-sm"><Icon name="photo" size={13} />Đổi ảnh<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pick(e.target.files?.[0])} /></label>
        {s.avatarAt && <button className="btn btn-plain btn-sm" onClick={() => act(() => admin.removeAvatar(s.id), 'Đã xoá ảnh', onChanged)}>Xoá ảnh</button>}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- add / edit
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/, PHONE = /^[+0-9 ().\-]{6,30}$/;
function StaffForm({ staff, onClose, onSaved }: { staff?: StaffDetail; onClose: () => void; onSaved: (s: Staff) => void }) {
  const can = useCan(), departments = useStore((s) => s.roles), me = useStore((s) => s.user)!;
  const self = staff?.id === me.id, structural = !staff || (!!staff.canManage && !self);
  const [f, setF] = useState({ name: staff?.name || '', email: staff?.email || '', phone: staff?.phone || '', password: '', departmentId: staff?.department?.id || '', positionId: staff?.position?.id || '', managerId: staff?.manager?.id || '', notifyEmail: staff?.notifyEmail || '', teamIds: staff?.teams.map((t) => t.id) || [] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const people = useLoad(() => admin.staff({ size: 200, status: 'active' }), []);
  const teams = useLoad(() => (can('org.view') ? admin.teams() : Promise.resolve([] as Team[])), []);
  const positions = departments.find((d) => d.id === f.departmentId)?.positions || [];
  const check = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Hãy nhập họ tên';
    if (!EMAIL.test(f.email.trim())) e.email = 'Email không hợp lệ';
    if (f.phone.trim() && !PHONE.test(f.phone.trim())) e.phone = 'Số điện thoại không hợp lệ';
    if (f.password && f.password.length < 8) e.password = 'Mật khẩu cần ít nhất 8 ký tự';
    if (f.notifyEmail.trim() && !EMAIL.test(f.notifyEmail.trim())) e.notifyEmail = 'Email không hợp lệ';
    setErrors(e); return !Object.keys(e).length;
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !check()) return;
    setBusy(true); setError('');
    const body: any = { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() };
    if (structural) Object.assign(body, { departmentId: f.departmentId || null, positionId: f.positionId || null, managerId: f.managerId || null, notifyEmail: f.notifyEmail.trim() || null, ...(f.password ? { password: f.password } : {}), ...(can('org.update') ? { teamIds: f.teamIds } : {}) });
    try {
      const s = staff ? await admin.updateStaff(staff.id, body) : await admin.createStaff(body);
      api.roles().then((roles) => setState({ roles })).catch(() => {});
      toast(staff ? (f.password ? 'Đã lưu. Người này cần đăng nhập lại bằng mật khẩu mới.' : 'Đã lưu hồ sơ') : 'Đã thêm nhân viên');
      onSaved(s);
    } catch (x: any) { setError(x.message); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f, v: any) => { setF({ ...f, [k]: v }); setErrors({ ...errors, [k]: '' }); };
  return (
    <Drawer open title={staff ? `Sửa hồ sơ · ${staff.name}` : 'Thêm nhân viên'} onClose={onClose} footer={<>
      <button className="btn btn-gray btn-sm" onClick={onClose} disabled={busy}>Huỷ</button>
      <button className="btn btn-primary btn-sm" form="ax-staff-form" disabled={busy}>{busy ? 'Đang lưu…' : staff ? 'Lưu' : 'Thêm nhân viên'}</button>
    </>}>
      <form id="ax-staff-form" className="ax-form" onSubmit={save} noValidate>
        {error && <p className="note err" role="alert">{error}</p>}
        <Field label="Họ tên *" error={errors.name}><input className="bk-in" value={f.name} maxLength={120} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Email đăng nhập *" error={errors.email}><input className="bk-in" type="email" value={f.email} maxLength={320} onChange={(e) => set('email', e.target.value)} autoComplete="off" /></Field>
        <Field label="Điện thoại" error={errors.phone}><input className="bk-in" type="tel" value={f.phone} maxLength={30} onChange={(e) => set('phone', e.target.value)} /></Field>
        {structural ? <>
          <Field label={staff ? 'Mật khẩu mới' : 'Mật khẩu'} error={errors.password} hint={staff ? 'Để trống nếu không đổi. Đổi mật khẩu sẽ đăng xuất người này khỏi mọi thiết bị.' : 'Để trống nếu người này đăng nhập bằng Google.'}><input className="bk-in" type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></Field>
          <div className="ax-form-grid">
            <Field label="Phòng ban"><select className="bk-in" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value, positionId: '' })}><option value="">Chưa có phòng ban</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Chức vụ"><select className="bk-in" value={f.positionId} disabled={!f.departmentId} onChange={(e) => set('positionId', e.target.value)}><option value="">Mặc định (Thành viên)</option>{positions.map((p) => <option key={p.id} value={p.id}>{p.name} · {LEVEL[p.level]}</option>)}</select></Field>
          </div>
          <Field label="Quản lý trực tiếp"><select className="bk-in" value={f.managerId} onChange={(e) => set('managerId', e.target.value)}><option value="">Không có</option>{(people.data?.items || []).filter((p) => p.id !== staff?.id).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.email}</option>)}</select></Field>
          {can('org.update') && !!teams.data?.length && <Field label="Nhóm"><div className="ax-checks">{teams.data.map((t) => <label key={t.id}><input type="checkbox" checked={f.teamIds.includes(t.id)} onChange={(e) => set('teamIds', e.target.checked ? [...f.teamIds, t.id] : f.teamIds.filter((x) => x !== t.id))} />{t.name}</label>)}</div></Field>}
          <Field label="Email nhận thông báo" error={errors.notifyEmail} hint="Để trống nếu không gửi email."><input className="bk-in" type="email" value={f.notifyEmail} onChange={(e) => set('notifyEmail', e.target.value)} /></Field>
        </> : <p className="note">{self ? 'Phòng ban, chức vụ, vai trò và mật khẩu của chính bạn do người có vai trò cao hơn thay đổi.' : 'Bạn chỉ sửa được tên, email và số điện thoại của người này.'}</p>}
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------- Admin accounts
export function AdminAccounts() {
  const can = useCan(), access = useStore((s) => s.admin);
  const load = useLoad(() => admin.admins(), []);
  const roles = useLoad(() => admin.roles(), []);
  const history = useLoad(() => (can('logs.view') ? admin.logs({ kind: 'permission', size: 12 }) : Promise.resolve(null)), []);
  const [adding, setAdding] = useState(false), [edit, setEdit] = useState<Staff | null>(null);
  const adminRoles = (roles.data || []).filter((r) => r.rank >= ADMIN_RANK && r.canAssign);
  const revoke = (s: Staff) => {
    const keep = s.roles.filter((r) => r.rank < ADMIN_RANK);
    if (confirm(`Thu hồi quyền quản trị của ${s.name}? Người này giữ lại: ${keep.map((r) => r.name).join(', ') || 'Member'}.`))
      void act(() => admin.setRoles(s.id, keep.map((r) => ({ roleId: r.id, scope: r.scope }))), 'Đã thu hồi quyền Admin', () => { load.reload(); history.reload(); });
  };
  const cols: Col<Staff>[] = [
    { key: 'name', label: 'Tài khoản', render: who },
    { key: 'roles', label: 'Vai trò quản trị', render: (s) => <span className="ax-stack">{s.roles.filter((r) => r.rank >= ADMIN_RANK).map((r) => <span key={r.id}><Badge tone="accent">{r.name}</Badge> <ScopeBadge scope={r.scope} /><small>{r.grantedBy ? `Cấp bởi ${r.grantedBy}` : 'Có từ trước'}{r.grantedAt ? ` · ${fmtDate(r.grantedAt)}` : ''}</small></span>)}</span> },
    { key: 'status', label: 'Trạng thái', render: (s) => <StatusBadge s={s} /> },
    { key: 'lastLogin', label: 'Đăng nhập gần nhất', render: (s) => fmtAgo(s.lastLogin), hideSm: true },
    { key: 'actions', label: '', align: 'right', render: (s) => s.canAssign ? <span className="ax-row-actions"><button className="btn btn-gray btn-sm" onClick={() => setEdit(s)}>Đổi vai trò</button><button className="btn btn-gray btn-sm" onClick={() => revoke(s)}>Thu hồi</button></span> : null },
  ];
  return (
    <>
      <PageHead title="Tài khoản Admin" sub={<>Admin là nhân viên có vai trò quản trị (Super Admin, Admin hoặc vai trò cùng cấp). Không ai tự nâng quyền của mình; Super Admin cuối cùng không thu hồi được. Mọi thay đổi được ghi vào nhật ký phân quyền.</>}
        actions={can('rbac.manage') && !!adminRoles.length && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} />Thêm Admin</button>} />
      <div className="ax-card flush"><Async load={load}>{(rows) => <Table cols={cols} rows={rows} empty={<Empty title="Chưa có tài khoản Admin" />} />}</Async></div>
      {history.data && <Section title="Lịch sử thay đổi quyền gần đây" actions={<button className="btn btn-plain btn-sm" onClick={() => goAdmin('logs', 'permissions')}>Xem tất cả</button>}>
        <ChangeList changes={history.data.items.map((l) => ({ action: `${l.action}${l.entityLabel ? ` · ${l.entityLabel}` : ''}`, by: l.userName, before: l.before, after: l.after, at: l.at }))} empty="Chưa có thay đổi quyền nào." />
      </Section>}
      {(adding || edit) && <AdminGrant staff={edit} roles={adminRoles} myRank={access?.rank || 0} onClose={() => { setAdding(false); setEdit(null); }} onSaved={() => { setAdding(false); setEdit(null); load.reload(); history.reload(); }} />}
    </>
  );
}
function AdminGrant({ staff, roles, onClose, onSaved }: { staff: Staff | null; roles: Role[]; myRank: number; onClose: () => void; onSaved: () => void }) {
  const people = useLoad(() => admin.assignments({ size: 200 }), []);
  const [userId, setUserId] = useState(staff?.id || ''), [roleId, setRoleId] = useState(staff?.roles.find((r) => r.rank >= ADMIN_RANK)?.id || roles[0]?.id || ''), [scope, setScope] = useState<Scope | ''>(staff?.roles.find((r) => r.rank >= ADMIN_RANK)?.scope || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const target = staff || people.data?.items.find((p) => p.id === userId);
  const save = async () => {
    if (!target) return setError('Hãy chọn nhân viên');
    if (!roleId) return setError('Hãy chọn vai trò');
    setBusy(true); setError('');
    const keep = target.roles.filter((r) => r.rank < ADMIN_RANK).map((r) => ({ roleId: r.id, scope: r.scope }));
    try { await admin.setRoles(target.id, [...keep, { roleId, scope: scope || null }]); toast(staff ? 'Đã đổi vai trò' : `${target.name} đã là Admin`); onSaved(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer open title={staff ? `Đổi vai trò · ${staff.name}` : 'Thêm Admin'} onClose={onClose} footer={<><button className="btn btn-gray btn-sm" onClick={onClose}>Huỷ</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button></>}>
      <div className="ax-form">
        {error && <p className="note err" role="alert">{error}</p>}
        {!staff && <Field label="Nhân viên" hint="Chọn một nhân viên đã có tài khoản; vai trò hiện có thấp hơn Admin được giữ lại."><select className="bk-in" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Chọn nhân viên…</option>{(people.data?.items || []).filter((p) => p.canAssign && p.rank < ADMIN_RANK && !p.disabled).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.email}</option>)}</select></Field>}
        <Field label="Vai trò quản trị"><select className="bk-in" value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name} (cấp {r.rank})</option>)}</select></Field>
        <Field label="Phạm vi quản trị" hint="Giới hạn dữ liệu vai trò này với tới. Để “Theo vai trò” để dùng phạm vi đã đặt trong vai trò."><select className="bk-in" value={scope} onChange={(e) => setScope(e.target.value as Scope | '')}><option value="">Theo vai trò</option>{SCOPES.map((x) => <option key={x} value={x}>{SCOPE_LABEL[x]}</option>)}</select></Field>
        <p className="note">{roles.find((r) => r.id === roleId)?.about}</p>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------- departments
export function Departments() {
  const can = useCan(), user = useStore((s) => s.user)!;
  const load = useLoad(() => admin.departments(), []);
  const [view, setView] = useState<'list' | 'chart'>('list');
  const PAGE: Record<string, string> = { workspace: 'Drive', editor: 'Trình dựng', ads: 'Báo cáo Ads' };
  return (
    <>
      <PageHead title="Phòng ban" sub="Mỗi phòng ban có board riêng, các trang công cụ người trong phòng mở được và các chức vụ của phòng."
        actions={user.role === 'admin' && <div className="ax-seg"><button aria-pressed={view === 'list'} onClick={() => setView('list')}>Danh sách</button><button aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Sơ đồ nhân sự</button></div>} />
      {view === 'chart' ? <StaffChart /> : <>
        <div className="ax-card flush"><Async load={load}>{(rows) => <Table rows={rows} empty={<Empty title="Chưa có phòng ban" text="Thêm phòng ban ở phần cấu hình bên dưới." />} cols={[
          { key: 'name', label: 'Phòng ban', render: (d) => <Badge color={d.color}>{d.name}</Badge> },
          { key: 'heads', label: 'Trưởng phòng', render: (d) => d.heads.map((h) => h.name).join(', ') || <span className="ax-muted">Chưa có</span> },
          { key: 'members', label: 'Nhân sự', align: 'right', render: (d) => `${fmtNum(d.active)}${d.members !== d.active ? ` / ${fmtNum(d.members)}` : ''}` },
          { key: 'teams', label: 'Nhóm', align: 'right', render: (d) => fmtNum(d.teams), hideSm: true },
          { key: 'boards', label: 'Board', align: 'right', render: (d) => fmtNum(d.boards), hideSm: true },
          { key: 'pages', label: 'Trang được mở', render: (d) => <span className="ax-badges">{d.pages.map((p) => <Badge key={p} tone="muted">{PAGE[p] || p}</Badge>)}</span>, hideSm: true },
        ]} />}</Async></div>
        {(user.role === 'admin' || can('org.update')) && <Section title="Cấu hình phòng ban, chức vụ và trang được mở"><DepartmentsCard onChanged={load.reload} /></Section>}
      </>}
    </>
  );
}

// ---------------------------------------------------------------- positions (a department's roles: Trưởng phòng, Editor…)
export function Positions() {
  const can = useCan(), departments = useStore((s) => s.roles);
  const [dept, setDept] = useState(''), [name, setName] = useState(''), [level, setLevel] = useState('normal'), [err, setErr] = useState('');
  const reload = () => api.roles().then((roles) => setState({ roles })).catch((e) => toast(e.message, true));
  useEffect(() => { void reload(); }, []);
  const rows = useMemo(() => departments.flatMap((d) => (d.positions || []).map((p) => ({ ...p, dept: d }))).filter((p) => !dept || p.dept.id === dept), [departments, dept]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dept) return setErr('Hãy chọn phòng ban');
    if (!name.trim()) return setErr('Hãy nhập tên chức vụ');
    setErr('');
    if (await act(() => api.createPosition(dept, { name: name.trim(), level: level as any }), 'Đã thêm chức vụ', reload)) setName('');
  };
  return (
    <>
      <PageHead title="Chức vụ" sub="Chức vụ thuộc từng phòng ban. Cấp của chức vụ quyết định người giữ nó làm được gì trong phòng: quản lý, thành viên hoặc chỉ xem." />
      <Toolbar><Select value={dept} onChange={setDept} label="Phòng ban"><option value="">Mọi phòng ban</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Toolbar>
      {can('org.create') && <form className="ax-inline-form ax-card" onSubmit={add}>
        <select className="bk-in" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Phòng ban"><option value="">Phòng ban…</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <input className="bk-in" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Tên chức vụ mới (vd. Editor)" aria-label="Tên chức vụ" />
        <select className="bk-in" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Cấp">{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn btn-primary btn-sm"><Icon name="plus" size={14} />Thêm</button>
        {err && <small className="ax-field-err" role="alert">{err}</small>}
      </form>}
      <div className="ax-card flush"><Table rows={rows} empty={<Empty title="Chưa có chức vụ" />} cols={[
        { key: 'name', label: 'Chức vụ', render: (p) => can('org.update') ? <input className="bk-in ax-cell-input" defaultValue={p.name} maxLength={60} aria-label="Tên chức vụ" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) void act(() => api.updatePosition(p.id, { name: v }), 'Đã đổi tên', reload); else e.target.value = p.name; }} /> : <b>{p.name}</b> },
        { key: 'dept', label: 'Phòng ban', render: (p) => <Badge color={p.dept.color}>{p.dept.name}</Badge> },
        { key: 'level', label: 'Cấp', render: (p) => can('org.update') ? <select className="bk-in ax-cell-input" value={p.level} onChange={(e) => void act(() => api.updatePosition(p.id, { level: e.target.value as any }), 'Đã đổi cấp', reload)} aria-label="Cấp">{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : LEVEL[p.level] },
        { key: 'members', label: 'Người giữ', align: 'right', render: (p) => fmtNum(p.members) },
        { key: 'x', label: '', align: 'right', render: (p) => can('org.delete') ? <button className="bd-icon danger" aria-label={`Xoá ${p.name}`} onClick={() => confirm(`Xoá chức vụ “${p.name}” của ${p.dept.name}?${p.members ? ` ${p.members} người đang giữ sẽ thành Thành viên của phòng.` : ''}`) && act(() => api.deletePosition(p.id), 'Đã xoá chức vụ', reload)}><Icon name="trash" size={14} /></button> : null },
      ]} /></div>
    </>
  );
}

// ---------------------------------------------------------------- teams
export function Teams() {
  const can = useCan(), departments = useStore((s) => s.roles);
  const load = useLoad(() => admin.teams(), []);
  const [edit, setEdit] = useState<Team | 'new' | null>(null);
  return (
    <>
      <PageHead title="Nhóm / Team" sub="Nhóm gom người làm cùng nhau (có thể khác phòng ban). Phạm vi “Nhóm” trong phân quyền dựa trên các nhóm này."
        actions={can('org.create') && <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><Icon name="plus" size={14} />Thêm nhóm</button>} />
      <div className="ax-card flush"><Async load={load}>{(rows) => <Table rows={rows} onRow={(t) => setEdit(t)} empty={<Empty icon="users" title="Chưa có nhóm" text={can('org.create') ? 'Tạo nhóm để gom người làm cùng nhau.' : undefined} />} cols={[
        { key: 'name', label: 'Nhóm', render: (t) => <span className="ax-stack"><Badge color={t.color}>{t.name}</Badge>{t.about && <small>{t.about}</small>}</span> },
        { key: 'dept', label: 'Phòng ban', render: (t) => departments.find((d) => d.id === t.departmentId)?.name || <span className="ax-muted">Liên phòng ban</span>, hideSm: true },
        { key: 'leaders', label: 'Trưởng nhóm', render: (t) => t.members.filter((m) => m.leader).map((m) => m.name).join(', ') || <span className="ax-muted">Chưa có</span> },
        { key: 'members', label: 'Thành viên', align: 'right', render: (t) => fmtNum(t.members.length) },
      ]} />}</Async></div>
      {edit && <TeamDrawer team={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load.reload(); }} />}
    </>
  );
}
function TeamDrawer({ team, onClose, onSaved }: { team: Team | null; onClose: () => void; onSaved: () => void }) {
  const can = useCan(), departments = useStore((s) => s.roles);
  const people = useLoad(() => admin.staff({ size: 200, status: 'active' }), []);
  const [f, setF] = useState({ name: team?.name || '', about: team?.about || '', color: team?.color || '#579dff', departmentId: team?.departmentId || '' });
  const [members, setMembers] = useState<Record<string, boolean>>(() => Object.fromEntries((team?.members || []).map((m) => [m.id, m.leader])));
  const [q, setQ] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const editable = team ? can('org.update') : can('org.create');
  const save = async () => {
    if (!f.name.trim()) return setError('Hãy nhập tên nhóm');
    setBusy(true); setError('');
    try {
      const t = team ? await admin.updateTeam(team.id, { ...f, departmentId: f.departmentId || null }) : await admin.createTeam({ ...f, departmentId: f.departmentId || null });
      if (can('org.update')) await admin.setTeamMembers(t.id, Object.keys(members), Object.keys(members).filter((k) => members[k]));
      toast(team ? 'Đã lưu nhóm' : 'Đã tạo nhóm'); onSaved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const list = (people.data?.items || []).filter((p) => !q.trim() || fold(`${p.name} ${p.email}`).includes(fold(q.trim())));
  return (
    <Drawer open title={team ? team.name : 'Thêm nhóm'} onClose={onClose} footer={<>
      {team && can('org.delete') && <button className="btn btn-gray btn-sm" onClick={() => confirm(`Xoá nhóm “${team.name}”? Thành viên vẫn giữ tài khoản; nhóm không còn dùng cho phạm vi “Nhóm”.`) && act(() => admin.removeTeam(team.id), 'Đã xoá nhóm', onSaved)}><Icon name="trash" size={14} />Xoá</button>}
      <button className="btn btn-gray btn-sm" onClick={onClose}>Đóng</button>
      {editable && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>}
    </>}>
      <fieldset className="ax-form" disabled={!editable}>
        {error && <p className="note err" role="alert">{error}</p>}
        <div className="ax-form-grid"><Field label="Tên nhóm *"><input className="bk-in" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Màu"><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></Field></div>
        <Field label="Phòng ban"><select className="bk-in" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}><option value="">Liên phòng ban</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Mô tả"><textarea className="bk-in" rows={2} maxLength={500} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} /></Field>
        {can('org.update') && <Field label={`Thành viên (${Object.keys(members).length})`} hint="Tích để thêm vào nhóm; bấm vương miện để đặt trưởng nhóm.">
          <input className="bk-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhân viên…" aria-label="Tìm nhân viên" />
          <ul className="ax-pick">{list.map((p) => {
            const inTeam = p.id in members;
            return <li key={p.id} className={inTeam ? 'on' : ''}><label><input type="checkbox" checked={inTeam} onChange={(e) => { const next = { ...members }; if (e.target.checked) next[p.id] = false; else delete next[p.id]; setMembers(next); }} /><Person p={p} size={24} /><span>{p.name}</span></label>
              {inTeam && <button type="button" className={'btn btn-sm ' + (members[p.id] ? 'btn-tinted' : 'btn-plain')} onClick={() => setMembers({ ...members, [p.id]: !members[p.id] })}>{members[p.id] ? 'Trưởng nhóm' : 'Đặt trưởng nhóm'}</button>}</li>;
          })}</ul>
        </Field>}
      </fieldset>
    </Drawer>
  );
}
