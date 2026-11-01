import { useEffect } from 'react';
import { useStore, init } from './store';
import { TopBar } from './components/TopBar';
import { WorkspacePage } from './components/Workspace';
import { AdminPage } from './components/Users';
import { LoginPage } from './components/Login';
import { LeftPanel } from './components/LeftPanel';
import { Stage } from './components/Stage';
import { ProjectsDialog, ExportDialog } from './components/Dialogs';
import { Home } from './components/Home';
import { Editor } from './components/Editor';

// Template and Phân tích are hidden for now; their components stay in src/components.
export function App() {
  const ready = useStore((s) => s.ready);
  const toast = useStore((s) => s.toast);
  const view = useStore((s) => s.view);
  const user = useStore((s) => s.user);
  const hasProject = useStore((s) => !!s.project);
  const assembly = useStore((s) => s.project?.storyboard?.mode === 'edit' || !!s.project?.sheet);

  useEffect(() => { init(); }, []);

  return (
    <>
      {ready && (user ? (
        <>
          <TopBar />
          {view === 'admin' && user.role === 'admin' ? <AdminPage />
            : view === 'editor' ? (
              // The editor opens on the project list; a project from a sheet gets the desktop-editor layout,
              // older projects written from a brief keep the previous layout.
              <div className="studio">
                {!hasProject ? <Home /> : assembly ? <Editor /> : <div className="layout"><LeftPanel /><Stage /></div>}
              </div>
            )
            : <WorkspacePage />}
          <ProjectsDialog /><ExportDialog />
        </>
      ) : <LoginPage />)}
      {toast && <div className={'toast' + (toast.err ? ' err' : '')}>{toast.text}</div>}
      {!ready && <div className="boot"><img src="/brand/mark.png" alt="" /></div>}
    </>
  );
}
