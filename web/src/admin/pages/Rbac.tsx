// Phân quyền: roles and what each may do at which scope (a matrix to tick), the permission groups (one per module),
// every permission against every role, and who holds which roles. The server refuses anything above the editor's own rank.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { Icon } from '../../components/ui';
import { admin, type Role, type Staff } from '../api';
import { ACTIONS, ACTION_LABEL, PERM_GROUPS, SCOPES, SCOPE_LABEL, scopeRank, type Scope } from '../../../../shared/permissions';
import { routeParam, setRouteParam } from '../nav';
import { PageHead, Toolbar, Select, Table, Pager, Drawer, Field, Badge, Async, Empty, useLoad, useListState, useDebounced, useCan, act, fmtNum, fmtAgo, type Col } from '../kit';
import { RoleBadges, StatusBadge } from './Staff';
import { Person } from '../kit';
import { askConfirm } from '../../components/AskDialog';

const SHORT: Record<Scope, string> = { personal: 'CN', team: 'Nhóm', department: 'PB', organization: 'Tất cả' };

// ---------------------------------------------------------------- roles
export function Roles() {
  const can = useCan();
  const load = useLoad(() => admin.roles(), []);
  const [edit, setEdit] = useState<Role | 'new' | null>(null);
  return (
    <>
      <PageHead title="Vai trò" sub="Mỗi vai trò là một tập quyền ở một phạm vi dữ liệu. Cấp của vai trò quyết định ai quản lý được ai: bạn chỉ sửa, gán và thu hồi vai trò thấp hơn vai trò của mình."
        actions={can('rbac.manage') && <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><Icon name="plus" size={14} />Tạo vai trò</button>} />
      <Async load={load}>{(roles) => (
        <div className="ax-role-grid">{roles.map((r) => (
          <button key={r.id} className="ax-role" onClick={() => setEdit(r)}>
            <header><b>{r.name}</b><Badge tone={r.rank >= 80 ? 'accent' : 'muted'}>Cấp {r.rank}</Badge>{r.system && <Badge tone="muted">Mặc định</Badge>}</header>
            <p>{r.about || 'Chưa có mô tả.'}</p>
            <footer><span><Icon name="users" size={13} />{fmtNum(r.holders)} người</span><span><Icon name="key" size={13} />{r.perms === 'all' ? 'Mọi quyền' : `${Object.keys(r.perms).length} quyền`}</span></footer>
          </button>
        ))}</div>
      )}</Async>
      {edit && <RoleEditor role={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load.reload(); }} />}
    </>
  );
}
function RoleEditor({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const access = useStore((s) => s.admin);
  const editable = role ? role.canEdit : true;
  const [f, setF] = useState({ name: role?.name || '', about: role?.about || '', rank: role?.rank ?? 30 });
  const [perms, setPerms] = useState<Record<string, Scope>>(role?.perms === 'all' ? {} : { ...(role?.perms || {}) });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mine = (p: string) => (access?.superAdmin ? 'organization' : (access?.perms[p] as Scope | undefined));
  const maxRank = access?.superAdmin ? 99 : (access?.rank || 1) - 1;
  const save = async () => {
    if (!f.name.trim()) return setError('Hãy nhập tên vai trò');
    if (!role?.system && (f.rank < 1 || f.rank > maxRank)) return setError(`Cấp phải từ 1 đến ${maxRank}`);
    setBusy(true); setError('');
    try { await (role ? admin.updateRole(role.id, { ...f, perms }) : admin.createRole({ ...f, perms })); onSaved(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const all = role?.perms === 'all';
  return (
    <Drawer open wide title={role ? role.name : 'Tạo vai trò'} sub={role?.system ? 'Vai trò mặc định' : undefined} onClose={onClose} footer={<>
      {role?.canDelete && <button className="btn btn-gray btn-sm" onClick={async () => await askConfirm(`Xoá vai trò “${role.name}”? ${role.holders} người đang giữ vai trò này sẽ mất các quyền của nó.`) && act(() => admin.removeRole(role.id), 'Đã xoá vai trò', onSaved)}><Icon name="trash" size={14} />Xoá vai trò</button>}
      <button className="btn btn-gray btn-sm" onClick={onClose}>Đóng</button>
      {editable && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>}
    </>}>
      {error && <p className="note err" role="alert">{error}</p>}
      {all && <p className="note">Super Admin luôn có mọi quyền ở toàn hệ thống và không sửa được.</p>}
      {!editable && !all && <p className="note">Vai trò này ngang hoặc cao hơn vai trò của bạn nên bạn chỉ xem được.</p>}
      <fieldset className="ax-form" disabled={!editable}>
        <div className="ax-form-grid">
          <Field label="Tên vai trò *"><input className="bk-in" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Cấp" hint={role?.system ? 'Vai trò mặc định giữ nguyên cấp.' : `Từ 1 đến ${maxRank}; cao hơn quản lý được thấp hơn.`}><input className="bk-in" type="number" min={1} max={maxRank} value={f.rank} disabled={!!role?.system} onChange={(e) => setF({ ...f, rank: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Mô tả"><textarea className="bk-in" rows={2} maxLength={500} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} /></Field>
      </fieldset>
      <div className="ax-matrix-wrap">
        <table className="ax-matrix">
          <thead><tr><th>Nhóm quyền</th>{ACTIONS.map((a) => <th key={a}>{ACTION_LABEL[a]}</th>)}<th>Phạm vi</th></tr></thead>
          <tbody>{PERM_GROUPS.map((g) => {
            const keys = ACTIONS.filter((a) => g.actions[a]).map((a) => `${g.key}.${a}`), held = keys.filter((k) => all || perms[k]);
            const scope: Scope = all ? 'organization' : (held.map((k) => perms[k]).sort((a, b) => scopeRank(b) - scopeRank(a))[0] || 'department');
            const setScope = (s: Scope) => setPerms(Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, k.startsWith(g.key + '.') ? s : v])));
            return (
              <tr key={g.key}>
                <th><b>{g.label}</b><small>{g.about}</small></th>
                {ACTIONS.map((a) => {
                  const k = `${g.key}.${a}`;
                  if (!g.actions[a]) return <td key={a} className="na" title="Không áp dụng cho nhóm này">—</td>;
                  const lack = !all && !mine(k);
                  return <td key={a}><input type="checkbox" checked={all || !!perms[k]} disabled={all || !editable || lack} title={lack ? 'Bạn chưa có quyền này nên không cấp được' : g.actions[a]} aria-label={`${g.label}: ${ACTION_LABEL[a]}`}
                    onChange={(e) => { const next = { ...perms }; if (e.target.checked) next[k] = g.scoped ? scope : 'organization'; else delete next[k]; setPerms(next); }} /></td>;
                })}
                <td>{g.scoped ? <select className="bk-in ax-cell-input" value={scope} disabled={all || !editable || !held.length} onChange={(e) => setScope(e.target.value as Scope)} aria-label={`Phạm vi ${g.label}`}>
                  {SCOPES.map((s) => <option key={s} value={s} disabled={!access?.superAdmin && held.some((k) => scopeRank(s) > scopeRank(mine(k)))}>{SCOPE_LABEL[s]}</option>)}</select> : <span className="ax-muted">Toàn hệ thống</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className="note">Rê chuột lên ô để xem quyền đó cho phép làm gì. Bạn không cấp được quyền (hay phạm vi) mà chính bạn chưa có. Hệ thống chưa có quy trình duyệt nào nên chưa có quyền “Duyệt”; quyền sẽ được thêm khi có luồng duyệt thật.</p>
    </Drawer>
  );
}

// ---------------------------------------------------------------- permission groups (modules) and the full matrix
export function PermissionGroups() {
  const load = useLoad(() => admin.permissions(), []);
  return (
    <>
      <PageHead title="Nhóm quyền" sub="Quyền được chia theo module. Mỗi quyền tương ứng một kiểm tra trên máy chủ nên danh sách quyền do hệ thống định nghĩa; vai trò chọn quyền nào và ở phạm vi nào." />
      <Async load={load}>{(groups) => (
        <div className="ax-perm-groups">{groups.map((g) => (
          <section key={g.key} className="ax-card">
            <header className="ax-perm-h"><h3>{g.label}</h3>{g.scoped ? <Badge tone="muted">Có phạm vi dữ liệu</Badge> : <Badge tone="muted">Toàn hệ thống</Badge>}</header>
            <p className="note">{g.about}</p>
            <ul className="ax-list">{g.perms.map((p) => <li key={p.key}><span><b>{ACTION_LABEL[p.action as keyof typeof ACTION_LABEL]} <code>{p.key}</code></b><small>{p.about}</small></span><span className="ax-badges">{p.roles.map((r) => <Badge key={r} tone="muted">{r}</Badge>)}</span></li>)}</ul>
          </section>
        ))}</div>
      )}</Async>
    </>
  );
}
export function PermissionMatrix() {
  const roles = useLoad(() => admin.roles(), []);
  return (
    <>
      <PageHead title="Quyền chi tiết" sub={<>Ma trận mọi quyền với mọi vai trò. Ô ghi phạm vi: CN (cá nhân), Nhóm, PB (phòng ban), Tất cả. Sửa quyền của một vai trò ở trang Vai trò.</>} />
      <Async load={roles}>{(rs) => (
        <div className="ax-card flush"><div className="ax-matrix-wrap"><table className="ax-matrix dense">
          <thead><tr><th>Quyền</th>{rs.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
          <tbody>{PERM_GROUPS.map((g) => [
            <tr key={g.key} className="group"><th colSpan={rs.length + 1}>{g.label}</th></tr>,
            ...ACTIONS.filter((a) => g.actions[a]).map((a) => {
              const k = `${g.key}.${a}`;
              return <tr key={k}><th title={g.actions[a]}>{ACTION_LABEL[a]}<small>{g.actions[a]}</small></th>{rs.map((r) => {
                const s = r.perms === 'all' ? 'organization' : r.perms[k];
                return <td key={r.id}>{s ? <span className={'ax-cell-on s-' + s}>{g.scoped ? SHORT[s] : <Icon name="check" size={13} />}</span> : <span className="ax-muted">·</span>}</td>;
              })}</tr>;
            }),
          ])}</tbody>
        </table></div></div>
      )}</Async>
    </>
  );
}

// ---------------------------------------------------------------- who holds which roles
export function Assign() {
  const can = useCan();
  const [q, setQ] = useState(''), [role, setRole] = useState(''), [admins, setAdmins] = useState(false);
  const L = useListState('rank'), term = useDebounced(q);
  const params = { q: term, role, admins: admins ? 1 : '', sort: L.sort, dir: L.dir, page: L.page, size: 25 };
  const load = useLoad(() => admin.assignments(params), [JSON.stringify(params)]);
  const roles = useLoad(() => admin.roles(), []);
  const [open, setOpen] = useState<string | null>(() => routeParam('id'));
  useEffect(() => { L.setPage(1); }, [term, role, admins]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = (id: string | null) => { setOpen(id); setRouteParam('id', id); };
  const cols: Col<Staff>[] = [
    { key: 'name', label: 'Nhân viên', sort: true, render: (s) => <span className="ax-person"><Person p={s} size={28} /><span><b>{s.name}</b><small>{s.department?.name || 'Chưa có phòng ban'}</small></span></span> },
    { key: 'roles', label: 'Vai trò', render: (s) => <RoleBadges s={s} /> },
    { key: 'rank', label: 'Cấp', sort: true, align: 'right', render: (s) => s.rank },
    { key: 'status', label: 'Trạng thái', render: (s) => <StatusBadge s={s} />, hideSm: true },
    { key: 'lastLogin', label: 'Đăng nhập', sort: true, render: (s) => fmtAgo(s.lastLogin), hideSm: true },
  ];
  return (
    <>
      <PageHead title="Gán quyền nhân viên" sub="Một người có thể giữ nhiều vai trò; quyền cộng lại theo phạm vi rộng nhất. Có thể giới hạn phạm vi của từng vai trò cho từng người." />
      <Toolbar search={q} onSearch={setQ} placeholder="Tìm nhân viên…">
        <Select value={role} onChange={setRole} label="Vai trò"><option value="">Mọi vai trò</option>{(roles.data || []).map((r) => <option key={r.id} value={r.key === 'member' ? 'member' : r.id}>{r.name}</option>)}</Select>
        <label className="ax-toggle"><input type="checkbox" checked={admins} onChange={(e) => setAdmins(e.target.checked)} />Chỉ tài khoản Admin</label>
      </Toolbar>
      <div className="ax-card flush"><Async load={load}>{(d) => <>
        <Table cols={cols} rows={d.items} sort={L.sort} dir={L.dir} onSort={L.onSort} onRow={(s) => show(s.id)} selected={open} empty={<Empty title="Không có nhân viên phù hợp" />} />
        <Pager page={d.page} size={d.size} total={d.total} onPage={L.setPage} />
      </>}</Async></div>
      {open && roles.data && (() => {
        const s = load.data?.items.find((x) => x.id === open);
        return s ? <RolePicker staff={s} roles={roles.data} canManage={can('rbac.manage') && !!s.canAssign} onClose={() => show(null)} onSaved={() => { show(null); load.reload(); }} /> : null;
      })()}
    </>
  );
}
function RolePicker({ staff, roles, canManage, onClose, onSaved }: { staff: Staff; roles: Role[]; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const [held, setHeld] = useState<Record<string, Scope | ''>>(() => Object.fromEntries(staff.roles.map((r) => [r.id, r.scope || ''])));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    const removedAdmin = staff.roles.some((r) => r.rank >= 80 && !(r.id in held));
    if (removedAdmin && !await askConfirm(`Thu hồi vai trò quản trị của ${staff.name}?`)) return;
    setBusy(true); setError('');
    try { await admin.setRoles(staff.id, Object.entries(held).map(([roleId, scope]) => ({ roleId, scope: scope || null }))); onSaved(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer open title={`Vai trò · ${staff.name}`} sub={staff.email} onClose={onClose} footer={<><button className="btn btn-gray btn-sm" onClick={onClose}>Đóng</button>{canManage && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu vai trò'}</button>}</>}>
      {error && <p className="note err" role="alert">{error}</p>}
      {!canManage && <p className="note">Bạn chỉ xem được: người này ngang hoặc cao hơn bạn, là chính bạn, hoặc bạn chưa có quyền quản lý phân quyền.</p>}
      <ul className="ax-role-pick">{roles.filter((r) => r.key !== 'member').map((r) => {
        const on = r.id in held;
        return (
          <li key={r.id} className={on ? 'on' : ''}>
            <label><input type="checkbox" checked={on} disabled={!canManage || !r.canAssign} onChange={(e) => { const next = { ...held }; if (e.target.checked) next[r.id] = ''; else delete next[r.id]; setHeld(next); }} />
              <span><b>{r.name} <small>· cấp {r.rank}</small></b><small>{r.about}</small>{!r.canAssign && <small className="ax-muted">Vai trò ngang hoặc cao hơn của bạn</small>}</span></label>
            {on && <Field label="Phạm vi"><select className="bk-in" value={held[r.id]} disabled={!canManage || !r.canAssign} onChange={(e) => setHeld({ ...held, [r.id]: e.target.value as Scope | '' })}><option value="">Theo vai trò</option>{SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</select></Field>}
          </li>
        );
      })}</ul>
      <p className="note">Không chọn vai trò nào: người này là Member (vai trò mọi nhân viên đều có).</p>
    </Drawer>
  );
}
