import { useEffect, useState } from 'react';
import { toast } from '../store';
import { askConfirm } from './AskDialog';
import { Icon } from './ui';

// Hồ sơ › Kết nối Claude: each person uses their own Claude (Pro/Team, the Claude apps, Claude Code) and connects it to
// DMI through the MCP connector (server/mcp.ts) with their own DMI account. Here: how to connect, and the Claude apps
// connected now, each of which can be taken back.
interface Connection { id: string; name: string; since: number; lastSeen: number }
const CLOUD = 'https://dmi-workspace.detailersmovement.workers.dev';
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast('Đã chép'), () => toast('Không chép được, hãy chọn và chép tay', true));
const when = (ms: number) => new Date(ms).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

export function ClaudeConnect() {
  const [list, setList] = useState<Connection[] | null>(null);
  const load = () => fetch('/api/mcp/connections').then((r) => (r.ok ? r.json() : [])).then(setList, () => setList([]));
  useEffect(() => { void load(); }, []);
  const web = `${local ? CLOUD : location.origin}/api/mcp`, code = `${location.origin}/api/mcp`;
  const revoke = async (c: Connection) => {
    if (!await askConfirm('App này sẽ không còn làm việc với DMI bằng tài khoản của bạn. Muốn dùng lại thì kết nối lại.', { title: `Thu hồi ${c.name}?`, confirmLabel: 'Thu hồi', danger: true })) return;
    const r = await fetch(`/api/mcp/connections/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
    if (!r.ok) return toast('Không thu hồi được, hãy thử lại', true);
    toast('Đã thu hồi');
    void load();
  };
  return (
    <section className="notification-settings claude-connect">
      <header><Icon name="sparkle" size={16} /><h2>Kết nối Claude</h2></header>
      <p>Dùng Claude của chính bạn (gói Pro hoặc Team) để hỏi và làm việc trong DMI: xem, tìm, tạo, sửa công việc, xem khách hàng và dịch vụ. Claude chỉ làm được những gì tài khoản DMI của bạn được làm, và mọi thay đổi đều ghi tên bạn trong nhật ký.</p>
      <ol>
        <li><b>claude.ai, app Claude trên máy tính và điện thoại:</b> Settings → Connectors → Add custom connector, dán địa chỉ dưới đây, bấm Connect, đăng nhập DMI rồi bấm <b>Cho phép</b>. Gói Team: Owner thêm connector một lần cho cả nhóm, mỗi người tự bấm Connect.
          <div className="cc-copy"><code>{web}</code><button className="btn btn-gray btn-sm" onClick={() => copy(web)}><Icon name="copy" size={13} />Chép</button></div>
        </li>
        <li><b>Claude Code</b> (Terminal, VS Code): chạy lệnh dưới đây, rồi gõ <code>/mcp</code> trong Claude Code để đăng nhập.
          <div className="cc-copy"><code>{`claude mcp add --transport http --scope user dmi ${code}`}</code><button className="btn btn-gray btn-sm" onClick={() => copy(`claude mcp add --transport http --scope user dmi ${code}`)}><Icon name="copy" size={13} />Chép</button></div>
        </li>
      </ol>
      <h3>App Claude đang kết nối với tài khoản của bạn</h3>
      {list === null ? <p className="note">Đang tải…</p> : !list.length ? <p className="note">Chưa có app nào. Kết nối xong sẽ hiện ở đây.</p> : (
        <ul className="cc-list">
          {list.map((c) => (
            <li key={c.id}>
              <span><b>{c.name}</b><small>Kết nối từ {when(c.since)} · lần gần nhất {when(c.lastSeen)}</small></span>
              <button className="btn btn-gray btn-sm danger" onClick={() => void revoke(c)}>Thu hồi</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
