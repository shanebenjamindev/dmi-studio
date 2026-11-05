// English for the interface. Components keep their Vietnamese text; when English is chosen, what is drawn on screen
// (text, placeholders, tooltips, confirm boxes, messages from the server) is swapped for its English as it appears,
// from a dictionary loaded only then. The choice is kept with the account, like the theme.
import { remember, flushPrefs } from './prefs';
export type Lang = 'vi' | 'en';
const KEY = 'dms.lang';
const VI = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export function langPref(): Lang {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'vi'; } catch { return 'vi'; }
}
/** Switching reloads the page, so every screen is drawn again in the new language. */
export function setLang(lang: Lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* private mode: nothing to remember */ }
  remember(KEY, lang);
  void flushPrefs().finally(() => location.reload());
}

const exact = new Map<string, string>();
// Vietnamese written without accents ("Giao cho"): known by the whole text only.
const plain = new Set<string>();
const wanted = (s: string) => VI.test(s) || (plain.size > 0 && s.length < 40 && plain.has(s.trim()));
// A text built around values ("{0} công việc"): its fixed words, the longest of them to rule it out quickly.
let patterns: { re: RegExp; en: string; hint: string; fixed: number }[] = [];
const seen = new Map<string, string>();
const squash = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

function english(s: string): string | null {
  const key = squash(s);
  const hit = exact.get(key);
  if (hit !== undefined) return hit;
  for (const p of patterns) {
    if (!key.includes(p.hint)) continue;
    const m = p.re.exec(key);
    if (!m) continue;
    const values = m.slice(1);
    // A value is the user's data: Vietnamese words in it must be a known phrase, unless the fixed wording around it
    // is long enough that someone's own text would not match by chance.
    if (p.fixed < 12 && values.some((v) => VI.test(v) && !exact.has(squash(v)))) continue;
    return p.en.replace(/\{(\d+)\}/g, (_, i) => { const v = values[+i] ?? ''; return exact.get(squash(v)) ?? v; });
  }
  return null;
}

/** English for a piece of Vietnamese interface text (unchanged when unknown or in Vietnamese mode), outer spaces kept. */
export function tr(s: string): string {
  if (!exact.size || !wanted(s)) return s;
  let out = seen.get(s);
  if (out === undefined) {
    const en = english(s);
    out = en === null ? s : s.match(/^\s*/)![0] + en + s.match(/\s*$/)![0];
    if (seen.size < 20000) seen.set(s, out);
  }
  return out;
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
// What people type or write stays as written.
const OWN = 'textarea,[contenteditable=""],[contenteditable="true"],script,style,.no-i18n';
function text(n: Text) {
  const v = n.nodeValue;
  if (!v || !wanted(v) || n.parentElement?.closest(OWN)) return;
  const out = tr(v);
  if (out !== v) n.nodeValue = out;
}
function attrs(el: Element) {
  if (el.closest('.no-i18n')) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && wanted(v)) { const out = tr(v); if (out !== v) el.setAttribute(a, out); }
  }
  if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit') && VI.test(el.value)) el.value = tr(el.value);
}
function deep(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return text(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  attrs(root as Element);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) text(n as Text); else attrs(n as Element);
  }
}

/** Before the first render: in English, load the dictionary and translate everything drawn from then on. */
export async function initI18n() {
  const lang = langPref();
  document.documentElement.lang = lang;
  if (lang !== 'en') return;
  try {
    const dict = (await import('./i18n/en')).default;
    const list: typeof patterns = [];
    for (const [vi, en] of Object.entries(dict)) {
      if (!/\{\d+\}/.test(vi)) { exact.set(vi, en); if (!VI.test(vi)) plain.add(vi); continue; }
      const parts = vi.split(/\{\d+\}/), fixed = parts.join('').trim();
      if (!fixed) continue;
      const re = new RegExp('^' + parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]+?)') + '$');
      list.push({ re, en, hint: parts.reduce((a, b) => (b.trim().length > a.length ? b.trim() : a), ''), fixed: fixed.length });
    }
    patterns = list.sort((a, b) => b.fixed - a.fixed);
  } catch {
    return; // the dictionary could not load: the interface stays in Vietnamese
  }
  deep(document.documentElement);
  new MutationObserver((changes) => {
    for (const c of changes) {
      if (c.type === 'childList') c.addedNodes.forEach(deep);
      else if (c.type === 'characterData') text(c.target as Text);
      else attrs(c.target as Element);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const said = <F extends (message?: any, ...rest: any[]) => any>(f: F) =>
    ((message?: any, ...rest: any[]) => f.call(window, typeof message === 'string' ? tr(message) : message, ...rest)) as F;
  window.alert = said(window.alert);
  window.confirm = said(window.confirm);
  window.prompt = said(window.prompt);
}
