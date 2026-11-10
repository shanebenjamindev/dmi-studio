// Sign-in only. Accounts are provisioned by an administrator or imported from the existing database. A forgotten
// password is set again from a link mailed to the account's sign-in email (#reset/<token>).
import { useEffect, useState } from 'react';
import { api } from '../api';
import { LangChoice } from './TopBar';
import { signedIn, useStore } from '../store';
import { Turnstile } from './Turnstile';
import { Icon } from './ui';

type Mode = 'login' | 'forgot' | 'reset';
const resetToken = () => location.hash.match(/^#reset\/([\w-]{20,100})/)?.[1] || '';
const TITLE: Record<Mode, string> = { login: 'Đăng nhập', forgot: 'Quên mật khẩu', reset: 'Đặt mật khẩu mới' };

export function LoginPage() {
  const [mode, setModeState] = useState<Mode>(() => (resetToken() ? 'reset' : 'login'));
  const [f, setF] = useState({ email: '', password: '', next: '', again: '' });
  const [err, setErr] = useState(''), [notice, setNotice] = useState(''), [shown, setShown] = useState(false);
  const locked = useStore((s) => s.siteLock);
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
  // Each form asks for a check of its own.
  const setMode = (m: Mode) => { setModeState(m); setErr(''); setNotice(''); setToken(''); setResetKey((k) => k + 1); };
  const checked = mode === 'reset' || (!!captcha && (!captcha.required || !!token));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checked) return setErr('Hãy hoàn thành xác minh không phải người máy.');
    if (mode === 'reset' && f.next !== f.again) return setErr('Hai mật khẩu mới chưa giống nhau.');
    setBusy(true); setErr(''); setNotice('');
    try {
      if (mode === 'login') { const r = await api.login(f.email, f.password, token); await signedIn(r.user); return; }
      if (mode === 'forgot') {
        await api.forgotPassword(f.email, token);
        setNotice('Nếu email này có tài khoản, một link đặt lại mật khẩu đã được gửi tới đó (dùng được trong 30 phút). Không thấy thư? Xem mục Spam, hoặc nhờ quản trị viên đặt lại mật khẩu.');
        setToken(''); setResetKey((k) => k + 1);
        return;
      }
      await api.resetPassword(resetToken(), f.next);
      history.replaceState(null, '', location.pathname);
      setMode('login'); setF({ ...f, password: '', next: '', again: '' });
      setNotice('Đã đặt mật khẩu mới. Hãy đăng nhập.');
    } catch (x: any) { setErr(x.message); setToken(''); setResetKey((k) => k + 1); } finally { setBusy(false); }
  };
  // Each field is named for screen readers too, not only by its placeholder.
  const input = (k: keyof typeof f, ph: string, type = 'text', auto = '') => (
    <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} aria-label={ph} type={type} autoComplete={auto} minLength={k === 'next' || k === 'again' ? 8 : undefined} required />
  );
  const eye = <button type="button" className="bd-icon" onClick={() => setShown(!shown)} aria-label={shown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={shown} title={shown ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}><Icon name={shown ? 'eyeOff' : 'eye'} size={18} /></button>;

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/brand/logo.png" alt="Detailers Movement" className="login-logo" />
        <h1>{TITLE[mode]}</h1>
        <p>{mode === 'forgot' ? 'Nhập email đăng nhập; link đặt lại mật khẩu sẽ được gửi tới đó.' : mode === 'reset' ? 'Mật khẩu mới cần ít nhất 8 ký tự.' : 'DMI Workspace · Workspace khách hàng'}</p>
        {mode !== 'reset' && input('email', 'Email', 'email', 'username')}
        {mode === 'login' && <div className="login-pass">{input('password', 'Mật khẩu', shown ? 'text' : 'password', 'current-password')}{eye}</div>}
        {mode === 'reset' && <>
          <div className="login-pass">{input('next', 'Mật khẩu mới', shown ? 'text' : 'password', 'new-password')}{eye}</div>
          {input('again', 'Nhập lại mật khẩu mới', shown ? 'text' : 'password', 'new-password')}
        </>}
        {mode !== 'reset' && captcha?.required && captcha.siteKey && <Turnstile siteKey={captcha.siteKey} resetKey={resetKey} onToken={setToken} onError={setErr} />}
        {locked !== null && <p className="login-note" role="status">Website đang tạm khoá: chỉ Super Admin đăng nhập được.</p>}
        {notice && <p className="login-note" role="status">{notice}</p>}
        {err && <p className="login-err" role="alert">{err}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy || !checked}>{mode === 'login' ? 'Đăng nhập' : mode === 'forgot' ? (busy ? 'Đang gửi…' : 'Gửi link đặt lại') : 'Lưu mật khẩu mới'}</button>
        {err && mode !== 'reset' && <button className="link" type="button" onClick={() => { if (!captcha) loadConfig(); else { setErr(''); setResetKey((k) => k + 1); } }}>Thử lại xác minh</button>}
        {mode === 'login'
          ? <button className="link login-switch" type="button" onClick={() => setMode('forgot')}>Quên mật khẩu?</button>
          : <button className="link login-switch" type="button" onClick={() => { if (mode === 'reset') history.replaceState(null, '', location.pathname); setMode('login'); }}>Quay lại đăng nhập</button>}
        <p className="login-foot">Chưa có tài khoản? Hãy nhờ quản trị viên thêm email của bạn.</p>
        <LangChoice />
      </form>
    </main>
  );
}
