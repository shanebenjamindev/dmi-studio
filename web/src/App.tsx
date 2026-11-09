import {BrandLoading,NetworkLoading} from './components/BrandLoading';
import { Component, Suspense, useEffect, type ReactNode } from 'react';
import { useStore, init, openPages } from './store';
import { WorkArea } from './components/WorkArea';
import { TopBar, AppHeader } from './components/TopBar';
import { LoginPage } from './components/Login';
import { ProjectsDialog, ExportDialog } from './components/Dialogs';
import { pageFor, prefetchPages } from './pages';
import { QuickNotes } from './components/QuickNotes';
import { GlobalSearch } from './components/GlobalSearch';
import { Messenger } from './components/Messenger';

/** A page that fails to draw says so (and offers a reload) instead of leaving the whole window blank. */
class PageGuard extends Component<{ page: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { page: string }) { if (prev.page !== this.props.page && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page-error" role="alert">
        <h2>Trang này gặp lỗi</h2>
        <p>{this.state.error.message}</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>Tải lại trang</button>
      </div>
    );
  }
}

export function App() {
  const ready = useStore((s) => s.ready);
  const busy=useStore(s=>s.busy);
  const toast = useStore((s) => s.toast);
  const view = useStore((s) => s.view);
  const editorHere = useStore((s) => s.editorAvailable);
  const user = useStore((s) => s.user);
  const adminAccess = useStore((s) => s.admin);
  const can = { admin: user?.role === 'admin' || Object.keys(adminAccess?.perms || {}).length > 0, editor: editorHere };
  const Page = pageFor(view, can);

  useEffect(() => { init(); }, []);
  useEffect(() => { if (ready && user) prefetchPages(openPages(), can); }, [ready, user?.id, editorHere, can.admin]);

  return (
    <>
      {ready && (user ? (
        <>
          <div className="shell">
            <AppHeader />
            <div className="shell-body">
              <TopBar />
              <div className="shell-main">
                <PageGuard page={view}>
                <WorkArea>
                  <Suspense fallback={null}><Page /></Suspense>
                </WorkArea>
                </PageGuard>
              </div>
            </div>
          </div>
          <ProjectsDialog /><ExportDialog /><QuickNotes key={user.id} /><GlobalSearch key={'s' + user.id} /><Messenger key={'msg' + user.id} />
        </>
      ) : <LoginPage />)}
      {ready&&<NetworkLoading busy={busy}/>}
      {toast && <div className={'toast' + (toast.err ? ' err' : '')}>{toast.text}</div>}
      {!ready && <div className="boot"><BrandLoading/></div>}
    </>
  );
}
