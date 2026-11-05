// Light / dark / follow-the-device theme. The choice is remembered per browser and applied before the first paint
// as <html data-theme="light|dark">; every colour in styles.css reads from variables keyed on it.
export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'dms.theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

export function themePref(): ThemePref {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' || v === 'system' ? v : 'light'; } catch { return 'light'; }
}
function apply() {
  const pref = themePref();
  const dark = pref === 'dark' || (pref === 'system' && !!media?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  listeners.forEach((f) => f());
}
export function setThemePref(p: ThemePref) {
  try { localStorage.setItem(KEY,p); } catch { /* private mode: this tab only */ }
  apply();
}
export function onTheme(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export function initTheme() {
  apply();
  media?.addEventListener('change', () => { if (themePref() === 'system') apply(); });
}
