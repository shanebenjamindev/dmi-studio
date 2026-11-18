// Chỉnh sửa kênh, as Discord's channel settings, for who manages Tin nhắn: its name, topic and category (and deleting
// it), and its permissions: who sees it (a private channel) and who writes in it (the others only read), picked among
// the site's departments, roles and people (server/chat-perms.ts).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import type { ChannelRules, ChatChannel } from '../types';
import { askConfirm } from './AskDialog';
import { Icon } from './ui';

type Options = { people: { id: string; name: string; email: string }[]; departments: { id: string; name: string; color: string }[]; roles: { id: string; name: string }[] };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

export function ChannelSettings({ channel, categories, startTab = 'overview', onClose, onSaved, onDeleted }: {
  channel: ChatChannel; categories: string[]; startTab?: 'overview' | 'perms'; onClose: () => void; onSaved: () => void; onDeleted: () => void;
}) {
  const [tab, setTab] = useState(startTab);
  const [name, setName] = useState(channel.name), [topic, setTopic] = useState(channel.topic), [category, setCategory] = useState(channel.category);
  const [rules, setRules] = useState<ChannelRules | null>(null), [options, setOptions] = useState<Options | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.channelRules(channel.id).then(({ options: o, ...r }) => { setRules(r); setOptions(o); }, (e) => toast(e.message, true));
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [channel.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    try {
      await api.updateChatChannel(channel.id, { name, topic, category });
      if (rules) await api.setChannelRules(channel.id, rules);
      toast('Đã lưu kênh'); onSaved(); onClose();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await askConfirm(`Xoá kênh #${channel.name} cùng mọi tin nhắn và file trong kênh? Không khôi phục được.`))) return;
    try { await api.deleteChatChannel(channel.id); toast(`Đã xoá kênh #${channel.name}`); onDeleted(); onClose(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="cs-box" role="dialog" aria-label={`Chỉnh sửa kênh #${channel.name}`}>
        <header className="cs-head">
          <b><Icon name={channel.private ? 'lock' : 'chat'} size={16} /> #{channel.name}</b>
          <button className="bd-icon" onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button>
        </header>
        <nav className="cs-tabs">
          <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>Tổng quan</button>
          <button className={tab === 'perms' ? 'on' : ''} onClick={() => setTab('perms')}>Quyền</button>
        </nav>
        <div className="cs-body">
          {tab === 'overview' ? (
            <>
              <label className="cs-field">Tên kênh<input className="bk-in" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} /></label>
              <label className="cs-field">Chủ đề<textarea className="bk-in" rows={3} maxLength={200} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Kênh này dùng để trao đổi việc gì…" /></label>
              <label className="cs-field">Danh mục
                <input className="bk-in" list="cs-cats" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} />
                <datalist id="cs-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              {channel.id !== 'general' && (
                <div className="cs-danger">
                  <span><b>Xoá kênh</b><small>Xoá kênh cùng mọi tin nhắn và file trong kênh.</small></span>
                  <button className="btn btn-gray btn-sm" onClick={() => void remove()}><Icon name="trash" size={14} />Xoá kênh</button>
                </div>
              )}
            </>
          ) : !rules || !options ? <p className="note">Đang tải…</p> : (
            <>
              <Rule title="Ai xem được kênh" all="Mọi người trong máy chủ" some="Chỉ những người được chọn (kênh riêng tư)"
                value={rules.view} options={options} onChange={(view) => setRules({ ...rules, view })} />
              <Rule title="Ai được nhắn trong kênh" all="Mọi người xem được kênh" some="Chỉ những người được chọn (người khác chỉ đọc)"
                value={rules.send} options={options} onChange={(send) => setRules({ ...rules, send })} />
              <p className="note">Người quản lý Tin nhắn (Quản trị › Phân quyền) luôn xem và nhắn được trong mọi kênh.</p>
            </>
          )}
        </div>
        <footer className="cs-foot">
          <button className="btn btn-gray" disabled={busy} onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
        </footer>
      </div>
    </div>
  );
}

/** Everyone, or the departments, roles and people picked. */
function Rule({ title, all, some, value, options, onChange }: {
  title: string; all: string; some: string; value: ChannelRules['view']; options: Options; onChange: (v: ChannelRules['view']) => void;
}) {
  const [q, setQ] = useState('');
  const items = useMemo(() => [
    ...options.departments.map((d) => ({ tag: `d:${d.id}`, label: d.name, kind: 'Phòng ban', color: d.color })),
    ...options.roles.map((r) => ({ tag: `r:${r.id}`, label: r.name, kind: 'Vai trò', color: '' })),
    ...options.people.map((p) => ({ tag: `u:${p.id}`, label: p.name, kind: 'Nhân viên', color: '', sub: p.email })),
  ], [options]);
  const label = new Map(items.map((i) => [i.tag, i]));
  const found = q.trim() ? items.filter((i) => !value.who.includes(i.tag) && fold(`${i.label} ${(i as any).sub || ''}`).includes(fold(q))).slice(0, 8) : [];
  const toggle = (tag: string) => onChange({ all: false, who: value.who.includes(tag) ? value.who.filter((t) => t !== tag) : [...value.who, tag] });
  return (
    <section className="cs-rule">
      <h4>{title}</h4>
      <label className="cs-radio"><input type="radio" checked={value.all} onChange={() => onChange({ all: true, who: value.who })} />{all}</label>
      <label className="cs-radio"><input type="radio" checked={!value.all} onChange={() => onChange({ all: false, who: value.who })} />{some}</label>
      {!value.all && (
        <div className="cs-pick">
          <div className="cs-chips">
            {value.who.map((t) => { const i = label.get(t); return i && (
              <span key={t} className="cs-chip"><em>{i.kind}</em>{i.color && <i style={{ background: i.color }} />}{i.label}
                <button onClick={() => toggle(t)} aria-label={`Bỏ ${i.label}`}><Icon name="x" size={11} /></button></span>
            ); })}
            {!value.who.length && <small>Chưa chọn ai: chỉ người quản lý Tin nhắn.</small>}
          </div>
          <input className="bk-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm phòng ban, vai trò hoặc nhân viên…" />
          {found.length > 0 && <ul className="cs-found">{found.map((i) => (
            <li key={i.tag}><button onClick={() => { toggle(i.tag); setQ(''); }}><em>{i.kind}</em>{i.color && <i style={{ background: i.color }} />}<b>{i.label}</b>{(i as any).sub && <small>{(i as any).sub}</small>}</button></li>
          ))}</ul>}
        </div>
      )}
    </section>
  );
}
