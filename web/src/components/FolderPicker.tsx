// Pick where videos live: a Google account (My Drive / shared drive, via "Sign in with Google") or a folder on this Mac.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Sheet } from './Dialogs';
import { Icon, IconButton } from './ui';
import type { DrivePlace, FolderListing, Loc } from '../types';

/** Lowercase without Vietnamese marks, so “edward”, “OCD” or “dong” find their folders. */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const VIA: Record<DrivePlace['via'], string> = { google: 'Đăng nhập Google', desktop: 'Qua app Drive trên máy', local: 'Không đồng bộ' };
/** Which place a listing belongs to: same account/source and same root crumb. */
const inPlace = (cur: FolderListing | null, p: DrivePlace) => {
  if (!cur) return false;
  const root = cur.crumbs[0]?.loc;
  if (p.loc.kind === 'fs') return root?.kind === 'fs' && root.dir === p.loc.dir;
  if (cur.loc.kind !== 'gdrive' || cur.account !== p.account) return false;
  return p.loc.id === 'root' ? cur.crumbs[0]?.name === 'My Drive' : root?.kind === 'gdrive' && root.id === p.loc.id;
};

export function FolderPicker({ open, title, start, confirmLabel, onClose, onPick, onAddAccount }: {
  open: boolean; title: string; start?: Loc | null; confirmLabel: string; onClose: () => void;
  onPick: (loc: Loc) => Promise<void> | void; onAddAccount?: () => void;
}) {
  const [places, setPlaces] = useState<DrivePlace[]>([]);
  const [cur, setCur] = useState<FolderListing | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  // Finds a folder among the open folder's sub-folders by name (long client lists).
  const [q, setQ] = useState('');

  const go = (loc: Loc) => { setLoading(true); setQ(''); return api.browse(loc).then(setCur).catch((e) => toast(e.message, true)).finally(() => setLoading(false)); };
  useEffect(() => {
    if (!open) return;
    setNewName(null);
    api.drivePlaces().then((p) => {
      setPlaces(p);
      // Open at the current folder when it can be browsed, else at the first place (a signed-in Google account first).
      (start ? api.browse(start).catch(() => null) : Promise.resolve(null)).then((l) => (l ? setCur(l) : p[0] && go(p[0].loc)));
    }).catch((e) => toast(e.message, true));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups: { key: string; account: string | null; via: DrivePlace['via']; items: DrivePlace[] }[] = [];
  for (const p of places) {
    const key = `${p.via}|${p.account}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, account: p.account, via: p.via, items: [] }));
    g.items.push(p);
  }
  const mkdir = async () => {
    if (!cur || !newName?.trim()) return;
    try { const f = await api.makeFolder(cur.loc, newName.trim()); setNewName(null); await go(f.loc); }
    catch (e: any) { toast(e.message, true); }
  };
  const pick = async () => {
    if (!cur) return;
    setBusy(true);
    try { await onPick(cur.loc); onClose(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const path = cur ? cur.crumbs.map((c) => c.name).join(' › ') : '';
  // Every word must appear, in any order and in any part of the name (“OCD Auto Care | Carlos”: “carlos ocd”).
  // Punctuation does not count either (“ocd” finds “O.C.D Mobile”).
  const flat = (s: string) => s.replace(/[^a-z0-9]+/g, '');
  const words = fold(q).split(/[\s|,/·-]+/).filter(Boolean);
  const shown = (cur?.dirs || []).filter((d) => { const name = fold(d.name); return words.every((w) => name.includes(w) || (!!flat(w) && flat(name).includes(flat(w)))); });

  return (
    <Sheet open={open} onClose={onClose} title={title} wide footer={<>
      <span className="fp-sel" title={path}>{cur ? `${cur.account ? cur.account + ' · ' : ''}${path}` : ''}</span>
      <button className="btn btn-gray" onClick={onClose}>Huỷ</button>
      <button className="btn btn-primary" disabled={!cur || busy || loading} onClick={pick}>{confirmLabel}</button>
    </>}>
      <div className="fp">
        <nav className="fp-places">
          {groups.map((g) => (
            <div key={g.key} className="fp-group">
              <span className="fp-acc">{g.via === 'google' && <Icon name="check" size={11} />}{g.account || VIA[g.via]}</span>
              {g.account && <span className="fp-via">{VIA[g.via]}</span>}
              {g.items.map((p) => (
                <button key={JSON.stringify(p.loc)} className={'fp-place' + (inPlace(cur, p) ? ' on' : '')} onClick={() => go(p.loc)}>
                  <Icon name={p.kind === 'shared' ? 'layers' : p.kind === 'local' ? 'folder' : 'share'} size={15} />{p.label}
                </button>
              ))}
            </div>
          ))}
          {onAddAccount && (
            <div className="fp-group fp-add">
              <button className="fp-place" onClick={onAddAccount}><Icon name="plus" size={15} />Kết nối tài khoản Google</button>
            </div>
          )}
        </nav>
        <section className="fp-main">
          <div className="fp-crumbs">
            {cur?.crumbs.map((c, i) => (
              <span key={JSON.stringify(c.loc)}>{i > 0 && <em>›</em>}<button className="link" onClick={() => go(c.loc)}>{c.name}</button></span>
            ))}
            <IconButton icon="plus" label="Thư mục mới" size={15} onClick={() => setNewName('')} />
          </div>
          {newName !== null && (
            <form className="ws-add fp-new" onSubmit={(e) => { e.preventDefault(); mkdir(); }}>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Tên thư mục mới" onKeyDown={(e) => e.key === 'Escape' && setNewName(null)} />
              <button className="btn btn-primary btn-sm" disabled={!newName.trim()}>Tạo</button>
            </form>
          )}
          {!!cur?.dirs.length && (
            <label className="fp-search">
              <Icon name="search" size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm thư mục: tên doanh nghiệp, tên người, nhiều từ…" aria-label="Tìm thư mục trong mục này"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && shown[0]) { e.preventDefault(); void go(shown[0].loc); }
                  if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ(''); }
                }} />
              {q && <small>{shown.length}/{cur.dirs.length}</small>}
              {q && <button type="button" className="fp-search-x" onClick={() => setQ('')} aria-label="Xoá tìm kiếm"><Icon name="x" size={12} /></button>}
            </label>
          )}
          <div className={'fp-list' + (loading ? ' loading' : '')}>
            {cur && !loading && !cur.dirs.length && <p className="empty-note">Không có thư mục con. Chọn thư mục này hoặc tạo thư mục mới.</p>}
            {cur && !loading && !!cur.dirs.length && !shown.length && <p className="empty-note">Không có thư mục nào tên có “{q.trim()}” trong mục này.</p>}
            {shown.map((d) => (
              <button key={JSON.stringify(d.loc)} className="fp-dir" onClick={() => go(d.loc)}>
                <Icon name="folder" size={16} /><span>{d.name}</span><Icon name="chevron" size={13} className="fp-chev" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </Sheet>
  );
}
