import { useStore } from '../store';
import { Home } from './Home';
import { Editor } from './Editor';
import { LeftPanel } from './LeftPanel';
import { Stage } from './Stage';

/** The editor page. It opens on the project list; a project from a sheet gets the desktop-editor layout,
 * older projects written from a brief keep the previous layout. */
export function Studio() {
  const hasProject = useStore((s) => !!s.project);
  // A sheet project is a cut of the client's footage, unless the sheet had none and the video was made from its script.
  const assembly = useStore((s) => s.project?.storyboard?.mode === 'edit' || (!!s.project?.sheet && !s.project?.storyboard));
  return (
    <div className="studio">
      {!hasProject ? <Home /> : assembly ? <Editor /> : <div className="layout"><LeftPanel /><Stage /></div>}
    </div>
  );
}
