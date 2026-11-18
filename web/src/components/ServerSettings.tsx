// Cài đặt máy chủ of Tin nhắn, as Discord's server settings: the server's own roles (name, colour, order, what they add:
// Nhắn tin and Quản lý), who holds which, and each channel's permissions (who sees it, who writes in it), which pick
// these roles beside the site's departments, roles and people. The server checks every change (server/chat-roles.ts);
// this window is for who manages Tin nhắn in the server.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import type { ChatChannel, ChatRole, ChatRolePerm } from '../types';
import { askConfirm } from './AskDialog';
import { Avatar } from './boardkit';
import { Icon } from './ui';

type Tab = 'roles' | 'members' | 'channels';
const PERM_INFO: [ChatRolePerm, string, string][] = [
  ['send', 'Nhắn tin', 'Gửi tin nhắn và file trong máy chủ, kể cả khi vai trò website không có quyền Nhắn tin. Kênh chỉ đọc vẫn theo quyền của kênh.'],
  ['manage', 'Quản lý Tin nhắn', 'Tạo, sửa, xoá kênh và quyền kênh; ghim, xoá tin của người khác; mở Cài đặt máy chủ này (tạo và gán role).'],
];
const COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b'];
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

export function ServerSettings({ server, title, channels, onClose, onChanged, onChannel }: {
  server: string; title: string; channels: ChatChannel[]; onClose: () => void; onChanged: () => void; onChannel: (ch: ChatChannel) => void;
}) {
  const [tab, setTab] = useState<Tab>('roles');
  const [roles, setRoles] = useState<ChatRole[]>([]);
  const [held, setHeld] = useState<Record<string, string[]>>({});
  const load = () => api.chatRoles(server).then((r) => { setRoles(r.roles); setHeld(r.members); }, (e) => toast(e.message, true));
  useEffect(() => { void load(); }, [server]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.bd-modal')) onClose(); };
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
        {tab === 'members' && <Members server={server} roles={roles} held={held} setHeld={setHeld} onChanged={changed} />}
        {tab === 'channels' && <Channels channels={channels} onChannel={onChannel} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- Vai trò
function Roles({ server, roles, setRoles, onChanged }: { server: string; roles: ChatRole[]; setRoles: (r: ChatRole[]) => void; onChanged: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const role = roles.find((r) => r.id === pick) || roles[0];
  const save = async (r: ChatRole, b: Partial<{ name: string; color: string; perms: ChatRolePerm[] }>) => {
    setRoles(roles.map((x) => (x.id === r.id ? { ...x, ...b } : x)));
    try { await api.updateChatRole(server, r.id, b); onChanged(); } catch (e: any) { toast(e.message, true); onChanged(); }
  };
  const add = async () => {
    try { const r = await api.createChatRole(server, { name: 'Role mới', color: COLORS[roles.length % COLORS.length] }); setPick(r.id); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const move = async (r: ChatRole, d: -1 | 1) => {
    const ids = roles.map((x) => x.id), i = ids.indexOf(r.id), j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setRoles(ids.map((id) => roles.find((x) => x.id === id)!));
    try { await api.orderChatRoles(server, ids); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const remove = async (r: ChatRole) => {
    if (!(await askConfirm(`Xoá role “${r.name}”? ${r.members} người đang có role này sẽ mất nó, và kênh chọn role này sẽ không còn tính role đó.`))) return;
    try { await api.deleteChatRole(server, r.id); setPick(null); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="ss-split">
      <div className="ss-list">
        <div className="ss-head"><h2>Vai trò</h2><button className="btn btn-primary btn-sm" onClick={add}><Icon name="plus" size={14} />Tạo role</button></div>
        <p className="ss-hint">Role cao hơn đứng trên; tên trong chat mang màu của role cao nhất. Ai cũng có quyền theo Quản trị › Phân quyền, role chỉ thêm vào.</p>
        {roles.map((r) => (
          <div key={r.id} className={`ss-role${role?.id === r.id ? ' on' : ''}`}>
            <button className="ss-role-main" onClick={() => setPick(r.id)}>
              <i style={{ background: r.color || 'var(--label-3)' }} />
              <b>{r.name}</b>
              <small>{r.members} người</small>
            </button>
            <span className="ss-role-move">
              <button onClick={() => move(r, -1)} aria-label="Lên" title="Lên trên"><Icon name="up" size={13} /></button>
              <button onClick={() => move(r, 1)} aria-label="Xuống" title="Xuống dưới"><Icon name="down" size={13} /></button>
            </span>
          </div>
        ))}
        {!roles.length && <p className="ss-hint">Chưa có role nào.</p>}
      </div>
      {role && (
        <div className="ss-edit" key={role.id}>
          <div className="ss-head"><h2>Sửa role — {role.name}</h2><button className="btn btn-gray btn-sm ss-danger" onClick={() => remove(role)}><Icon name="trash" size={14} />Xoá role</button></div>
          <label className="ss-field">Tên role<input className="bk-in" defaultValue={role.name} maxLength={40} onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== role.name) void save(role, { name: n }); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
          <div className="ss-field">Màu
            <div className="ss-colors">
              <button className={`ss-color none${!role.color ? ' on' : ''}`} onClick={() => save(role, { color: '' })} title="Không màu" />
              {COLORS.map((c) => <button key={c} className={`ss-color${role.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => save(role, { color: c })} aria-label={c} />)}
              <input type="color" value={role.color || '#99aab5'} onChange={(e) => save(role, { color: e.target.value })} title="Màu khác" />
            </div>
          </div>
          <h4 className="ss-sub">Quyền của role</h4>
          {PERM_INFO.map(([p, label, about]) => (
            <label key={p} className="ss-perm">
              <span><b>{label}</b><small>{about}</small></span>
              <input type="checkbox" className="ss-switch" checked={role.perms.includes(p)} onChange={(e) => save(role, { perms: e.target.checked ? [...role.perms, p] : role.perms.filter((x) => x !== p) })} />
            </label>
          ))}
          <p className="ss-hint">Muốn role này có kênh riêng hoặc là người duy nhất được nhắn trong một kênh: mục Quyền kênh, chọn kênh rồi chọn role.</p>
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
  const shown = useMemo(() => people.filter((p) => !q || fold(p.name + ' ' + p.email).includes(fold(q))), [people, q]);
  const set = async (userId: string, ids: string[]) => {
    setHeld({ ...held, [userId]: ids });
    try { await api.setChatMemberRoles(server, userId, ids); onChanged(); } catch (e: any) { toast(e.message, true); onChanged(); }
  };
  return (
    <div className="ss-members">
      <div className="ss-head"><h2>Thành viên <small>{people.length}</small></h2><input className="bk-in ss-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm thành viên…" /></div>
      {!roles.length && <p className="ss-hint">Chưa có role nào. Tạo role ở mục Vai trò rồi gán cho thành viên tại đây.</p>}
      {shown.map((p) => {
        const mine = held[p.id] || [];
        return (
          <div key={p.id} className="ss-member">
            <Avatar m={{ id: p.id, userId: p.id, name: p.name }} size={32} />
            <span className="ss-member-name"><b>{p.name}</b><small>{p.email}</small></span>
            <span className="ss-chips">
              {roles.filter((r) => mine.includes(r.id)).map((r) => (
                <span key={r.id} className="ss-chip"><i style={{ background: r.color || 'var(--label-3)' }} />{r.name}
                  <button onClick={() => set(p.id, mine.filter((x) => x !== r.id))} aria-label={`Bỏ role ${r.name}`}><Icon name="x" size={11} /></button></span>
              ))}
              {roles.length > 0 && <span className="ss-add-wrap">
                <button className="ss-add" onClick={() => setOpen(open === p.id ? null : p.id)} aria-label="Thêm role" title="Thêm role"><Icon name="plus" size={13} /></button>
                {open === p.id && (
                  <div className="ss-pop" onMouseLeave={() => setOpen(null)}>
                    {roles.map((r) => (
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
function Channels({ channels, onChannel }: { channels: ChatChannel[]; onChannel: (ch: ChatChannel) => void }) {
  const byCat = channels.reduce<Record<string, ChatChannel[]>>((m, c) => ((m[c.category] ||= []).push(c), m), {});
  return (
    <div className="ss-members">
      <div className="ss-head"><h2>Quyền kênh</h2></div>
      <p className="ss-hint">Mỗi kênh chọn ai xem được (kênh riêng tư) và ai được nhắn (người khác chỉ đọc), theo role chat, phòng ban, vai trò hoặc từng nhân viên.</p>
      {Object.entries(byCat).map(([cat, list]) => (
        <div key={cat} className="ss-cat"><small>{cat}</small>
          {list.map((c) => (
            <button key={c.id} className="ss-chan" onClick={() => onChannel(c)}>
              <span>{c.private ? <Icon name="lock" size={14} /> : '#'}</span>{c.name}
              <em className="ss-chan-state">{c.system ? 'Hệ thống đăng' : [c.private ? 'Riêng tư' : 'Mọi người xem', c.readOnly ? 'một số người nhắn' : 'mọi người nhắn'].join(' · ')}</em>
              <Icon name="right" size={13} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
