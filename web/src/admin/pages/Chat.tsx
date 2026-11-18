// Quản trị › Tin nhắn: who may write in Tin nhắn. By role it is the "Nhắn tin" permission of Phân quyền (Member holds
// it, so everyone chats until an admin changes that); one person at a time is blocked here (they keep reading).
import { useMemo, useState } from 'react';
import { Icon } from '../../components/ui';
import { admin, type ChatPerson, type ChatRoleRow } from '../api';
import { goAdmin } from '../nav';
import { PageHead, Section, Table, Select, Check, Badge, Empty, Async, useLoad, act, type Col } from '../kit';

export function ChatSettings() {
  const load = useLoad(() => admin.chat(), []);
  return (
    <>
      <PageHead title="Cài đặt Tin nhắn" sub="Ai được nhắn tin và ai bị chặn. Quyền theo vai trò đặt ở Phân quyền; chặn từng người ở đây." />
      <Async load={load}>{(d) => <Body roles={d.roles} people={d.people} reload={load.reload} />}</Async>
    </>
  );
}

function Body({ roles, people, reload }: { roles: ChatRoleRow[]; people: ChatPerson[]; reload: () => void }) {
  const [pick, setPick] = useState('');
  const blocked = useMemo(() => people.filter((p) => p.blocked), [people]);
  const everyone = roles.find((r) => r.member)?.send;
  const save = (ids: string[], done: string) => act(() => admin.setChatBlocked(ids), done, reload);
  const roleCols: Col<ChatRoleRow>[] = [
    { key: 'name', label: 'Vai trò', render: (r) => <span className="ax-stack"><b>{r.name}</b>{r.member && <small>Mọi nhân viên</small>}</span> },
    { key: 'send', label: 'Nhắn tin', align: 'center', render: (r) => <Check on={r.send} /> },
    { key: 'manage', label: 'Quản lý Tin nhắn', align: 'center', render: (r) => <Check on={r.manage} /> },
    { key: 'people', label: 'Số người', align: 'right', render: (r) => (r.member ? '—' : r.people), hideSm: true },
  ];
  const blockCols: Col<ChatPerson>[] = [
    { key: 'name', label: 'Nhân viên', render: (p) => <span className="ax-stack"><b>{p.name}</b><small>{p.email}</small></span> },
    { key: 'state', label: 'Trạng thái', render: () => <Badge tone="bad">Không được nhắn tin</Badge>, hideSm: true },
    { key: 'act', label: '', align: 'right', render: (p) => <button className="btn btn-gray btn-sm" onClick={() => save(blocked.filter((x) => x.id !== p.id).map((x) => x.id), `Đã bỏ chặn ${p.name}`)}>Bỏ chặn</button> },
  ];
  return (
    <>
      <Section title="Ai được nhắn tin" actions={<button className="btn btn-gray btn-sm" onClick={() => goAdmin('rbac', 'roles')}><Icon name="key" size={14} />Sửa ở Phân quyền</button>}>
        <p className="ax-card-note">
          {everyone
            ? 'Mọi nhân viên đều được nhắn tin (vai trò Member có quyền Nhắn tin). Muốn chỉ một số người được nhắn: bỏ quyền Nhắn tin của Member rồi bật cho các vai trò cần.'
            : 'Chỉ người có vai trò được đánh dấu Nhắn tin mới gửi được tin nhắn; những người khác vẫn đọc được.'}
          {' '}Quản lý Tin nhắn: tạo và xoá kênh, ghim và xoá tin của người khác, chỉnh trang này. Chủ và admin của một workspace luôn quản lý kênh của workspace đó.
        </p>
        <div className="ax-card flush"><Table cols={roleCols} rows={roles} /></div>
      </Section>
      <Section title={`Chặn nhắn tin (${blocked.length})`}>
        <p className="ax-card-note">Người bị chặn vẫn đọc được tin nhắn và file nhưng không gửi được, kể cả nhắn riêng.</p>
        <div className="ax-chat-block">
          <Select value={pick} onChange={setPick} label="Chọn nhân viên">
            <option value="">Chọn nhân viên để chặn…</option>
            {people.filter((p) => !p.blocked).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.email}</option>)}
          </Select>
          <button className="btn btn-primary btn-sm" disabled={!pick} onClick={() => { const p = people.find((x) => x.id === pick); setPick(''); void save([...blocked.map((x) => x.id), pick], `Đã chặn ${p?.name || ''} nhắn tin`); }}>
            <Icon name="lock" size={14} />Chặn
          </button>
        </div>
        <div className="ax-card flush"><Table cols={blockCols} rows={blocked} empty={<Empty icon="chat" title="Chưa chặn ai" text="Mọi người có quyền Nhắn tin đều gửi được tin nhắn." />} /></div>
      </Section>
    </>
  );
}
