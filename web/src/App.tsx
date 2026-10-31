import { useEffect } from 'react';
import { useStore, init } from './store';
import { TopBar } from './components/TopBar';
import { WorkspacePage } from './components/Workspace';
import { AdminPage } from './components/Users';
import { LoginPage } from './components/Login';

// Trình dựng, Template and Phân tích are hidden for now; their components stay in src/components.
export function App() {
  const ready = useStore((s) => s.ready);
  const toast = useStore((s) => s.toast);
  const view = useStore((s) => s.view);
  const user = useStore((s) => s.user);

  useEffect(() => { init(); }, []);

  return (
    <>
      {ready && (user ? (
        <>
          <TopBar />
          {view === 'admin' && user.role === 'admin' ? <AdminPage /> : <WorkspacePage />}
        </>
      ) : <LoginPage />)}
      {toast && <div className={'toast' + (toast.err ? ' err' : '')}>{toast.text}</div>}
      {!ready && <div className="boot"><img src="/brand/mark.png" alt="" /></div>}
    </>
  );
}
