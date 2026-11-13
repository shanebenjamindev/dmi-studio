// Hosting và giới hạn: what the whole Cloudflare account has used and has left (storage, databases, rows read and written
// today, Workers requests); and Truy vấn SQL, a console on any database of the account for Super Admins.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { Icon } from '../../components/ui';
import { admin } from '../api';
import { goAdmin, routeParam, setRouteParam } from '../nav';
import { PageHead, Section, Async, Empty, Badge, Table, useLoad, fmtNum, fmtBytes, fmtTime, fmtDate } from '../kit';
import { askConfirm } from '../../components/AskDialog';

const pctOf = (used: number, limit: number) => (used / limit) * 100;
const pctText = (p: number) => (p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`);
const tone = (p: number) => (p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'ok');

function Meter({ label, used, limit, fmt = fmtNum }: { label: string; used: number; limit: number; fmt?: (n: number) => string }) {
  const p = pctOf(used, limit);
  return (
    <div className={'ax-meter ' + tone(p)}>
      <div className="ax-meter-head"><small>{label}</small><b>{pctText(p)}</b></div>
      <div className="ax-meter-nums">
        <span><small>Đã dùng</small><strong>{fmt(used)}</strong></span>
        <span><small>Còn lại</small><strong>{fmt(Math.max(0, limit - used))}</strong></span>
      </div>
      <div className="ax-meter-bar"><i style={{ width: `${Math.min(100, Math.max(p, used ? 1 : 0))}%` }} /></div>
    </div>
  );
}

export function Hosting() {
  const user = useStore((s) => s.user)!;
  const [refreshing, setRefreshing] = useState(false);
  const load = useLoad(() => admin.hosting(), []);
  const refresh = async () => { setRefreshing(true); try { load.setData(await admin.hosting(true)); } catch { /* the old figures stay */ } setRefreshing(false); };
  return (
    <>
      <PageHead title="Hosting và giới hạn" sub={<>Đã dùng và còn lại trên toàn bộ tài khoản Cloudflare. Số trong ngày tính lại từ 7:00 sáng.{load.data && <> Cập nhật lúc {fmtTime(load.data.at)}.</>}</>}
        actions={<button type="button" className="btn btn-primary btn-sm" onClick={refresh} disabled={refreshing || load.loading}><Icon name="refresh" size={14} className={refreshing ? 'spin' : ''} />{refreshing ? 'Đang tải…' : 'Làm mới'}</button>} />
      <Async load={load}>{(d) => {
        const L = d.limits, cf = d.cloudflare, ok = cf.configured && !cf.error;
        return <>
          {ok ? (
            <div className="ax-meters">
              <Meter label="Dung lượng database" used={cf.totals.bytes} limit={L.accountBytes} fmt={fmtBytes} />
              <Meter label="Số database" used={cf.totals.databases} limit={L.databases} />
              <Meter label="Dòng đọc hôm nay" used={cf.totals.today.rowsRead} limit={L.rowsRead} />
              <Meter label="Dòng ghi hôm nay" used={cf.totals.today.rowsWritten} limit={L.rowsWritten} />
              <Meter label="Request hôm nay" used={cf.totals.requestsToday} limit={L.requests} />
              <Meter label="Số Worker" used={cf.totals.workers} limit={L.workers} />
            </div>
          ) : <>
            <div className="ax-meters">
              <Meter label={`Database ${d.database.name}`} used={d.database.bytes || 0} limit={L.databaseBytes} fmt={fmtBytes} />
            </div>
            <Section title="Kết nối Cloudflare để xem cả tài khoản">
              <div className="ax-card ax-form">
                {cf.error ? <p className="note">Cloudflare trả lỗi: <b>{cf.error}</b>. Kiểm tra lại token và quyền của nó.</p>
                  : <p className="note">Số database, tổng dung lượng và số dòng đọc/ghi lấy từ API của Cloudflare, cần một API token chỉ đọc số liệu.</p>}
                <ol className="ax-steps">
                  <li>Cloudflare › My Profile › API Tokens › Create Token › Custom token.</li>
                  <li>Quyền (Account): <b>D1 · Edit</b> (Read nếu chỉ xem, không chạy SQL trên database khác), <b>Account Analytics · Read</b>, <b>Workers Scripts · Read</b>.</li>
                  <li>Thêm <code>CF_API_TOKEN=…</code> vào file <code>.env</code> rồi chạy <code>npm run cf:secrets</code> (hoặc <code>npx wrangler secret put CF_API_TOKEN</code>). Không cần deploy lại.</li>
                </ol>
              </div>
            </Section>
          </>}
          {ok && <>
            <Section title={`Database trên tài khoản (${cf.databases.length})`}>
              <div className="ax-card flush"><Table rows={cf.databases} cols={[
                { key: 'name', label: 'Database', render: (x: any) => <span className="ax-host-name"><b>{x.name}</b>{x.current && <Badge tone="accent">App này</Badge>}</span> },
                { key: 'bytes', label: 'Đã dùng', align: 'right', render: (x: any) => <span>{fmtBytes(x.bytes)} <small className="ax-sub">({pctText(pctOf(x.bytes, L.databaseBytes))})</small></span> },
                { key: 'left', label: 'Còn lại', align: 'right', render: (x: any) => fmtBytes(Math.max(0, L.databaseBytes - x.bytes)) },
                { key: 'tables', label: 'Bảng', align: 'right', render: (x: any) => fmtNum(x.tables) },
                { key: 'read', label: 'Dòng đọc hôm nay', align: 'right', render: (x: any) => fmtNum(x.today.rowsRead) },
                { key: 'written', label: 'Dòng ghi hôm nay', align: 'right', render: (x: any) => fmtNum(x.today.rowsWritten) },
                { key: 'created', label: 'Tạo ngày', hideSm: true, render: (x: any) => fmtDate(x.createdAt) },
                { key: 'sql', label: '', align: 'right', render: (x: any) => user.role === 'admin' ? <button type="button" className="btn btn-gray btn-sm" onClick={() => goAdmin('system', 'sql', { db: x.id })}><Icon name="lines" size={13} />SQL</button> : null },
              ]} /></div>
            </Section>
            <Section title={`Workers (${cf.workers.length})`}>
              <div className="ax-card flush"><Table rows={cf.workers.map((w: any) => ({ ...w, id: w.name }))} cols={[
                { key: 'name', label: 'Worker', render: (w: any) => <b>{w.name}</b> },
                { key: 'today', label: 'Request hôm nay', align: 'right', render: (w: any) => fmtNum(w.today) },
                { key: 'errors', label: 'Lỗi hôm nay', align: 'right', render: (w: any) => w.errorsToday ? <Badge tone="warn">{fmtNum(w.errorsToday)}</Badge> : '0' },
              ]} /></div>
            </Section>
          </>}
        </>;
      }}</Async>
    </>
  );
}

const SNIPPETS: [string, string][] = [
  ['Danh sách bảng', "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;"],
  ['Cột của một bảng', 'PRAGMA table_info(users);'],
  ['Đếm bản ghi', 'SELECT COUNT(*) AS n FROM users;'],
];
const HISTORY = 'dms.sqlHistory';
const readHistory = (): string[] => { try { return JSON.parse(localStorage.getItem(HISTORY) || '[]'); } catch { return []; } };
const cellText = (v: unknown) => (v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function Sql() {
  const user = useStore((s) => s.user)!;
  const hosting = useLoad(() => admin.hosting(), []);
  const [database, setDatabase] = useState(routeParam('db') || '');
  const [sql, setSql] = useState('SELECT name, type FROM sqlite_master WHERE type = \'table\' ORDER BY name;');
  const [allowWrite, setAllowWrite] = useState(false), [busy, setBusy] = useState(false);
  const [out, setOut] = useState<any>(null), [history, setHistory] = useState(readHistory);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setRouteParam('db', database || null); }, [database]);
  if (user.role !== 'admin') return <><PageHead title="Truy vấn SQL" /><Empty icon="lines" title="Chỉ Super Admin chạy được SQL" text="Câu lệnh SQL đọc và sửa thẳng dữ liệu của mọi người nên chỉ Super Admin dùng được." /></>;
  const cf = hosting.data?.cloudflare, list: any[] = cf?.configured && !cf.error ? cf.databases : [];
  const current = list.find((x) => x.current), chosen = list.find((x) => x.id === database) || current;
  const name = chosen?.name || hosting.data?.database.name || 'database';
  const runSql = async () => {
    if (!sql.trim() || busy) return;
    if (allowWrite && !await askConfirm(`Chạy trên ${name}? Câu lệnh sửa hoặc xoá dữ liệu chạy ngay và không hoàn tác được.`)) return;
    setBusy(true);
    try {
      setOut(await admin.sql({ sql, database: chosen && !chosen.current ? chosen.id : undefined, allowWrite }));
      const h = [sql, ...history.filter((x) => x !== sql)].slice(0, 15);
      setHistory(h); try { localStorage.setItem(HISTORY, JSON.stringify(h)); } catch { /* private mode */ }
    } catch (e: any) { setOut({ results: [], error: { message: e.message } }); }
    setBusy(false);
  };
  return (
    <>
      <PageHead title="Truy vấn SQL" sub="Chạy câu lệnh SQL trên database của tài khoản Cloudflare. Mọi lần chạy được ghi vào Lịch sử thao tác." />
      <div className="ax-card ax-form ax-sql">
        <div className="ax-sql-bar">
          <label>Database
            <select className="bk-in ax-select" value={chosen?.id || ''} onChange={(e) => setDatabase(e.target.value)}>
              {/* On a server of its own (not Cloudflare) the app's database is a local file, not one of the account's. */}
              {!current && <option value="">{hosting.data?.database.name || 'database'} (app này)</option>}
              {list.map((x) => <option key={x.id} value={x.id}>{x.name}{x.current ? ' (app này)' : ''} · {fmtBytes(x.bytes)}</option>)}
            </select>
          </label>
          <div className="ax-sql-snips">{SNIPPETS.map(([label, s]) => <button key={label} type="button" className="btn btn-gray btn-sm" onClick={() => { setSql(s); box.current?.focus(); }}>{label}</button>)}</div>
        </div>
        <textarea ref={box} className="bk-in ax-sql-in" spellCheck={false} value={sql} onChange={(e) => setSql(e.target.value)} rows={8}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void runSql(); } }} placeholder="SELECT * FROM users LIMIT 10;" />
        <div className="ax-sql-bar">
          <label className="bk-check"><input type="checkbox" checked={allowWrite} onChange={(e) => setAllowWrite(e.target.checked)} />Cho phép sửa dữ liệu (INSERT, UPDATE, DELETE, CREATE, DROP…)</label>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !sql.trim()} onClick={runSql}><Icon name="play" size={13} />{busy ? 'Đang chạy…' : 'Chạy (⌘/Ctrl + Enter)'}</button>
        </div>
        <p className="note">Tối đa 20 câu lệnh mỗi lần, cách nhau bằng dấu chấm phẩy; mỗi kết quả hiện tối đa 1.000 dòng. Các câu chạy lần lượt, không gộp thành một giao dịch: câu lỗi dừng phần sau, phần trước đã chạy vẫn giữ. Mỗi dòng đọc tính vào giới hạn đọc trong ngày.</p>
      </div>
      {out && <div className="ax-sql-out">
        {out.results.map((r: any, i: number) => (
          <Section key={i} title={`Câu ${i + 1}`}>
            <div className="ax-card flush">
              <p className="ax-card-note"><code>{r.sql.length > 160 ? r.sql.slice(0, 160) + '…' : r.sql}</code><br />
                {r.columns.length ? `${fmtNum(r.rowCount)} dòng${r.truncated ? ' (hiện 1.000 dòng đầu)' : ''}` : `Đã chạy · ${fmtNum(r.changes)} dòng thay đổi`} · {r.ms} ms{r.rowsRead !== null ? ` · đọc ${fmtNum(r.rowsRead)} dòng` : ''}</p>
              {r.columns.length > 0 && <div className="ax-table-wrap"><table className="ax-table ax-sql-table">
                <thead><tr>{r.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{r.rows.map((row: unknown[], j: number) => <tr key={j}>{row.map((v, k) => <td key={k} className={v === null ? 'null' : ''}>{cellText(v)}</td>)}</tr>)}</tbody>
              </table></div>}
            </div>
          </Section>
        ))}
        {out.error && <div className="ax-card ax-sql-err"><b>{out.error.index !== undefined ? `Câu ${out.error.index + 1} lỗi` : 'Không chạy được'}</b><span>{out.error.message}</span></div>}
      </div>}
      {history.length > 0 && <Section title="Câu lệnh gần đây">
        <ul className="ax-sql-hist">{history.map((h) => <li key={h}><button type="button" onClick={() => { setSql(h); box.current?.focus(); }}><code>{h.length > 200 ? h.slice(0, 200) + '…' : h}</code></button></li>)}</ul>
      </Section>}
    </>
  );
}
