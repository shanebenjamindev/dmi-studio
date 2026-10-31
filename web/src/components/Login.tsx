// Sign-in only. Accounts are provisioned by an administrator or imported from the existing database.
import { useState } from 'react';
import { api } from '../api';
import { signedIn } from '../store';

export function LoginPage() {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api.login(f.email, f.password);
      await signedIn(r.user);
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  const input = (k: keyof typeof f, ph: string, type = 'text', auto = '') => (
    <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} type={type} autoComplete={auto} required />
  );

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/brand/logo.png" alt="Detailers Movement" className="login-logo" />
        <h1>Đăng nhập</h1>
        <p>DM Studio · Workspace khách hàng</p>
        {input('email', 'Email', 'email', 'username')}
        {input('password', 'Mật khẩu', 'password', 'current-password')}
        {err && <p className="login-err" role="alert">{err}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>Đăng nhập</button>
        <p className="login-foot">Chưa có tài khoản? Hãy nhờ quản trị viên thêm email của bạn.</p>
      </form>
    </main>
  );
}
