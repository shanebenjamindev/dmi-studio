// Quản trị (admins only): storage (Google Drive accounts, shared root folder) and users. Also the "change my password" sheet.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, setState, toast } from '../store';
import { Sheet } from './Dialogs';
import { Icon, Menu } from './ui';
import { FolderPicker } from './FolderPicker';
import { GoogleConnect, googleLogin } from './GoogleConnect';
import type { Role, User, WorkspaceInfo, GoogleStatus, Page } from '../types';

const ROLE: Record<Role, string> = { admin: 'Quản trị', member: 'Nhân viên' };
const when = (t: number | null) => (t ? new Date(t).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Chưa đăng nhập');
const initial = (u: { name: string; email: string }) => (u.name || u.email).trim().charAt(0).toUpperCase();

export function AdminPage() {
  const me = useStore((s) => s.user)!;
  const google = useStore((s) => s.googleSignin);
  const [list, setList] = useState<User[]>([]);
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  const load = () => api.users().then(setList).catch((e) => toast(e.message, true));
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [gs, setGs] = useState<GoogleStatus | null>(null);
  const [picking, setPicking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const loadStorage = () => { api.workspace().then(setWs).catch(() => {}); api.googleStatus().then(setGs).catch(() => {}); };
  useEffect(() => {
    load(); loadStorage();
    // Back from Google's consent page: /#admin?google=<email> or ?google_error=<message>
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    if (qs.get('google')) toast(`Đã kết nối ${qs.get('google')}. Bấm “Đổi” ở Thư mục gốc để dùng Drive này.`);
    if (qs.get('google_error')) toast(qs.get('google_error')!, true);
    if (qs.size) history.replaceState(null, '', '#admin');
  }, []);
  const addAccount = () => (gs?.configured ? googleLogin() : setConnecting(true));

  const patch = async (u: User, p: Parameters<typeof api.updateUser>[1], msg: string) => {
    try { await api.updateUser(u.id, p); toast(msg); load(); } catch (e: any) { toast(e.message, true); }
  };
  const remove = async (u: User) => {
    if (!confirm(`Xoá tài khoản ${u.email}? Người này sẽ không đăng nhập được nữa.`)) return;
    try { await api.deleteUser(u.id); load(); } catch (e: any) { toast(e.message, true); }
  };

  return (
    <main className="users">
      <h1 className="side-title">Quản trị</h1>

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
      </section>
      <FolderPicker open={picking} title="Thư mục gốc" start={ws?.loc} confirmLabel="Dùng thư mục này" onClose={() => setPicking(false)} onAddAccount={addAccount}
        onPick={async (loc) => { setWs(await api.setWorkspace(loc)); toast('Đã đổi thư mục gốc'); }} />
      <GoogleConnect open={connecting} onClose={() => { setConnecting(false); loadStorage(); }} onChanged={loadStorage} />

      <AccessCard />

      <section className="adm-sec">
      <header className="users-h">
        <div>
          <h2 className="side-sub">Người dùng</h2>
          <p className="note">{ROLE.admin}: toàn quyền. {ROLE.member}: xem thư mục và video, tải video lên, sửa link và ghi chú; không tạo, đổi tên hay xoá.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><Icon name="plus" size={14} />Thêm</button>
      </header>
      <div className="list users-list">
        {list.map((u) => (
          <div key={u.id} className={'list-row users-row' + (u.disabled ? ' off' : '')}>
            <span className="ws-avatar">{initial(u)}</span>
            <div className="list-main">
              <b>{u.name}{u.id === me.id && <em className="users-me">Bạn</em>}</b>
              <span>{u.email}</span>
              <span className="tiny">{u.disabled ? 'Đã khoá' : `Đăng nhập gần nhất: ${when(u.lastLogin)}`}{!u.hasPassword && ' · Chỉ đăng nhập bằng Google'}</span>
            </div>
            <div className="list-side">
              <span className={'users-role-t' + (u.role === 'admin' ? ' admin' : '')}>{ROLE[u.role]}</span>
              <Menu label="Tuỳ chọn" items={[
                { label: 'Sửa…', icon: 'text', onClick: () => setEdit(u) },
                { label: u.role === 'admin' ? `Đổi thành ${ROLE.member}` : `Đổi thành ${ROLE.admin}`, icon: 'badge', hidden: u.id === me.id,
                  onClick: () => { const r: Role = u.role === 'admin' ? 'member' : 'admin'; patch(u, { role: r }, `${u.name} giờ là ${ROLE[r]}`); } },
                { label: u.disabled ? 'Mở khoá' : 'Khoá tài khoản', icon: u.disabled ? 'check' : 'x', hidden: u.id === me.id,
                  onClick: () => patch(u, { disabled: !u.disabled }, u.disabled ? 'Đã mở khoá' : 'Đã khoá, người này bị đăng xuất ngay') },
                { label: 'Xoá', icon: 'trash', danger: true, hidden: u.id === me.id, onClick: () => remove(u) },
              ]} />
            </div>
          </div>
        ))}
      </div>
      </section>
      <UserSheet user={edit} google={google} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />
    </main>
  );
}

function UserSheet({ user, google, onClose, onSaved }: { user: User | 'new' | null; google: boolean; onClose: () => void; onSaved: () => void }) {
  const isNew = user === 'new';
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'member' as Role });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user && user !== 'new') setF({ name: user.name, email: user.email, password: '', role: user.role });
    else setF({ name: '', email: '', password: '', role: 'member' });
  }, [user]);

  const save = async () => {
    setBusy(true);
    try {
      if (isNew) await api.createUser({ ...f, password: f.password || undefined });
      else await api.updateUser((user as User).id, { name: f.name, email: f.email, ...(f.password ? { password: f.password } : {}) });
      toast(isNew ? 'Đã thêm người dùng' : f.password ? 'Đã lưu. Người này cần đăng nhập lại bằng mật khẩu mới.' : 'Đã lưu');
      onSaved();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const passHint = isNew
    ? google ? 'Để trống nếu người này chỉ đăng nhập bằng Google' : 'Ít nhất 8 ký tự'
    : 'Để trống nếu không đổi';

  return (
    <Sheet open={!!user} onClose={onClose} title={isNew ? 'Thêm người dùng' : 'Sửa người dùng'} footer={<>
      <button className="btn btn-gray" onClick={onClose}>Huỷ</button>
      <button className="btn btn-primary" disabled={busy || !f.email.trim() || (isNew && !google && !f.password)} onClick={save}>{isNew ? 'Thêm' : 'Lưu'}</button>
    </>}>
      <form className="users-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label className="ws-field"><span>Họ tên</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nguyễn Văn A" autoFocus /></label>
        <label className="ws-field"><span>Email đăng nhập</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="ten@congty.vn" autoComplete="off" /></label>
        <label className="ws-field"><span>{isNew ? 'Mật khẩu' : 'Mật khẩu mới'}</span><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={passHint} autoComplete="new-password" /></label>
        {isNew && (
          <label className="ws-field"><span>Vai trò</span>
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              <option value="member">{ROLE.member}: xem, tải video lên</option>
              <option value="admin">{ROLE.admin}: toàn quyền</option>
            </select>
          </label>
        )}
        {google && <p className="note">Người này cũng có thể bấm “Đăng nhập bằng Google” với đúng email trên.</p>}
        <button hidden />
      </form>
    </Sheet>
  );
}

export function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useStore((s) => s.user);
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  useEffect(() => { if (open) setF({ current: '', next: '', confirm: '' }); }, [open]);
  const save = async () => {
    if (f.next !== f.confirm) return toast('Hai mật khẩu mới không khớp', true);
    try { await api.changePassword(f.current, f.next); if (me) setState({ user: { ...me, hasPassword: true } }); toast('Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.'); onClose(); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={me?.hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'} footer={<>
      <button className="btn btn-gray" onClick={onClose}>Huỷ</button>
      <button className="btn btn-primary" disabled={!f.next} onClick={save}>Lưu</button>
    </>}>
      <form className="users-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input hidden autoComplete="username" value={me?.email || ''} readOnly />
        {me?.hasPassword && <label className="ws-field"><span>Mật khẩu hiện tại</span><input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" autoFocus /></label>}
        <label className="ws-field"><span>Mật khẩu mới</span><input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} placeholder="Ít nhất 8 ký tự" autoComplete="new-password" /></label>
        <label className="ws-field"><span>Nhập lại mật khẩu mới</span><input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" /></label>
        <button hidden />
      </form>
    </Sheet>
  );
}

const PAGE_LABEL: [Page, string, string][] = [
  ['workspace', 'Drive', 'Thư mục khách hàng, video, link và ghi chú'],
  ['editor', 'Trình dựng', 'Dự án dựng từ sheet, timeline, xuất CapCut'],
];
/** Which pages each kind of account may open. Admins always have every page; members' pages are switched here. */
function AccessCard() {
  const [acc, setAcc] = useState<Record<Role, Page[]> | null>(null);
  useEffect(() => { api.access().then(setAcc).catch((e) => toast(e.message, true)); }, []);
  const toggle = async (p: Page) => {
    if (!acc) return;
    const member = acc.member.includes(p) ? acc.member.filter((x) => x !== p) : [...acc.member, p];
    try { setAcc(await api.setAccess(member)); toast('Đã lưu quyền truy cập'); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <section className="adm-sec">
      <header className="users-h">
        <div>
          <h2 className="side-sub">Quyền truy cập trang</h2>
          <p className="note">Chọn trang mỗi loại tài khoản được mở. Thay đổi có hiệu lực khi người đó tải lại trang; quyền được kiểm tra cả trên máy chủ.</p>
        </div>
      </header>
      <div className="access-table">
        <div className="access-tr head"><span>Trang</span><span>{ROLE.admin}</span><span>{ROLE.member}</span></div>
        {PAGE_LABEL.map(([p, label, hint]) => (
          <div key={p} className="access-tr">
            <span><b>{label}</b><em>{hint}</em></span>
            <span><span className="access-on locked" title="Quản trị luôn có mọi quyền"><Icon name="check" size={14} /></span></span>
            <span>
              <button className={'access-sw' + (acc?.member.includes(p) ? ' on' : '')} role="switch" aria-checked={!!acc?.member.includes(p)}
                aria-label={`${ROLE.member} được mở ${label}`} disabled={!acc} onClick={() => toggle(p)}><i /></button>
            </span>
          </div>
        ))}
        <div className="access-tr">
          <span><b>Quản trị</b><em>Người dùng, lưu trữ, kết nối Google, phân quyền</em></span>
          <span><span className="access-on locked"><Icon name="check" size={14} /></span></span>
          <span><span className="access-off">Không</span></span>
        </div>
      </div>
    </section>
  );
}
