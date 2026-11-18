// Cài đặt máy chủ of Tin nhắn, as Discord's server settings: its roles (name, colour, order, permissions), who has which
// role, and each channel's permissions per role (a private channel). The server checks every change
// (server/chat-perms.ts); this window is shown to whoever may manage roles.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import type { ChatPerm, ChatRole } from '../types';
import { askConfirm } from './AskDialog';
import { Avatar } from './boardkit';
import { Icon } from './ui';

type Tab = 'roles' | 'members' | 'channels';
export interface SettingsChannel { id: string; name: string; category: string }

const PERM_INFO: [ChatPerm, string, string][] = [
  ['view', 'Xem kênh', 'Thấy kênh và đọc tin nhắn, file trong kênh.'],
  ['send', 'Gửi tin nhắn', 'Viết tin nhắn trong kênh.'],
  ['attach', 'Gửi file', 'Đính kèm file, tải file lên thư mục của kênh.'],
  ['manage_messages', 'Quản lý tin nhắn', 'Ghim, xoá tin nhắn và file của người khác, xoá lịch sử kênh.'],
  ['manage_channels', 'Quản lý kênh', 'Tạo và xoá kênh.'],
  ['manage_roles', 'Quản lý role', 'Mở Cài đặt máy chủ: tạo role, gán role, chỉnh quyền kênh.'],
  ['admin', 'Quản trị viên', 'Có mọi quyền, xem được mọi kênh. Chỉ cấp cho người thật sự tin cậy.'],
];
const CHANNEL_PERMS = PERM_INFO.filter(([p]) => p !== 'admin' && p !== 'manage_roles' && p !== 'manage_channels');
const COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b'];

export function ServerSettings({ server, title, channels, startChannel, onClose, onChanged }: {
  server: string; title: string; channels: SettingsChannel[]; startChannel?: string; onClose: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>(startChannel ? 'channels' : 'roles');
  const [roles, setRoles] = useState<ChatRole[]>([]);
  const [held, setHeld] = useState<Record<string, string[]>>({});
  const load = () => api.chatRoles(server).then((r) => { setRoles(r.roles); setHeld(r.members); }, (e) => toast(e.message, true));
  useEffect(() => { void load(); }, [server]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const changed = () => { void load(); onChanged(); };
  return (
    <div className="ss-page" role="dialog" aria-label={`Cài đặt máy chủ ${title}`}>
      <nav className="ss-nav">
        <h3>{title}</h3>
        {([['roles', 'Vai trò', 'badge'], ['members', 'Thành viên', 'users'], ['channels', 'Quyền kênh', 'lock']] as [Tab, string, string][]).map(([id, label, icon]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon name={icon} size={16} />{label}</button>
        ))}
      </nav>
      <main className="ss-main">
        <button className="ss-close" onClick={onClose} aria-label="Đóng cài đặt" title="Đóng (Esc)"><Icon name="x" size={18} /><small>ESC</small></button>
        {tab === 'roles' && <Roles server={server} roles={roles} setRoles={setRoles} onChanged={changed} />}
        {tab === 'members' && <Members server={server} roles={roles} held={held} setHeld={setHeld} onChanged={onChanged} />}
        {tab === 'channels' && <ChannelPerms channels={channels} roles={roles} start={startChannel} onChanged={onChanged} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- Vai trò
function Roles({ server, roles, setRoles, onChanged }: { server: string; roles: ChatRole[]; setRoles: (r: ChatRole[]) => void; onChanged: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const role = roles.find((r) => r.id === pick) || roles[0];
  const own = roles.filter((r) => !r.everyone);
  const save = async (r: ChatRole, b: Partial<{ name: string; color: string; perms: ChatPerm[] }>) => {
    setRoles(roles.map((x) => (x.id === r.id ? { ...x, ...b } : x)));
    try { await api.updateChatRole(server, r.id, b); onChanged(); } catch (e: any) { toast(e.message, true); onChanged(); }
  };
  const add = async () => {
    try { const r = await api.createChatRole(server, { name: 'Role mới', color: COLORS[own.length % COLORS.length] }); setPick(r.id); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const move = async (r: ChatRole, d: -1 | 1) => {
    const ids = own.map((x) => x.id), i = ids.indexOf(r.id), j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setRoles([...ids.map((id) => own.find((x) => x.id === id)!), ...roles.filter((x) => x.everyone)]);
    try { await api.orderChatRoles(server, ids); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const remove = async (r: ChatRole) => {
    if (!(await askConfirm(`Xoá role “${r.name}”? ${r.members} người đang có role này sẽ mất nó.`))) return;
    try { await api.deleteChatRole(server, r.id); setPick(null); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="ss-split">
      <div className="ss-list">
        <div className="ss-head"><h2>Vai trò</h2><button className="btn btn-primary btn-sm" onClick={add}><Icon name="plus" size={14} />Tạo role</button></div>
        <p className="ss-hint">Role cao hơn đứng trên. Mọi người trong máy chủ đều có @everyone.</p>
        {roles.map((r) => (
          <div key={r.id} className={`ss-role${role?.id === r.id ? ' on' : ''}`}>
            <button className="ss-role-main" onClick={() => setPick(r.id)}>
              <i style={{ background: r.color || 'var(--label-3)' }} />
              <b>{r.name}</b>
              {!r.everyone && <small>{r.members} người</small>}
            </button>
            {!r.everyone && <span className="ss-role-move">
              <button onClick={() => move(r, -1)} aria-label="Lên" title="Lên trên"><Icon name="up" size={13} /></button>
              <button onClick={() => move(r, 1)} aria-label="Xuống" title="Xuống dưới"><Icon name="down" size={13} /></button>
            </span>}
          </div>
        ))}
      </div>
      {role && (
        <div className="ss-edit" key={role.id}>
          <div className="ss-head"><h2>Sửa role — {role.name}</h2>{!role.everyone && <button className="btn btn-gray btn-sm ss-danger" onClick={() => remove(role)}><Icon name="trash" size={14} />Xoá role</button>}</div>
          {!role.everyone && <>
            <label className="ss-field">Tên role<input className="bk-in" defaultValue={role.name} maxLength={40} onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== role.name) void save(role, { name: n }); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
            <div className="ss-field">Màu
              <div className="ss-colors">
                <button className={`ss-color none${!role.color ? ' on' : ''}`} onClick={() => save(role, { color: '' })} title="Không màu" />
                {COLORS.map((c) => <button key={c} className={`ss-color${role.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => save(role, { color: c })} aria-label={c} />)}
                <input type="color" value={role.color || '#99aab5'} onChange={(e) => save(role, { color: e.target.value })} title="Màu khác" />
              </div>
            </div>
          </>}
          <h4 className="ss-sub">Quyền {role.everyone ? 'của mọi người' : 'của role'}</h4>
          {PERM_INFO.map(([p, label, about]) => (
            <label key={p} className="ss-perm">
              <span><b>{label}</b><small>{about}</small></span>
              <input type="checkbox" className="ss-switch" checked={role.perms.includes(p)} onChange={(e) => save(role, { perms: e.target.checked ? [...role.perms, p] : role.perms.filter((x) => x !== p) })} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Thành viên
function Members({ server, roles, held, setHeld, onChanged }: { server: string; roles: ChatRole[]; held: Record<string, string[]>; setHeld: (h: Record<string, string[]>) => void; onChanged: () => void }) {
  const [people, setPeople] = useState<{ id: string; name: string; email: string }[]>([]);
  const [q, setQ] = useState(''), [open, setOpen] = useState<string | null>(null);
  useEffect(() => { api.chatServerMembers(server).then(setPeople, (e) => toast(e.message, true)); }, [server]);
  const own = roles.filter((r) => !r.everyone);
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const shown = useMemo(() => people.filter((p) => !q || fold(p.name + ' ' + p.email).includes(fold(q))), [people, q]);
  const set = async (userId: string, ids: string[]) => {
    setHeld({ ...held, [userId]: ids });
    try { await api.setChatMemberRoles(server, userId, ids); onChanged(); } catch (e: any) { toast(e.message, true); onChanged(); }
  };
  return (
    <div className="ss-members">
      <div className="ss-head"><h2>Thành viên <small>{people.length}</small></h2><input className="bk-in ss-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm thành viên…" /></div>
      {!own.length && <p className="ss-hint">Chưa có role nào. Tạo role ở mục Vai trò rồi gán cho thành viên tại đây.</p>}
      {shown.map((p) => {
        const mine = held[p.id] || [];
        return (
          <div key={p.id} className="ss-member">
            <Avatar m={{ id: p.id, userId: p.id, name: p.name }} size={32} />
            <span className="ss-member-name"><b>{p.name}</b><small>{p.email}</small></span>
            <span className="ss-chips">
              {own.filter((r) => mine.includes(r.id)).map((r) => (
                <span key={r.id} className="ss-chip"><i style={{ background: r.color || 'var(--label-3)' }} />{r.name}
                  <button onClick={() => set(p.id, mine.filter((x) => x !== r.id))} aria-label={`Bỏ role ${r.name}`}><Icon name="x" size={11} /></button></span>
              ))}
              {own.length > 0 && <span className="ss-add-wrap">
                <button className="ss-add" onClick={() => setOpen(open === p.id ? null : p.id)} aria-label="Thêm role" title="Thêm role"><Icon name="plus" size={13} /></button>
                {open === p.id && (
                  <div className="ss-pop" onMouseLeave={() => setOpen(null)}>
                    {own.map((r) => (
                      <label key={r.id}><input type="checkbox" checked={mine.includes(r.id)} onChange={(e) => set(p.id, e.target.checked ? [...mine, r.id] : mine.filter((x) => x !== r.id))} />
                        <i style={{ background: r.color || 'var(--label-3)' }} />{r.name}</label>
                    ))}
                  </div>
                )}
              </span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Quyền kênh
type Over = Record<string, { allow: ChatPerm[]; deny: ChatPerm[] }>;
function ChannelPerms({ channels, roles, start, onChanged }: { channels: SettingsChannel[]; roles: ChatRole[]; start?: string; onChanged: () => void }) {
  const [ch, setCh] = useState(start || channels[0]?.id || '');
  const [over, setOver] = useState<Over>({});
  const [roleId, setRoleId] = useState<string | null>(null);
  useEffect(() => {
    if (!ch) return;
    api.channelPerms(ch).then((rows) => setOver(Object.fromEntries(rows.map((r) => [r.roleId, { allow: r.allow, deny: r.deny }]))), (e) => toast(e.message, true));
  }, [ch]);
  const everyone = roles.find((r) => r.everyone);
  const role = roles.find((r) => r.id === roleId) || everyone;
  const priv = !!everyone && !!over[everyone.id]?.deny.includes('view');
  const put = async (rid: string, allow: ChatPerm[], deny: ChatPerm[]) => {
    setOver({ ...over, [rid]: { allow, deny } });
    try { await api.setChannelPerm(ch, rid, allow, deny); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const setState = (rid: string, p: ChatPerm, state: 'allow' | 'inherit' | 'deny') => {
    const o = over[rid] || { allow: [], deny: [] };
    const allow = o.allow.filter((x) => x !== p), deny = o.deny.filter((x) => x !== p);
    void put(rid, state === 'allow' ? [...allow, p] : allow, state === 'deny' ? [...deny, p] : deny);
  };
  const togglePrivate = () => {
    if (everyone) setState(everyone.id, 'view', priv ? 'inherit' : 'deny');
  };
  const viewers = roles.filter((r) => !r.everyone && over[r.id]?.allow.includes('view'));
  const byCat = channels.reduce<Record<string, SettingsChannel[]>>((m, c) => ((m[c.category] ||= []).push(c), m), {});
  return (
    <div className="ss-split">
      <div className="ss-list">
        <div className="ss-head"><h2>Quyền kênh</h2></div>
        {Object.entries(byCat).map(([cat, list]) => (
          <div key={cat} className="ss-cat"><small>{cat}</small>
            {list.map((c) => <button key={c.id} className={`ss-chan${ch === c.id ? ' on' : ''}`} onClick={() => { setCh(c.id); setRoleId(null); }}><span>#</span>{c.name}</button>)}
          </div>
        ))}
      </div>
      {ch && everyone && (
        <div className="ss-edit">
          <div className="ss-head"><h2>#{channels.find((c) => c.id === ch)?.name}</h2></div>
          <label className="ss-perm ss-private">
            <span><b><Icon name="lock" size={14} /> Kênh riêng tư</b><small>Chỉ các role được chọn bên dưới (và quản trị viên) thấy kênh này.</small></span>
            <input type="checkbox" className="ss-switch" checked={priv} onChange={togglePrivate} />
          </label>
          {priv && (
            <div className="ss-field">Ai được xem kênh
              <div className="ss-chips wrap">
                {roles.filter((r) => !r.everyone).map((r) => {
                  const on = viewers.some((v) => v.id === r.id);
                  return <button key={r.id} className={`ss-chip pick${on ? ' on' : ''}`} onClick={() => setState(r.id, 'view', on ? 'inherit' : 'allow')}><i style={{ background: r.color || 'var(--label-3)' }} />{r.name}{on && <Icon name="check" size={12} />}</button>;
                })}
                {roles.length <= 1 && <span className="ss-hint">Tạo role ở mục Vai trò trước.</span>}
              </div>
            </div>
          )}
          <h4 className="ss-sub">Quyền chi tiết theo role</h4>
          <div className="ss-chips wrap">
            {roles.map((r) => <button key={r.id} className={`ss-chip pick${role?.id === r.id ? ' on' : ''}`} onClick={() => setRoleId(r.id)}><i style={{ background: r.color || 'var(--label-3)' }} />{r.name}{over[r.id] && <em>•</em>}</button>)}
          </div>
          {role && CHANNEL_PERMS.map(([p, label, about]) => {
            const o = over[role.id], state = o?.allow.includes(p) ? 'allow' : o?.deny.includes(p) ? 'deny' : 'inherit';
            return (
              <div key={p} className="ss-perm">
                <span><b>{label}</b><small>{about}</small></span>
                <span className="ss-tri" role="radiogroup" aria-label={label}>
                  <button className={`deny${state === 'deny' ? ' on' : ''}`} onClick={() => setState(role.id, p, 'deny')} title="Chặn" aria-label="Chặn"><Icon name="x" size={14} /></button>
                  <button className={`inherit${state === 'inherit' ? ' on' : ''}`} onClick={() => setState(role.id, p, 'inherit')} title="Theo role" aria-label="Theo role">/</button>
                  <button className={`allow${state === 'allow' ? ' on' : ''}`} onClick={() => setState(role.id, p, 'allow')} title="Cho phép" aria-label="Cho phép"><Icon name="check" size={14} /></button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
