import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, setState, openProject, buildFromSheet, buildTabs, toast, fmt } from '../store';
import { Icon, IconButton } from './ui';
import type { ProjectItem } from '../types';

const SHEET = /docs\.google\.com\/spreadsheets\/d\//;
const LS_VIEW = 'dms.homeView';

/** "14:32" for today, "30/10" this year, "30/10/2025" before. */
function when(ms: number) {
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('vi-VN', d.getFullYear() === now.getFullYear() ? { day: '2-digit', month: '2-digit' } : undefined);
}

// The editor's start page: create a project from a request sheet, or open one of the projects (each has its own sheet).
export function Home() {
  const busy = useStore((s) => s.busy);
  const [list, setList] = useState<ProjectItem[] | null>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'list' | 'grid'>(() => { try { return localStorage.getItem(LS_VIEW) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; } });
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState('');
  const homeVersion = useStore((s) => s.homeVersion);
  // A sheet with several visible tabs: pick which tabs become projects.
  const [tabs, setTabs] = useState<{ title: string; list: { name: string; cells: number }[]; pick: Set<string> } | null>(null);
  const load = () => api.listProjects().then(setList).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, [homeVersion]);
  const setV = (v: 'list' | 'grid') => { setView(v); try { localStorage.setItem(LS_VIEW, v); } catch { /* private mode */ } };

  const valid = SHEET.test(link);
  const create = async () => {
    if (!valid || busy) return;
    setState({ busy: 'Đang đọc danh sách tab…' });
    try {
      const r = await api.sheetTabs(link.trim());
      const list = r.tabs.filter((t) => t.cells >= 15); // nearly empty tabs are not request forms
      setState({ busy: null });
      if (list.length > 1) setTabs({ title: r.title, list, pick: new Set(list.map((t) => t.name)) });
      else buildFromSheet(link.trim(), false, list[0]?.name);
    } catch (e: any) { setState({ busy: null }); toast(e.message, true); }
  };
  const runTabs = async () => {
    if (!tabs?.pick.size) return;
    const chosen = tabs.list.map((t) => t.name).filter((n) => tabs.pick.has(n));
    setTabs(null);
    if (await buildTabs(link.trim(), chosen)) { setCreating(false); setLink(''); }
  };
  const flip = (n: string) => setTabs((t) => t && { ...t, pick: new Set(t.pick.has(n) ? [...t.pick].filter((x) => x !== n) : [...t.pick, n]) });
  const shown = (list || []).filter((p) => !q.trim() || `${p.title} ${p.sheet?.customer || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const dup = async (p: ProjectItem) => { await api.duplicateProject(p.id); load(); };
  const del = async (p: ProjectItem) => { if (!confirm(`Xoá dự án “${p.title}”? Video gốc trên Drive không bị ảnh hưởng.`)) return; await api.deleteProject(p.id); load(); };

  return (
    <div className="home">
      <div className="home-in">
        <section className={'home-hero' + (creating ? ' open' : '')} onClick={() => !creating && setCreating(true)}>
          {busy ? (
            <div className="hero-busy"><span className="spinner" /><span>{busy}</span></div>
          ) : tabs ? (
            <div className="hero-form hero-tabs" onClick={(e) => e.stopPropagation()}>
              <label>“{tabs.title}” có {tabs.list.length} tab. Chọn tab để tạo dự án (mỗi tab một dự án, đặt theo tên tab):</label>
              <div className="hero-tab-list">
                {tabs.list.map((t) => (
                  <label key={t.name} className={'hero-tab' + (tabs.pick.has(t.name) ? ' on' : '')}>
                    <input type="checkbox" checked={tabs.pick.has(t.name)} onChange={() => flip(t.name)} />{t.name}
                  </label>
                ))}
              </div>
              <div className="hero-row">
                <button className="btn btn-primary btn-lg" disabled={!tabs.pick.size} onClick={runTabs}><Icon name="sparkle" size={16} />Ghép {tabs.pick.size} dự án</button>
                <button className="btn btn-lg hero-cancel" onClick={() => setTabs(null)}>Huỷ</button>
              </div>
              <p>Mỗi tab mất khoảng 1–3 phút; các dự án hiện dần trong danh sách bên dưới. Tab bị ẩn trong sheet không được tính.</p>
            </div>
          ) : !creating ? (
            <div className="hero-cta"><span className="hero-plus"><Icon name="plus" size={20} /></span>Tạo dự án</div>
          ) : (
            <form className="hero-form" onSubmit={(e) => { e.preventDefault(); create(); }} onClick={(e) => e.stopPropagation()}>
              <label htmlFor="sheetLink">Dán link Google Sheet yêu cầu dựng video</label>
              <div className="hero-row">
                <input id="sheetLink" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
                <button type="submit" className="btn btn-primary btn-lg" disabled={!valid}><Icon name="sparkle" size={16} />Ghép source</button>
                <button type="button" className="btn btn-lg hero-cancel" onClick={() => { setCreating(false); setLink(''); }}>Huỷ</button>
              </div>
              <p>{link && !valid ? 'Đây không phải link Google Sheet.' : 'Máy đọc nội dung và thời lượng từng cảnh, xem bên trong các video source rồi chọn, cắt và xếp clip theo đúng nội dung. Mất khoảng 1–3 phút. Sheet và thư mục source cần chia sẻ cho tài khoản Google đã kết nối.'}</p>
            </form>
          )}
        </section>

        <div className="home-head">
          <h2>Dự án</h2>
          <div className="home-tools">
            <label className="home-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm dự án" aria-label="Tìm dự án" /></label>
            <div className="home-view">
              <button className={view === 'list' ? 'on' : ''} onClick={() => setV('list')} title="Dạng bảng"><Icon name="layers" size={15} /></button>
              <button className={view === 'grid' ? 'on' : ''} onClick={() => setV('grid')} title="Dạng lưới"><Icon name="grid" size={15} /></button>
            </div>
          </div>
        </div>

        {list === null ? <p className="home-empty">Đang tải…</p>
          : !shown.length ? <p className="home-empty">{q ? 'Không có dự án nào khớp.' : 'Chưa có dự án nào. Bấm “Tạo dự án” và dán link sheet để bắt đầu.'}</p>
          : view === 'list' ? (
            <div className="home-table" role="table">
              <div className="home-tr head" role="row"><span /><span>Tên</span><span>Sheet</span><span>Clip</span><span>Độ dài</span><span>Sửa lần cuối</span><span /></div>
              {shown.map((p) => (
                <div key={p.id} className="home-tr" role="row" onClick={() => openProject(p.id)}>
                  <Thumb p={p} />
                  <span className="home-name">{p.title}</span>
                  <span className="home-sheet">{p.sheet ? <a href={p.sheet.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={p.sheet.title}>📄 {p.sheet.customer || p.sheet.title}</a> : <em>—</em>}</span>
                  <span className="mono">{p.clips}</span>
                  <span className="mono">{fmt(p.duration)}</span>
                  <span>{when(p.updatedAt)}</span>
                  <span className="home-actions" onClick={(e) => e.stopPropagation()}>
                    <IconButton icon="copy" label="Nhân bản" size={15} onClick={() => dup(p)} />
                    <IconButton icon="trash" label="Xoá dự án" size={15} danger onClick={() => del(p)} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="home-grid">
              {shown.map((p) => (
                <div key={p.id} className="home-card" onClick={() => openProject(p.id)}>
                  <Thumb p={p} big />
                  <div className="home-card-meta">
                    <b title={p.title}>{p.title}</b>
                    <span>{p.sheet?.customer || '—'} · {p.clips} clip · {fmt(p.duration)} · {when(p.updatedAt)}</span>
                  </div>
                  <span className="home-actions" onClick={(e) => e.stopPropagation()}>
                    <IconButton icon="copy" label="Nhân bản" size={15} onClick={() => dup(p)} />
                    <IconButton icon="trash" label="Xoá dự án" size={15} danger onClick={() => del(p)} />
                  </span>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

function Thumb({ p, big }: { p: ProjectItem; big?: boolean }) {
  const bg = p.thumb ? `url("${p.thumb}") center / cover` : p.palette ? `linear-gradient(135deg, ${p.palette.bg1}, ${p.palette.bg2})` : '#27272a';
  return <span className={'home-thumb' + (big ? ' big' : '')} style={{ background: bg }}>{big && <em>{p.aspect}</em>}</span>;
}
