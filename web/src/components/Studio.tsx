import { useStore } from '../store';
import { Home } from './Home';
import { Editor } from './Editor';

/** The editor page: the project list, and a project opened in the HyperFrames editor (built with Claude Code). */
export function Studio() {
  const hasProject = useStore((s) => !!s.project);
  return <div className="studio">{hasProject ? <Editor /> : <Home />}</div>;
}
