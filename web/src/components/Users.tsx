import {EntitySelect,useEntityRefresh} from './QuickCreate';
// Parts of Quản trị that company admins use (server/auth.ts): the staff by department, departments with their roles and
// pages, and where customer folders are stored. The admin module (web/src/admin) puts them on its pages.
import { Fragment, useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, setState, toast } from '../store';
import { Sheet } from './Dialogs';
import { Icon } from './ui';
import { StaffBoard } from './StaffBoard';
import { FolderPicker } from './FolderPicker';
import { GoogleConnect, googleLogin } from './GoogleConnect';
import type { Role, User, WorkspaceInfo, GoogleStatus, Page, TeamRole, DeptRole, Level } from '../types';
import { askConfirm, askText } from './AskDialog';

const ROLE: Record<Role, string> = { admin: 'Quản trị', member: 'Nhân viên' };
/** The levels a department role gives (what its people may do in the department). */
const LEVEL_LABEL: Record<Level, string> = { admin: 'Admin', normal: 'Thành viên', observer: 'Chỉ xem' };
const LEVEL_HINT: Record<Level, string> = {
  admin: 'Quản lý board của phòng (chia sẻ, quyền xem, xoá board) và thư mục khách hàng trên Drive',
  normal: 'Sửa board của phòng; trên Drive xem, tải lên, sửa link và ghi chú',
  observer: 'Chỉ xem và bình luận; không sửa gì trên Drive',
};
const LEVELS: Level[] = ['admin', 'normal', 'observer'];

/** The staff by department (drag to move someone), with adding and editing people and departments. Company admins only:
 *  it reads every account (/api/users). */
export function StaffChart() {
  const me = useStore((s) => s.user)!;
  const roles = useStore((s) => s.roles);
  const google = useStore((s) => s.googleSignin);
  const [list, setList] = useState<User[]>([]);
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [newTeam,setNewTeam]=useState<string|null>(null);
  const [newDepartment,setNewDepartment]=useState(false);
  const load = async () => { setLoading(true); setError(''); try {setList(await api.users());} catch(e:any){setError(e.message);} finally{setLoading(false);} };
  useEntityRefresh(()=>{void api.users().then(setList).catch(()=>{});void api.roles().then(roles=>setState({roles})).catch(()=>{});});
  const addUser=(team:string|null)=>{setNewTeam(team);setEdit('new');};
  const reloadRoles=()=>api.roles().then(roles=>setState({roles})).catch(e=>toast(e.message,true));
  useEffect(() => { load(); }, []);
  return (
    <div className="users staff-admin">
      <StaffBoard users={list} roles={roles} meId={me.id} loading={loading} error={error} onRetry={load} onEdit={setEdit} onAdd={addUser} onUserChanged={u=>setList(current=>current.map(x=>x.id===u.id?u:x))} onReload={load} onAddDepartment={()=>setNewDepartment(true)}/>
      <DepartmentSheet open={newDepartment} onClose={()=>setNewDepartment(false)} onSaved={()=>{setNewDepartment(false);reloadRoles();}}/>
      <UserSheet user={edit} initialTeam={newTeam} google={google} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />
    </div>
  );
}

/** Where everyone's customer folders start (the root folder) and the Google Drive accounts connected. Company admins only. */
export function StorageSettings() {
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [gs, setGs] = useState<GoogleStatus | null>(null);
  const [picking, setPicking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const loadStorage = () => { api.workspace().then(setWs).catch(() => {}); api.googleStatus().then(setGs).catch(() => {}); };
  useEffect(() => {
    loadStorage();
    // Back from Google's consent page: #admin…?google=<email> or ?google_error=<message>
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    if (qs.get('google')) toast(`Đã kết nối ${qs.get('google')}. Bấm “Đổi” ở Thư mục gốc để dùng Drive này.`);
    if(qs.get('mail'))toast('Đã kết nối tài khoản Gmail gửi thông báo.');
    if(qs.get('mail_error'))toast(qs.get('mail_error')!,true);
    if (qs.get('google_error')) toast(qs.get('google_error')!, true);
    if (qs.size) history.replaceState(null, '', location.hash.split('?')[0]);
  }, []);
  const addAccount = () => (gs?.configured ? googleLogin() : setConnecting(true));
  return (
    <section className="adm-sec">
      <h2 className="side-sub">Lưu trữ</h2>
      <div className="list users-list">
        <div className="list-row users-row">
          <span className="adm-ico"><Icon name="folder" size={17} /></span>
          <div className="list-main">
            <b>Thư mục gốc</b>
            <span>{ws ? `${ws.label}${ws.account ? ` · ${ws.account}` : ''}` : '…'}</span>
            <span className="tiny">Mọi người bắt đầu từ thư mục này; {ROLE.member.toLowerCase()} chỉ xem được bên trong nó.</span>
          </div>
          <div className="list-side"><button className="btn btn-gray btn-sm" onClick={() => setPicking(true)}>Đổi</button></div>
        </div>
        <div className="list-row users-row">
          <span className="adm-ico"><Icon name="key" size={17} /></span>
          <div className="list-main">
            <b>Tài khoản Google Drive</b>
            <span>{gs?.accounts.length ? gs.accounts.map((a) => a.email).join(', ') : 'Chưa kết nối'}</span>
          </div>
          <div className="list-side"><button className="btn btn-gray btn-sm" onClick={() => setConnecting(true)}>Quản lý</button></div>
        </div>
      </div>
      <FolderPicker open={picking} title="Thư mục gốc" start={ws?.loc} confirmLabel="Dùng thư mục này" onClose={() => setPicking(false)} onAddAccount={addAccount}
        onPick={async (loc) => { setWs(await api.setWorkspace(loc)); toast('Đã đổi thư mục gốc'); }} />
      <GoogleConnect open={connecting} onClose={() => { setConnecting(false); loadStorage(); }} onChanged={loadStorage} />
    </section>
  );
}

function UserSheet({ user, initialTeam, google, onClose, onSaved }: { initialTeam: string|null; user: User | 'new' | null; google: boolean; onClose: () => void; onSaved: () => void }) {
  const isNew = user === 'new';
  const roles = useStore((s) => s.roles);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'member' as Role, teamRole: '', deptRole: '', notifyEmail: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user && user !== 'new') setF({ name: user.name, email: user.email, password: '', role: user.role, teamRole: user.teamRole || '', deptRole: user.deptRole || '', notifyEmail: user.notifyEmail || '' });
    else setF({ name: '', email: '', password: '', role: 'member', teamRole: initialTeam || '', deptRole: '', notifyEmail: '' });
  }, [user,initialTeam]);

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) await api.createUser({ ...f, password: f.password || undefined, teamRole: f.teamRole || null, deptRole: f.deptRole || null, notifyEmail: f.notifyEmail.trim() || null });
      else await api.updateUser((user as User).id, { name: f.name, email: f.email, teamRole:f.teamRole||null, deptRole:f.deptRole||null, notifyEmail: f.notifyEmail.trim() || null, ...(f.password ? { password: f.password } : {}) });
      api.roles().then(roles=>setState({roles})).catch(()=>{});
      toast(isNew ? 'Đã thêm người dùng' : f.password ? 'Đã lưu. Người này cần đăng nhập lại bằng mật khẩu mới.' : 'Đã lưu');
      onSaved();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const passHint = isNew
    ? google ? 'Để trống nếu người này chỉ đăng nhập bằng Google' : 'Ít nhất 8 ký tự'
    : 'Để trống nếu không đổi';

  return (
    <Sheet open={!!user} onClose={onClose} title={isNew ? 'Thêm nhân viên' : 'Sửa nhân viên'} footer={<>
      <button className="btn btn-gray" onClick={onClose}>Huỷ</button>
      <button className="btn btn-primary" disabled={busy || !f.email.trim() || (isNew && !google && !f.password)} onClick={save}>{isNew ? 'Thêm' : 'Lưu'}</button>
    </>}>
      <form className="users-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="ws-field"><span>Họ tên</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nguyễn Văn A" autoFocus /></label>
        <label className="ws-field"><span>Email đăng nhập</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="ten@congty.vn" autoComplete="off" /></label>
        <label className="ws-field"><span>Email nhận thông báo</span><input type="email" value={f.notifyEmail} onChange={(e) => setF({ ...f, notifyEmail: e.target.value })} placeholder="Để trống nếu không gửi email" autoComplete="off" /><small className="note">Mọi thao tác liên quan tới nhân viên này (giao việc, thêm vào thẻ, board, dịch vụ, khách hàng, bình luận, đổi hạn…) được gửi tới email này.</small></label>
        <label className="ws-field"><span>{isNew ? 'Mật khẩu' : 'Mật khẩu mới'}</span><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={passHint} autoComplete="new-password" /></label>
        {isNew && (
          <>
            <label className="ws-field"><span>Quyền hệ thống</span>
              <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
                <option value="member">{ROLE.member}: theo phòng ban và role</option>
                <option value="admin">{ROLE.admin}: toàn quyền</option>
              </select>
            </label>
          </>
        )}
            <label className="ws-field"><span>Phòng ban</span>
              <EntitySelect kind="department" value={f.teamRole} onChange={v=>setF({...f,teamRole:v,deptRole:''})}>
                <option value="">Chưa có phòng ban</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </EntitySelect>
            </label>
            {f.teamRole && f.role !== 'admin' && (
              <label className="ws-field"><span>Vai trò trong phòng</span>
                <EntitySelect kind="position" context={{departmentId:f.teamRole}} value={f.deptRole} onChange={v=>setF({...f,deptRole:v})}>
                  <option value="">Mặc định (Thành viên)</option>
                  {(roles.find((r) => r.id === f.teamRole)?.positions || []).map((p) => <option key={p.id} value={p.id}>{p.name} · {LEVEL_LABEL[p.level]}</option>)}
                </EntitySelect>
              </label>
            )}
        {google && <p className="note">Người này cũng có thể bấm “Đăng nhập bằng Google” với đúng email trên.</p>}
        <button hidden />
      </form>
    </Sheet>
  );
}

const PAGE_LABEL: [Page, string, string][] = [
  ['workspace', 'Drive', 'Thư mục khách hàng, video, link và ghi chú'],
  ['editor', 'Báo cáo', 'Báo cáo khách hàng'],
  ['ads', 'Báo cáo Ads', 'Số liệu Meta Ads lấy trực tiếp: chi tiêu, kết quả, chiến dịch'],
];
/**
 * The company's departments (phòng ban): each gives its people a board of their own in Workspace and the tool pages
 * they open (Media Execute: Drive and Báo cáo), and has its own roles (Trưởng phòng, Editor…), each at a level:
 * admin (manage the department's boards and Drive), member (edit) or view only. People in no department open the
 * pages set on the "Chưa có phòng ban" row; admins, everything.
 */
export function DepartmentsCard({onChanged}:{onChanged:()=>void}) {
  const roles = useStore((s) => s.roles);
  const [acc, setAcc] = useState<Record<Role, Page[]> | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { api.access().then(setAcc).catch((e) => toast(e.message, true)); reload(); }, []);
  const reload = () => api.roles().then((roles) => setState({ roles })).catch((e) => toast(e.message, true));
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); await reload(); onChanged(); if (msg) toast(msg); } catch (e: any) { toast(e.message, true); } };
  const update = (r: TeamRole, p: Partial<{ name: string; color: string; pages: Page[] }>) => run(() => api.updateRole(r.id, p));
  const add = async () => {
    const name = (await askText('Tên phòng ban mới (vd. Design)'))?.trim();
    if (name) run(() => api.createRole({ name, color: '#64748b', pages: [] }), `Đã thêm phòng ${name}, board riêng và các role mặc định của phòng`);
  };
  const remove = async (r: TeamRole) => {
    if (await askConfirm(`Xoá phòng ban “${r.name}”? ${r.members} người sẽ thành chưa có phòng ban; board của phòng chỉ quản trị viên (và người được thêm) còn xem được.`)) run(() => api.deleteRole(r.id));
  };
  const addPosition = async (r: TeamRole) => {
    const name = (await askText(`Tên role mới trong ${r.name} (vd. Editor, Cộng tác viên)`))?.trim();
    if (name) run(() => api.createPosition(r.id, { name, level: 'normal' }), `Đã thêm role ${name}`);
  };
  const removePosition = async (r: TeamRole, p: DeptRole) => {
    if (await askConfirm(`Xoá role “${p.name}” của ${r.name}?${p.members ? ` ${p.members} người đang giữ role này sẽ thành Thành viên của phòng.` : ''}`)) run(() => api.deletePosition(p.id));
  };
  const rename = (key: string, current: string, save: (n: string) => void) => ({
    value: names[key] ?? current,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNames({ ...names, [key]: e.target.value }),
    onBlur: () => { const n = (names[key] ?? current).trim(); setNames(({ [key]: _, ...rest }) => rest); if (n && n !== current) save(n); },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && (e.target as HTMLInputElement).blur(),
  });
  const toggleMember = async (p: Page) => {
    if (!acc) return;
    const member = acc.member.includes(p) ? acc.member.filter((x) => x !== p) : [...acc.member, p];
    try { setAcc(await api.setAccess(member)); toast('Đã lưu quyền truy cập'); } catch (e: any) { toast(e.message, true); }
  };
  const sw = (on: boolean, label: string, onClick: () => void, disabled = false) => (
    <button className={'access-sw' + (on ? ' on' : '')} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}><i /></button>
  );
  return (
    <section className="adm-sec">
      <header className="users-h">
        <div>
          <h2 className="side-sub">Phòng ban</h2>
          <p className="note">Mỗi phòng ban có board riêng trong Workspace, các trang công cụ người trong phòng mở được (tab Media Execute gồm Drive và Trình dựng) và các role của phòng. Mỗi role một cấp: <b>Admin</b> quản lý board và thư mục Drive của phòng; <b>Thành viên</b> sửa; <b>Chỉ xem</b> chỉ xem và bình luận. Gán phòng ban và role cho từng người ở danh sách Nhân viên bên dưới. Quyền được kiểm tra cả trên máy chủ.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={add}><Icon name="plus" size={14} />Thêm phòng ban</button>
      </header>
      <div className="access-table roles-table">
        <div className="access-tr head"><span>Phòng ban và role</span>{PAGE_LABEL.map(([p, label]) => <span key={p}>{label}</span>)}<span>Người</span><span /></div>
        {roles.map((r) => (
          <Fragment key={r.id}>
            <div className="access-tr">
              <span className="role-name">
                <label className="role-color" style={{ background: r.color }} title="Đổi màu"><input type="color" value={r.color} onChange={(e) => update(r, { color: e.target.value })} /></label>
                <input {...rename(r.id, r.name, (name) => update(r, { name }))} aria-label="Tên phòng ban" />
              </span>
              {PAGE_LABEL.map(([p, label]) => <span key={p}>{sw(r.pages.includes(p), `${r.name} được mở ${label}`, () => update(r, { pages: r.pages.includes(p) ? r.pages.filter((x) => x !== p) : [...r.pages, p] }))}</span>)}
              <span className="mono">{r.members}</span>
              <span><button className="bd-icon danger" onClick={() => remove(r)} aria-label={`Xoá phòng ban ${r.name}`}><Icon name="trash" size={14} /></button></span>
            </div>
            <div className="dept-roles">
              {(r.positions || []).map((p) => (
                <span key={p.id} className={'dept-role lv-' + p.level} title={LEVEL_HINT[p.level]}>
                  <input {...rename(p.id, p.name, (name) => run(() => api.updatePosition(p.id, { name })))} aria-label={`Tên role ${p.name}`} size={Math.max(6, (names[p.id] ?? p.name).length)} />
                  <select value={p.level} onChange={(e) => run(() => api.updatePosition(p.id, { level: e.target.value as Level }))} aria-label={`Cấp của role ${p.name}`}>
                    {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                  </select>
                  <em title="Số người giữ role này">{p.members}</em>
                  <button onClick={() => removePosition(r, p)} aria-label={`Xoá role ${p.name}`}><Icon name="x" size={12} /></button>
                </span>
              ))}
              <button className="dept-role-add" onClick={() => addPosition(r)}><Icon name="plus" size={13} />Thêm role</button>
            </div>
          </Fragment>
        ))}
        <div className="access-tr">
          <span><b>Chưa có phòng ban</b><em>Người dùng chưa được gán phòng ban nào</em></span>
          {PAGE_LABEL.map(([p, label]) => <span key={p}>{sw(!!acc?.member.includes(p), `Người chưa có phòng ban được mở ${label}`, () => toggleMember(p), !acc)}</span>)}
          <span /><span />
        </div>
        <div className="access-tr">
          <span><b>{ROLE.admin}</b><em>Mọi trang, mọi board, Quản trị</em></span>
          {PAGE_LABEL.map(([p]) => <span key={p}><span className="access-on locked" title="Quản trị luôn có mọi quyền"><Icon name="check" size={14} /></span></span>)}
          <span /><span />
        </div>
      </div>
    </section>
  );
}

function DepartmentSheet({open,onClose,onSaved}:{open:boolean;onClose:()=>void;onSaved:()=>void}) {
  const[name,setName]=useState('');
  const[color,setColor]=useState('#579dff');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  useEffect(()=>{if(open){setName('');setColor('#579dff');setError('');}},[open]);
  const save=async()=>{
    if(busy||!name.trim())return;
    setBusy(true);setError('');
    try{await api.createRole({name:name.trim(),color,pages:['workspace']});toast('Đã tạo phòng ban');onSaved();}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  return <Sheet open={open} onClose={()=>{if(!busy)onClose();}} title="Thêm phòng ban" footer={<><button className="btn btn-gray" disabled={busy} onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={busy||!name.trim()} onClick={save}>{busy?'Đang tạo…':'Tạo phòng ban'}</button></>}><form className="users-form" onSubmit={e=>{e.preventDefault();void save();}}><label className="ws-field"><span>Tên phòng ban</span><input autoFocus maxLength={80} required disabled={busy} value={name} onChange={e=>setName(e.target.value)} placeholder="Ví dụ: Thiết kế"/></label><label className="ws-field"><span>Màu nhận diện</span><input type="color" disabled={busy} value={color} onChange={e=>setColor(e.target.value)}/></label>{error&&<p className="note err" role="alert">{error}</p>}</form></Sheet>;
}
