// A customer's page, Workspace & board tab: the customer's workspaces and, in each, one board per service the customer
// buys (server/service-boards.ts), with how much of its work is open. A service added here gets its board in the
// workspace chosen; a workspace is made for the customer in one step.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { openLink, toast } from '../store';
import { Icon } from './ui';
import { BrandLoading } from './BrandLoading';
import { askText } from './AskDialog';
import { BG } from './boardkit';
import type { CustomerSpaces as Spaces, ServiceRef } from '../types';


export function CustomerSpaces({ id, name, manage, catalog, onChanged }: { id: string; name: string; manage: boolean; catalog: ServiceRef[]; onChanged: () => void }) {
  const [data, setData] = useState<Spaces | null>(null), [error, setError] = useState('');
  const [service, setService] = useState(''), [space, setSpace] = useState(''), [busy, setBusy] = useState(false);
  const load = () => api.customerSpaces(id).then((d) => { setData(d); setError(''); }, (e) => setError(e.message));
  useEffect(() => { setData(null); void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="note err">{error}</p>;
  if (!data) return <BrandLoading compact />;
  const own = data.workspaces.filter((w) => w.id !== 'company');
  const taken = new Set(data.workspaces.flatMap((w) => w.boards.map((b) => b.service?.id)).filter(Boolean));
  const free = catalog.filter((s) => !taken.has(s.id));
  const editable = own.filter((w) => w.level === 'admin' || w.level === 'normal');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!service || busy) return;
    setBusy(true);
    try {
      // In the workspace chosen; with none chosen, the customer's first (made for it if it has none).
      const svcName = catalog.find((s) => s.id === service)?.name || '';
      if (space) await api.createBoard({ name: svcName, bg: 'ocean', roleId: null, workspaceId: space, customerId: id, serviceId: service });
      else await api.projectForService(id, service);
      setService(''); toast(`Đã thêm dịch vụ ${svcName}`); await load(); onChanged();
    } catch (err: any) { toast(err.message, true); } finally { setBusy(false); }
  };
  const newSpace = async () => {
    const wsName = await askText('Tên workspace mới của khách hàng', name, { required: true });
    if (!wsName) return;
    try { await api.createWorkspace({ name: wsName.trim(), customerId: id }); await load(); } catch (err: any) { toast(err.message, true); }
  };
  return (
    <section className="cs">
      <header className="cs-head">
        <p className="note">Mỗi workspace của khách hàng gom các board; mỗi board là một dịch vụ khách mua, công việc của dịch vụ nằm trên board đó.</p>
        {manage && <button type="button" className="btn btn-gray btn-sm" onClick={newSpace}><Icon name="plus" size={14} />Tạo workspace</button>}
      </header>
      {manage && (
        <form className="cs-add" onSubmit={add}>
          <select className="bk-in" value={service} onChange={(e) => setService(e.target.value)} aria-label="Dịch vụ cần thêm">
            <option value="">Thêm dịch vụ (board mới)…</option>
            {free.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {editable.length > 1 && (
            <select className="bk-in" value={space} onChange={(e) => setSpace(e.target.value)} aria-label="Vào workspace">
              <option value="">Workspace đầu tiên</option>
              {editable.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <button className="btn btn-primary btn-sm" disabled={!service || busy}>{busy ? 'Đang thêm…' : 'Thêm'}</button>
        </form>
      )}
      {!data.workspaces.length && <p className="note">Khách hàng chưa có workspace. Thêm một dịch vụ để tạo workspace và board đầu tiên.</p>}
      {data.workspaces.map((w) => (
        <article key={w.id} className="cs-ws">
          <h3><Icon name={w.id === 'company' ? 'boards' : 'folder'} size={16} />{w.id === 'company' ? 'Workspace công ty' : w.name}<small>{w.boards.length} board</small></h3>
          {!w.boards.length ? <p className="note">Chưa có board nào.</p> : (
            <ul className="cs-boards">
              {w.boards.map((b) => (
                <li key={b.id}>
                  <span className="cs-bg" style={{ background: BG[b.bg] || BG.ocean }} />
                  <div className="cs-main">
                    <b>{b.name}</b>
                    <span>{b.service ? b.service.name : <em className="cs-warn">Chưa gắn dịch vụ</em>} · {b.openTasks} việc đang mở / {b.tasks}</span>
                  </div>
                  {b.level ? <button type="button" className="btn btn-gray btn-sm" onClick={() => openLink(`#boards/${b.id}`)}>Mở board</button> : <small className="note">Chưa được chia sẻ</small>}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
      {!!data.unboarded.length && (
        <article className="cs-ws">
          <h3><Icon name="info" size={16} />Dịch vụ chưa có board</h3>
          <ul className="cs-boards">{data.unboarded.map((p) => <li key={p.projectId}><div className="cs-main"><b>{p.name}</b><span>{p.service?.name || 'Chưa có dịch vụ'}</span></div></li>)}</ul>
        </article>
      )}
    </section>
  );
}
