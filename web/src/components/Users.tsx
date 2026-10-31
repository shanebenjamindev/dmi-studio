// User management (admins) + "change my password" sheet.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, setState, toast } from '../store';
import { Sheet } from './Dialogs';
import { Icon, Menu } from './ui';
import type { Role, User } from '../types';

const ROLE: Record<Role, string> = { admin: 'Quản trị', member: 'Nhân viên' };
const when = (t: number | null) => (t ? new Date(t).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Chưa đăng nhập');
const initial = (u: { name: string; email: string }) => (u.name || u.email).trim().charAt(0).toUpperCase();

export function UsersPage() {
  const me = useStore((s) => s.user)!;
  const google = useStore((s) => s.googleSignin);
  const [list, setList] = useState<User[]>([]);
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  const load = () => api.users().then(setList).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);

  const patch = async (u: User, p: Parameters<typeof api.updateUser>[1], msg: string) => {
    try { await api.updateUser(u.id, p); toast(msg); load(); } catch (e: any) { toast(e.message, true); }
  };
  const remove = async (u: User) => {
    if (!confirm(`Xoá tài khoản ${u.email}? Người này sẽ không đăng nhập được nữa.`)) return;
    try { await api.deleteUser(u.id); load(); } catch (e: any) { toast(e.message, true); }
  };

  return (
    <main className="users">
      <header className="users-h">
        <div>
          <h1 className="side-title">Người dùng</h1>
          <p className="note">{ROLE.admin}: quản lý người dùng, tài khoản Google Drive và thư mục gốc. {ROLE.member}: quản lý khách hàng và video.</p>
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
              <option value="member">{ROLE.member}: khách hàng và video</option>
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
