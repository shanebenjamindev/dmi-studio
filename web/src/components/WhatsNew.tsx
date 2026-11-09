// Có gì mới: what changed in DMI Workspace (web/src/updates.ts). Shown once after an update arrives; the last update
// seen is kept with the account, so the person's other devices do not show it again. The account menu opens the whole
// list at any time (openWhatsNew).
import { useEffect, useState } from 'react';
import { Sheet } from './Dialogs';
import { Icon } from './ui';
import { remember } from '../prefs';
import { langPref } from '../i18n';
import { UPDATES, type Update } from '../updates';

const SEEN = 'dms.seenUpdate';
const seen = () => { try { return localStorage.getItem(SEEN); } catch { return null; } };
/** Updates this account has not seen: those after the last one it saw (only the newest, for an account that saw none). */
const unseen = (): Update[] => {
  if (!UPDATES.length) return [];
  const last = seen(), at = UPDATES.findIndex((u) => u.id === last);
  return last === UPDATES[0].id ? [] : at > 0 ? UPDATES.slice(0, at) : [UPDATES[0]];
};
export const openWhatsNew = () => window.dispatchEvent(new Event('dms:whats-new'));

export function WhatsNew() {
  const [shown, setShown] = useState<Update[] | null>(null);
  useEffect(() => {
    // A moment after the page settles, so it does not land on top of the first paint.
    const t = setTimeout(() => { const fresh = unseen(); if (fresh.length) setShown(fresh); }, 1200);
    const all = () => setShown(UPDATES);
    window.addEventListener('dms:whats-new', all);
    return () => { clearTimeout(t); window.removeEventListener('dms:whats-new', all); };
  }, []);
  const close = () => {
    if (UPDATES[0]) { try { localStorage.setItem(SEEN, UPDATES[0].id); } catch { /* private mode */ } remember(SEEN, UPDATES[0].id); }
    setShown(null);
  };
  const en = langPref() === 'en';
  return (
    <Sheet open={!!shown} onClose={close} title="Có gì mới trong DMI Workspace" footer={<button className="btn btn-primary" type="button" onClick={close}>Đã hiểu</button>}>
      <div className="wn-body">
        {(shown || []).map((u) => (
          <section key={u.id} className="wn-update">
            <h3>{u.date}</h3>
            {(['new', 'fix'] as const).map((kind) => {
              const items = u.items.filter((i) => i.kind === kind);
              return items.length ? (
                <div key={kind} className={'wn-group ' + kind}>
                  <h4><Icon name={kind === 'new' ? 'sparkle' : 'check'} size={14} />{kind === 'new' ? 'Mới' : 'Đã sửa'}</h4>
                  <ul>{items.map((i, k) => <li key={k} className="no-i18n">{en ? i.en : i.vi}</li>)}</ul>
                </div>
              ) : null;
            })}
          </section>
        ))}
      </div>
    </Sheet>
  );
}
