// "Change my password", opened from the top bar's account menu and the profile page. A file of its own so the top bar
// does not pull the admin page (Users) into the first download.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, setState, toast } from '../store';
import { Sheet } from './Dialogs';

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
