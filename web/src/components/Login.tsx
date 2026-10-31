// Sign-in page. On first run (no accounts yet) it creates the admin account instead.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, signedIn } from '../store';

export function LoginPage() {
  const setup = useStore((s) => s.setup);
  const google = useStore((s) => s.googleSignin);
  const needCode = useStore((s) => s.setupCode);
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', code: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Back from Google with an error: /?auth_error=<message>
  useEffect(() => {
    const e = new URLSearchParams(location.search).get('auth_error');
    if (e) { setErr(e); history.replaceState(null, '', location.pathname + location.hash); }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setup && f.password !== f.confirm) return setErr('Hai mật khẩu không khớp');
    setBusy(true); setErr('');
    try {
      const r = setup ? await api.setup({ name: f.name, email: f.email, password: f.password, code: f.code }) : await api.login(f.email, f.password);
      await signedIn(r.user);
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  const input = (k: keyof typeof f, ph: string, type = 'text', auto = '') => (
    <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} type={type} autoComplete={auto} required={k !== 'name' && k !== 'code'} />
  );

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/brand/logo.png" alt="Detailers Movement" className="login-logo" />
        <h1>{setup ? 'Tạo tài khoản quản trị' : 'Đăng nhập'}</h1>
        <p>{setup ? 'Lần đầu dùng DM Studio: tài khoản này quản lý người dùng, tài khoản Google Drive và thư mục lưu trữ.' : 'DM Studio · Workspace khách hàng'}</p>
        {setup && needCode && input('code', 'Mã cài đặt (SETUP_CODE trên máy chủ)', 'password', 'off')}
        {setup && input('name', 'Họ tên', 'text', 'name')}
        {input('email', 'Email', 'email', 'username')}
        {input('password', setup ? 'Mật khẩu (ít nhất 8 ký tự)' : 'Mật khẩu', 'password', setup ? 'new-password' : 'current-password')}
        {setup && input('confirm', 'Nhập lại mật khẩu', 'password', 'new-password')}
        {err && <p className="login-err" role="alert">{err}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>{setup ? 'Tạo tài khoản' : 'Đăng nhập'}</button>
        {!setup && google && (
          <>
            <span className="login-or">hoặc</span>
            <a className="btn btn-gray btn-lg" href="/api/auth/google"><GoogleG />Đăng nhập bằng Google</a>
          </>
        )}
        {!setup && <p className="login-foot">Chưa có tài khoản? Hãy nhờ quản trị viên thêm email của bạn.</p>}
      </form>
    </main>
  );
}

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);
