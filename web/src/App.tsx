import {BrandLoading,NetworkLoading} from './components/BrandLoading';
import { Component, useEffect, type ReactNode } from 'react';
import { useStore, init } from './store';
import { WorkArea, WorkProjects } from './components/WorkArea';
import { TopBar } from './components/TopBar';
import { WorkspacePage } from './components/Workspace';
import { ProfilePage } from './components/Profile';
import { AdminPage } from './components/Users';
import { LoginPage } from './components/Login';
import { LeftPanel } from './components/LeftPanel';
import { Stage } from './components/Stage';
import { ProjectsDialog, ExportDialog } from './components/Dialogs';
import { Home } from './components/Home';
import { Editor } from './components/Editor';
import { BoardsPage } from './components/Boards';
import { ToolsPage } from './components/Tools';
import { CustomersPage } from './components/Customers';
import { AdsPage } from './components/AdsPage';
import { ReportsPage } from './components/Reports';
import { TasksPage } from './components/Tasks';
import { EditorOnMac } from './components/EditorOnMac';

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

// Template and Phân tích are hidden for now; their components stay in src/components.
export function App() {
  const ready = useStore((s) => s.ready);
  const busy=useStore(s=>s.busy);
  const toast = useStore((s) => s.toast);
  const view = useStore((s) => s.view);
  const editorHere = useStore((s) => s.editorAvailable);
  const user = useStore((s) => s.user);
  const hasProject = useStore((s) => !!s.project);
  // A sheet project is a cut of the client's footage, unless the sheet had none and the video was made from its script.
  const assembly = useStore((s) => s.project?.storyboard?.mode === 'edit' || (!!s.project?.sheet && !s.project?.storyboard));

  useEffect(() => { init(); }, []);

  return (
    <>
      {ready && (user ? (
        <>
          <TopBar />
          <PageGuard page={view}>
          <WorkArea>
          {view === 'admin' && user.role === 'admin' ? <AdminPage />
            : view === 'profile' ? <ProfilePage />
            : view === 'boards' ? <BoardsPage />
            : view === 'tasks' ? <TasksPage />
            : view === 'projects' ? <WorkProjects />
            : view === 'tools' ? <ToolsPage />
            : view === 'reports' ? <ReportsPage />
            : view === 'ads' ? <AdsPage />
            : view === 'customers' ? <CustomersPage />
            : view === 'editor' && !editorHere ? <EditorOnMac />
            : view === 'editor' ? (
              // The editor opens on the project list; a project from a sheet gets the desktop-editor layout,
              // older projects written from a brief keep the previous layout.
              <div className="studio">
                {!hasProject ? <Home /> : assembly ? <Editor /> : <div className="layout"><LeftPanel /><Stage /></div>}
              </div>
            )
            : <WorkspacePage />}
          </WorkArea>
          </PageGuard>
          <ProjectsDialog /><ExportDialog />
        </>
      ) : <LoginPage />)}
      {ready&&<NetworkLoading busy={busy}/>}
      {toast && <div className={'toast' + (toast.err ? ' err' : '')}>{toast.text}</div>}
      {!ready && <div className="boot"><BrandLoading/></div>}
    </>
  );
}
