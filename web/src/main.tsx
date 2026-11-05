import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { initTheme } from './theme';
import { initI18n } from './i18n';

initTheme();

// In English, the dictionary is in place before anything is drawn.
initI18n().finally(() => createRoot(document.getElementById('root')!).render(<App />));
