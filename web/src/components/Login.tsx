// Sign-in only. Accounts are provisioned by an administrator or imported from the existing database.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { LangChoice } from './TopBar';
import { signedIn } from '../store';
import { Turnstile } from './Turnstile';

export function LoginPage() {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<{ siteKey: string; required: boolean } | null>(null);
  const [token, setToken] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const loadConfig = () => {
    setErr('');
    api.authConfig().then(({ turnstile }) => {
      setCaptcha(turnstile);
      if (turnstile.required && !turnstile.siteKey) setErr('Xác minh chưa sẵn sàng. Hãy liên hệ quản trị viên.');
    }).catch((e) => setErr(e.message));
  };
  useEffect(() => { loadConfig(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captcha || (captcha.required && !token)) return setErr('Hãy hoàn thành xác minh không phải người máy.');
    setBusy(true); setErr('');
    try {
      const r = await api.login(f.email, f.password, token);
      await signedIn(r.user);
    } catch (x: any) { setErr(x.message); setToken(''); setResetKey((k) => k + 1); } finally { setBusy(false); }
  };
  const input = (k: keyof typeof f, ph: string, type = 'text', auto = '') => (
    <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} type={type} autoComplete={auto} required />
  );

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/brand/logo.png" alt="Detailers Movement" className="login-logo" />
        <h1>Đăng nhập</h1>
        <p>DM Workspace · Workspace khách hàng</p>
        {input('email', 'Email', 'email', 'username')}
        {input('password', 'Mật khẩu', 'password', 'current-password')}
        {captcha?.required && captcha.siteKey && <Turnstile siteKey={captcha.siteKey} resetKey={resetKey} onToken={setToken} onError={setErr} />}
        {err && <p className="login-err" role="alert">{err}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy || !captcha || (captcha.required && !token)}>Đăng nhập</button>
        {err && <button className="link" type="button" onClick={() => { if (!captcha) loadConfig(); else { setErr(''); setResetKey((k) => k + 1); } }}>Thử lại xác minh</button>}
        <p className="login-foot">Chưa có tài khoản? Hãy nhờ quản trị viên thêm email của bạn.</p>
        <LangChoice />
      </form>
    </main>
  );
}
