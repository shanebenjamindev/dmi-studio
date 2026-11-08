import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { initTheme } from './theme';
import { initI18n } from './i18n';
import { getState } from './store';
import { preloadView } from './pages';

initTheme();
// The page the address opens downloads while the session and the dictionary are fetched.
preloadView(getState().view);

// In English, the dictionary is in place before anything is drawn.
initI18n().finally(() => createRoot(document.getElementById('root')!).render(<App />));
