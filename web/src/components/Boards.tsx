import {BrandLoading} from './BrandLoading';
import {EntitySelect,QuickCreateButton,useEntityRefresh} from './QuickCreate';
// Workspace: boards like Trello, in workspaces: the company's (everyone, with a board for each company role) and the
// ones people make for themselves, private until shared. Laid out like Trello's: a bar on top (the workspace, search,
// create), panels side by side that the dock at the bottom shows or hides (the person's Inbox, their Planner and the
// board, see BoardPanels) and "Switch boards"; a home page of board tiles by workspace, and boards of lists of cards: cards show their cover, labels, dates, badges and members, open in a window with everything
// on them (CardModal), and move by dragging; lists have their actions menu and fold to a narrow bar; a board has
// filters, a visibility button, sharing with people at a level (admin / member / view only) and a menu on the right
// (about, activity, archived items, background, labels). People who only view a board read it and comment.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { remember } from '../prefs';
import { useStore, toast } from '../store';
import { Icon } from './ui';
import { CardModal } from './CardModal';
import { QuickCard, BoardAlternative, VIEW_NAMES, type BoardViewKind } from './BoardViews';
import { COLOR, COLOR_NAME, Avatar, Pop, fileToAvatarDataUrl, activityText, ago, dueState, shortDate } from './boardkit';
import { AvatarStack } from './AvatarStack';
import { InboxPanel, PlannerPanel, Dock, SwitchBoards, dragged, changed, useChanged, type Panels } from './BoardPanels';
import type { Board, BoardActivity, BoardCard, BoardItem, BoardLabel, BoardMember, Level, Person, TeamRole, User, Workspace, WorkspaceMember } from '../types';

/** Board backgrounds, by the names the server keeps. */
export const BG: Record<string, string> = {
  ocean: 'linear-gradient(135deg, #0c66e4 0%, #0a3a80 100%)',
  sky: 'linear-gradient(135deg, #6cc3e0 0%, #0055cc 100%)',
  forest: 'linear-gradient(135deg, #22a06b 0%, #164b35 100%)',
  lime: 'linear-gradient(135deg, #94c748 0%, #3f5224 100%)',
  sunset: 'linear-gradient(135deg, #fea362 0%, #c9372c 100%)',
  rose: 'linear-gradient(135deg, #ff8f73 0%, #ae2e24 100%)',
  berry: 'linear-gradient(135deg, #e774bb 0%, #943d73 100%)',
  grape: 'linear-gradient(135deg, #9f8fef 0%, #352c63 100%)',
  slate: 'linear-gradient(135deg, #8590a2 0%, #2c333a 100%)',
  night: 'linear-gradient(135deg, #454f59 0%, #101214 100%)',
};
const bg = (k: string) => BG[k] || BG.ocean;
const ls = {
  get: <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } remember(k, JSON.stringify(v)); },
};
const LS_RECENT = 'dms.recentBoards', LS_WS = 'dms.ws', LS_PANELS = 'dms.panels';
/** Phones show one panel at a time. */
const narrow = () => window.innerWidth < 760;
/** `#boards/<board>`, `#boards/<board>/c/<card>`, or `#boards/ws/<workspace>` (its members). */
const fromHash = () => {
  const m = location.hash.match(/^#boards\/(b_\w+)(?:\/c\/(k_\w+))?/), w = location.hash.match(/^#boards\/ws\/(w_\w+|company)/);
  return { board: m?.[1] || null, card: m?.[2] || null, people: w?.[1] || null };
};

// ---------------------------------------------------------------- levels and workspaces
export const LEVEL_NAME: Record<Level, string> = { admin: 'Admin', normal: 'Thành viên', observer: 'Chỉ xem' };
const LEVEL_TIP: Record<Level, string> = { admin: 'Sửa mọi thứ, đổi cài đặt và mời người khác', normal: 'Làm việc trên thẻ; sửa board (danh sách, nhãn, tên, hình nền) khi admin cho phép', observer: 'Chỉ xem và bình luận' };
const WS_COLORS = ['#0c66e4', '#6e5dc6', '#1f845a', '#c25100', '#ae2e24', '#206a83', '#943d73', '#5b7f24'];
/** A workspace's mark: the company logo for the company's, else its first letter on a colour of its own. */
function WsMark({ ws, size = 32 }: { ws: Workspace; size?: number }) {
  if (ws.avatar) return <span className="bd-ws-mark bd-ws-custom" style={{ width: size, height: size }}><img src={ws.avatar} alt="" /></span>;
  if (ws.kind === 'company') return <span className="bd-ws-mark bd-ws-logo" style={{ width: size, height: size }}><img src="/brand/mark.png" alt="" /></span>;
  const n = [...ws.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return <span className="bd-ws-mark" style={{ width: size, height: size, fontSize: Math.round(size * 0.45), background: WS_COLORS[n % WS_COLORS.length] }}>{(ws.name.trim()[0] || '?').toUpperCase()}</span>;
}
const wsKind = (w: Workspace, me: User) => (w.kind === 'company' ? 'Workspace công ty'
  : w.ownerId === me.id ? (w.visibility === 'company' ? 'Của bạn · cả công ty xem được' : 'Của bạn · riêng tư') : `Được chia sẻ · ${LEVEL_NAME[w.level]}`);
const LevelSelect = ({ value, onChange, label }: { value: Level; onChange: (l: Level) => void; label: string }) => (
  <select className="bd-level-sel" value={value} onChange={(e) => onChange(e.target.value as Level)} title={LEVEL_TIP[value]} aria-label={label}>
    {(['admin', 'normal', 'observer'] as Level[]).map((l) => <option key={l} value={l}>{LEVEL_NAME[l]}</option>)}
  </select>
);

export function BoardsPage() {
  const me = useStore((s) => s.user)!;
  const roles = useStore((s) => s.roles);
  const [boards, setBoards] = useState<BoardItem[] | null>(null);
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [open, setOpenState] = useState<{ board: string | null; card: string | null; people: string | null }>(fromHash);
  const [wsId, setWsIdState] = useState<string>(() => ls.get(LS_WS, 'company'));
  const setWsId = (id: string) => { setWsIdState(id); ls.set(LS_WS, id); };
  type NavEntry=typeof open & {ws:string};
  const trail=useRef<{items:NavEntry[];at:number}>({items:[{...open,ws:wsId}],at:0});
  const[,setNavTick]=useState(0);
  const applyNav=(entry:NavEntry)=>{setOpenState({board:entry.board,card:entry.card,people:entry.people});setWsId(entry.ws);history.replaceState(null,'',entry.people?`#boards/ws/${entry.people}`:entry.board?`#boards/${entry.board}${entry.card?`/c/${entry.card}`:''}`:'#boards');setNavTick(n=>n+1);};
  const visit=(entry:NavEntry)=>{const nav=trail.current,last=nav.items[nav.at];if(JSON.stringify(last)!==JSON.stringify(entry)){nav.items=nav.items.slice(0,nav.at+1);nav.items.push(entry);nav.at++;}applyNav(entry);};
  const step=(delta:number)=>{const nav=trail.current,index=nav.at+delta;if(index<0||index>=nav.items.length)return;nav.at=index;applyNav(nav.items[index]);};

  const [creating, setCreating] = useState<string | null>(null); // the workspace a new board goes to
  const [newWs, setNewWs] = useState(false);
  const [wsMenu, setWsMenu] = useState<HTMLElement | null>(null);
  const [boardMenu, setBoardMenu] = useState<{ b: BoardItem; el: HTMLElement } | null>(null);
  const [wsAct, setWsAct] = useState<{ w: Workspace; el: HTMLElement } | null>(null);
  const [panels, setPanels] = useState<Panels>(() => {
    const p = { inbox: !narrow(), planner: false, board: true, ...ls.get<Partial<Panels>>(LS_PANELS, {}) };
    return narrow() ? { inbox: false, planner: false, board: true } : p;
  });
  const [switching, setSwitching] = useState(false);
  /** Show or hide a panel (one always stays); on a phone the one shown replaces the others. */
  const toggle = (k: keyof Panels, show = !panels[k]) => setPanels((p) => {
    let n = { ...p, [k]: show };
    if (show && narrow()) n = { inbox: false, planner: false, board: false, [k]: true };
    if (!n.inbox && !n.planner && !n.board) return p;
    if (!narrow()) ls.set(LS_PANELS, n); // a phone's one-at-a-time choice is not the computer's
    return n;
  });
  // However a board was opened (link, overview, planner, search), it shows.
  useEffect(() => { if (open.board && !panels.board) toggle('board', true); }, [open.board, open.card]); // eslint-disable-line react-hooks/exhaustive-deps
  const [recent, setRecent] = useState<string[]>(() => ls.get(LS_RECENT, []));
  const load = () => Promise.all([api.boards(), api.workspaces()]).then(([b, w]) => { setBoards(b); setSpaces(w); }).catch((e) => toast(e.message, true));
  useEntityRefresh(load);
  useEffect(() => {
    load();
    // A board or card link pasted into the address bar opens without a reload.
    const onHash = () => { if (location.hash.startsWith('#boards')) setOpenState(fromHash()); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // However a board was opened (click, link, search), it goes first among the recent ones, and its workspace shows.
  useEffect(() => {
    const id = open.board;
    if (id) setRecent((cur) => { const r = [id, ...cur.filter((x) => x !== id)].slice(0, 8); ls.set(LS_RECENT, r); return r; });
  }, [open.board]);
  useEffect(() => { const b = boards?.find((x) => x.id === open.board); if (b && b.workspaceId !== wsId) setWsId(b.workspaceId); }, [open.board, boards]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open.people && open.people !== wsId) setWsId(open.people); }, [open.people]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (board: string | null, card: string | null = null) => {
    setSwitching(false);
    visit({board,card,people:null,ws:wsId});
    if (!board) load();
  };
  const goPeople=(id:string)=>visit({board:null,card:null,people:id,ws:id});
  const goHome=(id?:string)=>{visit({board:null,card:null,people:null,ws:id||wsId});void load();};
  const star = async (b: BoardItem) => {
    setBoards((bs) => bs && bs.map((x) => (x.id === b.id ? { ...x, starred: !b.starred } : x)));
    await api.starBoard(b.id, !b.starred).catch((e) => { toast(e.message, true); load(); });
  };
  // A board's own "⋯" (sidebar and tiles), like Trello's: its admins delete it here too.
  const moreOf = (b: BoardItem) => (b.level === 'admin' ? (el: HTMLElement) => setBoardMenu(boardMenu?.b.id === b.id ? null : { b, el }) : undefined);
  // Only its owner deletes a workspace, with every board in it.
  const removeWorkspace = async (w: Workspace) => {
    setWsAct(null); setWsMenu(null);
    const n = (boards || []).filter((b) => b.workspaceId === w.id).length;
    if (!confirm(`Xoá vĩnh viễn workspace “${w.name}”${n ? ` cùng ${n} board trong đó` : ''}? Không khôi phục được.`)) return;
    try { await api.deleteWorkspace(w.id); toast(`Đã xoá workspace “${w.name}”`); setWsId('company'); go(null); } catch (e: any) { toast(e.message, true); }
  };
  const removeBoard = async (b: BoardItem) => {
    setBoardMenu(null);
    if (!confirm(`Xoá vĩnh viễn board “${b.name}” cùng mọi danh sách và thẻ trong đó? Không khôi phục được.`)) return;
    try { await api.deleteBoard(b.id); toast(`Đã xoá board “${b.name}”`); if (open.board === b.id) go(null); else load(); } catch (e: any) { toast(e.message, true); }
  };
  const byId = new Map((boards || []).map((b) => [b.id, b]));
  const recentBoards = recent.map((id) => byId.get(id)).filter(Boolean) as BoardItem[];
  const ws = spaces.find((w) => w.id === wsId) || spaces[0];
  const inWs = (id: string) => (boards || []).filter((b) => b.workspaceId === id);
  const ordered = ws ? [ws, ...spaces.filter((w) => w.id !== ws.id)] : spaces;
  const openWs = spaces.find((w) => w.id === byId.get(open.board || '')?.workspaceId);

  return (
    <div className="bd-page">
      <TopNav ws={ws} me={me} onOpen={go} onCreate={() => setCreating(ws?.level === 'observer' ? 'company' : ws?.id || 'company')}
        onWorkspaces={(el) => setWsMenu(wsMenu ? null : el)} wsOpen={!!wsMenu} navigation={<nav className="bd-route-nav" aria-label="Điều hướng board"><button disabled={trail.current.at===0} onClick={()=>step(-1)} title="Quay lại" aria-label="Quay lại"><Icon name="left" size={16}/></button><button disabled={trail.current.at>=trail.current.items.length-1} onClick={()=>step(1)} title="Đi tới" aria-label="Đi tới"><Icon name="right" size={16}/></button><button onClick={()=>goHome()} title="Tất cả board" aria-label="Tất cả board"><Icon name="boards" size={15}/><span>Tất cả board</span></button>{open.people?<><Icon name="right" size={12}/><span>Thành viên workspace</span></>:open.board?<><Icon name="right" size={12}/><button onClick={()=>go(open.board)}>{byId.get(open.board)?.name||'Board'}</button>{open.card&&<><Icon name="right" size={12}/><span>Chi tiết thẻ</span><button onClick={()=>go(open.board)}>Về board</button></>}</>:null}</nav>} />

      <div className="bd-main">
        {panels.inbox && <InboxPanel onHide={() => toggle('inbox', false)} />}
        {panels.planner && <PlannerPanel bgOf={bg} onOpen={(b, c) => go(b, c)} onHide={() => toggle('planner', false)} />}
        {panels.board && <div className="bd-pane">{open.board
          ? <BoardView key={open.board} id={open.board} card={open.card} me={me} roles={roles} ws={openWs} onStar={star} onGone={() => go(null)} onChanged={load}
              onCard={(card) => go(open.board, card)} />
          : open.people
          ? <WorkspacePeople key={open.people} ws={spaces.find((w) => w.id === open.people)} me={me} onChanged={load} onGone={() => { setWsId('company'); go(null); }} />
          : (
            <main className="bd-home">
              {boards === null ? <BrandLoading label="Đang tải…"/> : <>
                {recentBoards.length > 0 && <Tiles title="Đã xem gần đây" icon={<Icon name="clock" size={16} />} list={recentBoards.slice(0, 4)} roles={roles} onOpen={go} onStar={star} onMore={moreOf} />}
                {boards.some((b) => b.starred) && <Tiles title="Board đã gắn sao" icon={<Icon name="star" size={16} />} list={boards.filter((b) => b.starred)} roles={roles} onOpen={go} onStar={star} onMore={moreOf} />}
                <h2 className="bd-home-h">Các workspace của bạn</h2>
                {ordered.map((w) => (
                  <WorkspaceSection key={w.id} ws={w} me={me} roles={roles} boards={inWs(w.id)} onOpen={go} onStar={star} onMore={moreOf}
                    onSettings={w.kind === 'personal' && w.ownerId === me.id ? (el) => setWsAct(wsAct?.w.id === w.id ? null : { w, el }) : undefined}
                    onCreate={w.level !== 'observer' ? () => setCreating(w.id) : undefined} onPeople={() => goPeople(w.id)} onHome={() => goHome(w.id)} />
                ))}
                <button className="bd-ws-new" onClick={() => setNewWs(true)}><Icon name="plus" size={16} />Tạo workspace mới</button>
              </>}
            </main>
          )}</div>}
      </div>
      <Dock panels={panels} onToggle={(k) => toggle(k)} onSwitch={() => setSwitching(!switching)} switching={switching} />
      {switching && <SwitchBoards boards={boards || []} spaces={spaces} recent={recentBoards} current={open.board} bgOf={bg} onOpen={(b) => go(b)} onClose={() => setSwitching(false)}
        onHome={() => { setSwitching(false); if (!panels.board) toggle('board', true); goHome(); }} onCreate={() => { setSwitching(false); setCreating(ws?.level === 'observer' ? 'company' : ws?.id || 'company'); }} />}
      {wsMenu && (
        <Pop anchor={wsMenu} title="Workspace" onClose={() => setWsMenu(null)}>
          <div className="bk-menu bk-menu-rich">
            {spaces.map((w) => (
              <button key={w.id} onClick={() => { setWsMenu(null); goHome(w.id); }}>
                <WsMark ws={w} size={28} /><span><b>{w.name}</b><small>{wsKind(w, me)}</small></span>{w.id === ws?.id && <Icon name="check" size={15} />}
              </button>
            ))}
            <hr />
            <button onClick={() => { setWsMenu(null); setNewWs(true); }}><Icon name="plus" size={16} /><span><b>Tạo workspace mới</b><small>Riêng tư; chia sẻ với ai tuỳ bạn.</small></span></button>
            {ws && (ws.level === 'admin') && <>
              <button onClick={() => { setWsMenu(null); goPeople(ws.id); }}><Icon name="users" size={16} /><span><b>Thành viên và cài đặt</b><small>{ws.name}</small></span></button>
              {ws.kind === 'personal' && (ws.ownerId === me.id || me.role === 'admin') && <button className="bk-danger" onClick={() => removeWorkspace(ws)}><Icon name="trash" size={16} /><span><b>Xoá workspace này</b><small>{ws.name}</small></span></button>}
            </>}
          </div>
        </Pop>
      )}
      {wsAct && (
        <Pop anchor={wsAct.el} title={wsAct.w.name} onClose={() => setWsAct(null)}>
          <div className="bk-menu">
            <button onClick={() => { const w = wsAct.w; setWsAct(null); goPeople(w.id); }}><Icon name="users" size={15} />Thành viên và cài đặt</button>
            <button onClick={() => { const w = wsAct.w; setWsAct(null); setCreating(w.id); }}><Icon name="plus" size={15} />Tạo board trong workspace này</button>
            <hr />
            <button className="bk-danger" onClick={() => removeWorkspace(wsAct.w)}><Icon name="trash" size={15} />Xoá workspace</button>
          </div>
        </Pop>
      )}
      {boardMenu && (
        <Pop anchor={boardMenu.el} title={boardMenu.b.name} onClose={() => setBoardMenu(null)}>
          <div className="bk-menu">
            <button onClick={() => { setBoardMenu(null); go(boardMenu.b.id); }}><Icon name="grid" size={15} />Mở board</button>
            <button onClick={() => { const b = boardMenu.b; setBoardMenu(null); star(b); }}><Icon name="star" size={15} />{boardMenu.b.starred ? 'Bỏ gắn sao' : 'Gắn sao'}</button>
            <hr />
            <button className="bk-danger" onClick={() => removeBoard(boardMenu.b)}><Icon name="trash" size={15} />Xoá board</button>
          </div>
        </Pop>
      )}
      {creating && <CreateBoard me={me} roles={roles} spaces={spaces} wsId={creating} onClose={() => setCreating(null)} onCreated={(b) => { setCreating(null); go(b.id); }} />}
      {newWs && <CreateWorkspace onClose={() => setNewWs(false)} onCreated={(w) => { setNewWs(false); setSpaces((x) => [...x, w]); goPeople(w.id); }} />}
    </div>
  );
}

/** A workspace on the home page: its boards (the company's by role), with ways to its members and to a new board. */
function WorkspaceSection({ ws, me, roles, boards, onOpen, onStar, onMore, onCreate, onPeople, onHome, onSettings }: {
  ws: Workspace; me: User; roles: TeamRole[]; boards: BoardItem[]; onOpen: (id: string) => void; onStar: (b: BoardItem) => void;
  onMore: (b: BoardItem) => ((el: HTMLElement) => void) | undefined; onCreate?: () => void; onPeople: () => void; onHome: () => void;
  onSettings?: (el: HTMLElement) => void;
}) {
  const myRole = roles.find((r) => r.id === me.teamRole);
  const mine = boards.filter((b) => b.roleId && b.roleId === me.teamRole), byRole = boards.filter((b) => b.roleId && b.roleId !== me.teamRole), rest = boards.filter((b) => !b.roleId);
  return (
    <section className="bd-wsec">
      <div className="bd-wsec-h">
        <WsMark ws={ws} size={30} />
        <div><b>{ws.name}</b><span>{wsKind(ws, me)}</span></div>
        <span className="bd-gap" />
        <button className="bd-wsec-b" onClick={onHome}><Icon name="grid" size={14} />Board</button>
        <button className="bd-wsec-b" onClick={onPeople}><Icon name="users" size={14} />Thành viên ({ws.members})</button>
        {onSettings && <button className="bd-wsec-b bd-wsec-more" onClick={(e) => onSettings(e.currentTarget)} aria-label={`Thao tác với workspace ${ws.name}`} title="Cài đặt, xoá workspace"><Icon name="more" size={15} /></button>}
      </div>
      <Tiles title="Board của bạn" list={boards} roles={roles} onOpen={onOpen} onStar={onStar} onMore={onMore} onCreate={onCreate} small />
    </section>
  );
}

/** The bar on top: workspaces, recent and starred boards, create, and search across boards and cards. */
/** The bar on top, like Trello's: the workspace (switch it there), search in the middle with "create" beside it. */
function TopNav({ ws, me, onOpen, onCreate, onWorkspaces, wsOpen, navigation }: {
  navigation: ReactNode; ws: Workspace | undefined; me: User; onOpen: (board: string, card?: string | null) => void; onCreate: () => void; onWorkspaces: (el: HTMLElement) => void; wsOpen: boolean;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Awaited<ReturnType<typeof api.searchBoards>> | null>(null);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => api.searchBoards(q.trim()).then(setHits).catch(() => setHits(null)), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="bd-top">
      <button className={'bd-top-ws' + (wsOpen ? ' on' : '')} onClick={(e) => onWorkspaces(e.currentTarget)} aria-label="Đổi workspace" title={ws ? wsKind(ws, me) : 'Workspace'}>
        {ws && <WsMark ws={ws} size={26} />}<b>{ws?.name || 'Workspace'}</b><Icon name="chevron" size={12} />
      </button>
      {navigation}
      <div className="bd-top-mid">
        <div className="bd-search">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 200)} placeholder="Tìm thẻ, board…" aria-label="Tìm kiếm" />
          {focus && hits && (
            <div className="bd-search-pop">
              {!hits.boards.length && !hits.cards.length && <p className="note">Không tìm thấy gì cho “{q}”.</p>}
              {hits.boards.length > 0 && <h5>Board</h5>}
              {hits.boards.map((b) => <button key={b.id} className="bd-hit" onMouseDown={() => { setQ(''); onOpen(b.id); }}><i style={{ background: bg(b.bg) }} /><span><b>{b.name}</b></span></button>)}
              {hits.cards.length > 0 && <h5>Thẻ</h5>}
              {hits.cards.map((c) => <button key={c.id} className="bd-hit" onMouseDown={() => { setQ(''); onOpen(c.boardId, c.id); }}><i style={{ background: bg(c.boardBg) }} /><span><b>{c.title}</b><small>{c.boardName} · {c.listName}</small></span></button>)}
            </div>
          )}
        </div>
        <button className="btn btn-primary btn-sm bd-top-create" onClick={onCreate}><Icon name="plus" size={14} />Tạo mới</button>
      </div>

    </div>
  );
}

function Tiles({ title, icon, list, roles, onOpen, onStar, onMore, onCreate, small }: {
  title?: string; icon?: ReactNode; list: BoardItem[]; roles: TeamRole[]; onOpen: (id: string) => void; onStar: (b: BoardItem) => void;
  onMore?: (b: BoardItem) => ((el: HTMLElement) => void) | undefined; onCreate?: () => void; small?: boolean;
}) {
  if (!list.length && !onCreate) return null;
  return (
    <section className={'bd-sec' + (small ? ' bd-sec-sm' : '')}>
      {title && <h2><span className="bd-sec-i">{icon}</span>{title}</h2>}
      <div className="bd-tiles">
        {list.map((b) => {
          const role = roles.find((r) => r.id === b.roleId);
          return (
            <div key={b.id} className="bd-tile" style={{ background: bg(b.bg) }}>
              <button className="bd-tile-b" onClick={() => onOpen(b.id)}>
                <b>{b.name}</b>
                {(role && role.name !== b.name) || b.private || b.level === 'observer'
                  ? <span>{b.private && <Icon name="lock" size={11} />}{role && role.name !== b.name ? role.name : b.private ? 'Riêng tư' : ''}{b.level === 'observer' ? `${role || b.private ? ' · ' : ''}Chỉ xem` : ''}</span> : null}
              </button>
              <button className={'bd-tile-star' + (b.starred ? ' on' : '')} onClick={() => onStar(b)} aria-label={b.starred ? 'Bỏ sao' : 'Gắn sao'}><Icon name="star" size={15} /></button>
              {onMore?.(b) && <button className="bd-tile-more" onClick={(e) => onMore(b)!(e.currentTarget)} aria-label={`Thao tác với board ${b.name}`}><Icon name="more" size={15} /></button>}
            </div>
          );
        })}
        {onCreate && <button className="bd-tile bd-tile-new" onClick={onCreate}>Tạo board mới</button>}
      </div>
    </section>
  );
}

/** Name, background, workspace and who sees it: the workspace, one role (company only, members: their own) or only the people added. */
function CreateBoard({ me, roles, spaces, wsId, onClose, onCreated }: { me: User; roles: TeamRole[]; spaces: Workspace[]; wsId: string; onClose: () => void; onCreated: (b: BoardItem) => void }) {
  const[ownSpaces,setOwnSpaces]=useState(spaces);
  const targets = ownSpaces.filter((w) => w.level !== 'observer');
  const [name, setName] = useState('');
  const [b, setB] = useState('ocean');
  const [space, setSpace] = useState(targets.some((w) => w.id === wsId) ? wsId : targets[0]?.id || 'company');
  // 'ws' (a person's workspace), 'private', or a department (company role): a company board belongs to one, or is private.
  const vis='private';
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const roleId = null;
    try { onCreated(await api.createBoard({ name: name.trim(), bg: b, workspaceId: space, roleId, private: vis === 'private' })); } catch (err: any) { toast(err.message, true); setBusy(false); }
  };
  return (
    <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="bd-create" onSubmit={submit}>
        <header><b>Tạo board</b><button type="button" className="bd-icon" onClick={onClose} aria-label="Đóng"><Icon name="x" size={15} /></button></header>
        <div className="bd-create-prev" style={{ background: bg(b) }}><span /><span /><span /></div>
        <span className="bd-label">Phông nền</span>
        <div className="bd-swatches">{Object.keys(BG).map((k) => <button type="button" key={k} className={k === b ? 'on' : ''} style={{ background: BG[k] }} onClick={() => setB(k)} aria-label={`Nền ${k}`} />)}</div>
        <label className="bd-label" htmlFor="bd-name">Tiêu đề board <em>*</em></label>
        <input id="bd-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Dynamic M · Black Friday" />
        <label className="bd-label" htmlFor="bd-ws">Workspace</label>
        <EntitySelect kind="workspace" onCreated={async()=>setOwnSpaces(await api.workspaces())} id="bd-ws" value={space} onChange={setSpace}>
          {targets.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
        </EntitySelect>
        <p className="note"><Icon name="lock" size={14}/> Board cá nhân. Chỉ bạn và thành viên được thêm vào board mới xem được.</p>
        <button className="btn btn-primary" disabled={!name.trim() || busy}>{busy ? 'Đang tạo…' : 'Tạo mới'}</button>
      </form>
    </div>
  );
}

/** A workspace of one's own: private until its owner shares it. */
function CreateWorkspace({ onClose, onCreated }: { onClose: () => void; onCreated: (w: Workspace) => void }) {
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'company'>('private');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try { onCreated(await api.createWorkspace({ name: name.trim(), about: about.trim(), visibility })); } catch (err: any) { toast(err.message, true); setBusy(false); }
  };
  return (
    <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="bd-create" onSubmit={submit}>
        <header><b>Tạo workspace</b><button type="button" className="bd-icon" onClick={onClose} aria-label="Đóng"><Icon name="x" size={15} /></button></header>
        <p className="bd-create-note">Workspace là nơi gom các board của bạn. Mặc định riêng tư: chỉ bạn thấy cho tới khi bạn mời người khác, mỗi người một quyền (Quản trị, Thành viên hoặc Chỉ xem).</p>
        <label className="bd-label" htmlFor="ws-name">Tên workspace <em>*</em></label>
        <input id="ws-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Việc riêng của Giang, Dự án Tết 2027" />
        <label className="bd-label" htmlFor="ws-about">Mô tả (không bắt buộc)</label>
        <textarea id="ws-about" rows={3} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Workspace này dùng để làm gì" />
        <label className="bd-label" htmlFor="ws-vis">Quyền xem</label>
        <select id="ws-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'company')}>
          <option value="private">Riêng tư: chỉ người được mời</option>
          <option value="company">Cả công ty xem được (chỉ xem; người được mời mới sửa)</option>
        </select>
        <button className="btn btn-primary" disabled={!name.trim() || busy}>{busy ? 'Đang tạo…' : 'Tạo workspace'}</button>
      </form>
    </div>
  );
}

/** Pick someone in the company (by name or email) and the level to give them. */
function PeopleAdd({ people, button, onAdd }: { people: Person[]; button: string; onAdd: (id: string, level: Level) => void }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Person | null>(null);
  const [level, setLevel] = useState<Level>('normal');
  const [focus, setFocus] = useState(false);
  const needle = q.trim().toLowerCase();
  const hits = people.filter((p) => !needle || `${p.name} ${p.email}`.toLowerCase().includes(needle)).slice(0, 8);
  return (
    <div className="bd-add-people">
      <div className="bd-pick">
        {pick
          ? <span className="bd-chip"><Avatar m={pick} size={22} />{pick.name}<button type="button" onClick={() => setPick(null)} aria-label="Bỏ chọn"><Icon name="x" size={12} /></button></span>
          : <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} placeholder="Tên hoặc email người trong công ty" aria-label="Tìm người" />}
        {!pick && focus && (
          <div className="bd-pick-pop">
            {hits.length ? hits.map((p) => (
              <button type="button" key={p.id} onMouseDown={() => { setPick(p); setQ(''); }}><Avatar m={p} size={26} /><span><b>{p.name}</b><small>{p.email}</small></span></button>
            )) : <p className="note">{people.length ? 'Không có ai khớp.' : 'Mọi người đều đã ở đây.'}</p>}
          </div>
        )}
      </div>
      <LevelSelect value={level} onChange={setLevel} label="Quyền" />
      <QuickCreateButton kind="employee" onCreated={async r=>{const user=(await api.users()).find(u=>u.id===r.id);if(!user)throw new Error('Chưa tải được nhân viên mới');setPick(user);setQ('');}}/>
      <button type="button" className="btn btn-primary btn-sm" disabled={!pick} onClick={() => { if (pick) { onAdd(pick.id, level); setPick(null); } }}>{button}</button>
    </div>
  );
}

/** A workspace's people: who is in it at which level; its admins invite, change and remove; anyone may leave. */
function WorkspacePeople({ ws, me, onChanged, onGone }: { ws: Workspace | undefined; me: User; onChanged: () => void; onGone: () => void }) {
  const [data, setData] = useState<{ members: WorkspaceMember[]; people: Person[] } | null>(null);
  const [name, setName] = useState(ws?.name || '');
  const [about, setAbout] = useState(ws?.about || '');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ws) api.workspaceMembers(ws.id).then(setData).catch((e) => toast(e.message, true)); }, [ws?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The page may open before the workspaces have loaded.
  useEffect(() => { setName(ws?.name || ''); setAbout(ws?.about || ''); }, [ws?.id, ws?.name, ws?.about]);
  if (!ws) return <main className="bd-home"><p className="note">Không tìm thấy workspace này, hoặc bạn không còn ở trong đó.</p></main>;
  const admin = ws.level === 'admin', company = ws.kind === 'company';
  const changeAvatar = async (file: File | null) => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    try {
      await api.setWorkspaceAvatar(ws.id, file ? await fileToAvatarDataUrl(file) : null);
      onChanged(); toast(file ? 'Đã đổi ảnh đại diện workspace' : 'Đã xoá ảnh đại diện workspace');
    } catch (e: any) { toast(e.message, true); }
    finally { setAvatarBusy(false); }
  };
  const done = (r: { members: WorkspaceMember[] }) => { setData((d) => d && { ...d, members: r.members }); onChanged(); };
  const set = (userId: string, level: Level) => api.setWorkspaceMember(ws.id, userId, level).then(done, (e) => toast(e.message, true));
  const remove = async (m: WorkspaceMember) => {
    const self = m.id === me.id;
    if (!confirm(self ? `Rời workspace “${ws.name}”? Bạn sẽ không còn thấy các board trong đó.` : `Gỡ ${m.name} khỏi workspace “${ws.name}”?`)) return;
    try { const r = await api.removeWorkspaceMember(ws.id, m.id); if (self) { onChanged(); onGone(); } else done(r); } catch (e: any) { toast(e.message, true); }
  };
  const save = (b: Partial<{ name: string; about: string; visibility: 'private' | 'company' }>) => api.updateWorkspace(ws.id, b).then(onChanged, (e) => toast(e.message, true));
  const del = async () => {
    if (!confirm(`Xoá vĩnh viễn workspace “${ws.name}” cùng mọi board trong đó?`)) return;
    try { await api.deleteWorkspace(ws.id); onChanged(); onGone(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <main className="bd-home bd-people">
      <header className="bd-people-h">
        <div className="bd-ws-avatar-editor">
          <button type="button" className="bd-ws-avatar-button" disabled={!admin || avatarBusy} onClick={() => avatarInput.current?.click()} aria-label="Đổi ảnh đại diện workspace" title="Đổi ảnh đại diện workspace"><WsMark ws={ws} size={56}/></button>
          {admin && <><input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void changeAvatar(file); }}/>
            <button className="link" disabled={avatarBusy} onClick={() => avatarInput.current?.click()}>{avatarBusy ? 'Đang lưu…' : 'Đổi ảnh'}</button>
            {ws.avatar && <button className="link" disabled={avatarBusy} onClick={() => void changeAvatar(null)}>Xoá ảnh</button>}</>}
        </div>
        <div>
          {admin && !company
            ? <input className="bd-people-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== ws.name && save({ name: name.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Tên workspace" />
            : <h1>{ws.name}</h1>}
          <span>{wsKind(ws, me)}</span>
        </div>
      </header>
      {!company && admin && (
        <label className="bd-people-vis"><span>Quyền xem</span>
          <select className="bd-level-sel" value={ws.visibility} onChange={(e) => save({ visibility: e.target.value as 'private' | 'company' })}>
            <option value="private">Riêng tư: chỉ người được mời</option>
            <option value="company">Cả công ty xem được (chỉ xem; người được mời mới sửa)</option>
          </select>
        </label>
      )}
      {!company && (admin
        ? <textarea className="bd-people-about" rows={2} value={about} onChange={(e) => setAbout(e.target.value)} onBlur={() => about !== ws.about && save({ about })} placeholder="Mô tả workspace (không bắt buộc)" />
        : ws.about && <p className="bd-people-about-t">{ws.about}</p>)}
      {company
        ? <p className="note">Mọi tài khoản của công ty đều ở workspace này; thêm người, đổi phòng ban (role) ở trang Quản trị. Quản trị viên xem được mọi board; mỗi phòng chỉ xem board của phòng mình; ai được thêm vào một board thì xem theo quyền được cấp ở board đó.</p>
        : admin && data && <section className="bd-people-sec"><h3>Mời vào workspace</h3><PeopleAdd people={data.people.filter((p) => !data.members.some((m) => m.id === p.id))} button="Mời" onAdd={set} /></section>}
      <section className="bd-people-sec">
        <h3>Thành viên ({data?.members.length ?? ws.members})</h3>
        {!data ? <BrandLoading label="Đang tải…"/> : (
          <ul className="bd-people-list">
            {data.members.map((m) => (
              <li key={m.id}>
                <Avatar m={m} size={36} />
                <div><b>{m.name}{m.id === me.id ? ' (bạn)' : ''}</b><span>{m.email}</span></div>
                {admin && !company && !m.owner ? <LevelSelect value={m.level} onChange={(l) => set(m.id, l)} label={`Quyền của ${m.name}`} /> : <em className="bd-level">{m.owner ? 'Người tạo' : LEVEL_NAME[m.level]}</em>}
                {!company && !m.owner && (admin || m.id === me.id) && <button className="btn btn-gray btn-sm" onClick={() => remove(m)}>{m.id === me.id ? 'Rời' : 'Gỡ'}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {!company && ws.ownerId === me.id && (
        <section className="bd-people-sec bd-danger-zone">
          <h3>Xoá workspace</h3>
          <p className="note">Xoá vĩnh viễn workspace này cùng mọi board, danh sách và thẻ trong đó. Không khôi phục được.</p>
          <button className="btn btn-sm cm-danger" onClick={del}><Icon name="trash" size={14} />Xoá workspace “{ws.name}”</button>
        </section>
      )}
    </main>
  );
}

/** Trello's "Share": people added to the board at a level, and who sees it anyway (its workspace or role). */
function ShareBoard({ board, ws, role, me, onClose, onChanged }: { board: Board; ws: Workspace | undefined; role: TeamRole | undefined; me: User; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ members: BoardMember[]; people: Person[] } | null>(null);
  useEffect(() => { api.boardMembers(board.id).then(setData).catch((e) => toast(e.message, true)); }, [board.id]);
  const admin = board.level === 'admin';
  const done = (r: { members: BoardMember[] }) => { setData((d) => d && { ...d, members: r.members }); onChanged(); };
  const set = (userId: string, level: Level) => api.setBoardMember(board.id, userId, level).then(done, (e) => toast(e.message, true));
  const remove = async (m: BoardMember) => {
    const self = m.id === me.id;
    if (self && !confirm(`Rời board “${board.name}”?`)) return;
    try { const r = await api.removeBoardMember(board.id, m.id); if (self) { onClose(); onChanged(); } else done(r); } catch (e: any) { toast(e.message, true); }
  };
  const added = data?.members.filter((m) => m.added) || [], others = data?.members.filter((m) => !m.added) || [];
  const scope='Board cá nhân: chỉ chủ board và thành viên được thêm trực tiếp mới được xem. Quyền phòng ban và workspace không cấp quyền xem board.';
  const row = (m: BoardMember) => (
    <li key={m.id}>
      <Avatar m={m} size={32} />
      <div><b>{m.name}{m.id === me.id ? ' (bạn)' : ''}</b><span>{m.email}</span></div>
      {m.id===board.createdBy?<em className="bd-level">Chủ board</em>:admin && m.added ? <LevelSelect value={m.level || 'normal'} onChange={(l) => set(m.id, l)} label={`Quyền của ${m.name}`} /> : <em className="bd-level">{LEVEL_NAME[m.level || 'normal']}</em>}
      {m.id===board.createdBy?<span/>:m.added && (admin || m.id === me.id) ? <button className="btn btn-gray btn-sm" onClick={() => remove(m)}>{m.id === me.id ? 'Rời' : 'Gỡ'}</button>
        : !m.added && admin && m.id!==board.createdBy ? <button className="btn btn-gray btn-sm" onClick={() => set(m.id, m.level || 'normal')} title="Cấp quyền riêng cho người này trên board">Thêm</button> : <span />}
    </li>
  );
  return (
    <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bd-share" role="dialog" aria-label="Chia sẻ board">
        <header><b>Chia sẻ board</b><button className="bd-icon" onClick={onClose} aria-label="Đóng"><Icon name="x" size={15} /></button></header>
        {admin && data && <PeopleAdd people={data.people.filter((p) => !added.some((m) => m.id === p.id))} button="Chia sẻ" onAdd={set} />}
        {!admin && <p className="note">Chỉ quản trị board mới mời người hoặc đổi quyền được.</p>}
        <p className="bd-share-scope"><Icon name={role || board.private ? 'lock' : 'users'} size={14} />{scope}</p>
        {!data ? <BrandLoading label="Đang tải…"/> : <>
          <h5>Người được thêm vào board ({added.length})</h5>
          {added.length ? <ul className="bd-people-list">{added.map(row)}</ul> : <p className="note">Chưa thêm ai riêng cho board này.</p>}
          {others.length > 0 && <><h5>Xem được qua {role ? `phòng ${role.name}` : ws?.kind === 'personal' ? 'workspace' : 'quyền quản trị'} ({others.length})</h5><ul className="bd-people-list">{others.map(row)}</ul></>}
        </>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one board
type Drag = { kind: 'card'; id: string; from: string; h: number } | { kind: 'list'; id: string; w: number };
type Filter = { q: string; members: string[]; labels: string[]; due: string[]; done: '' | 'done' | 'open' };
const NO_FILTER: Filter = { q: '', members: [], labels: [], due: [], done: '' };
const filtering = (f: Filter) => !!(f.q.trim() || f.members.length || f.labels.length || f.due.length || f.done);
function matches(c: BoardCard, f: Filter, me: string) {
  if (f.q.trim() && !c.title.toLowerCase().includes(f.q.trim().toLowerCase())) return false;
  if (f.members.length && !f.members.some((m) => (m === 'none' ? !c.members.length : c.members.includes(m === 'me' ? me : m)))) return false;
  if (f.labels.length && !f.labels.some((l) => (l === 'none' ? !c.labels.length : c.labels.includes(l)))) return false;
  if (f.due.length) {
    const left = c.dueAt ? c.dueAt - Date.now() : null;
    const ok = f.due.some((d) => (d === 'none' ? !c.dueAt : left === null ? false : d === 'over' ? left < 0 && !c.done : d === 'day' ? left >= 0 && left < 864e5 : d === 'week' ? left >= 0 && left < 7 * 864e5 : left >= 0 && left < 30 * 864e5));
    if (!ok) return false;
  }
  if (f.done && (f.done === 'done') !== c.done) return false;
  return true;
}

function BoardView({ id, card, me, roles, ws, onStar, onGone, onChanged, onCard }: {
  id: string; card: string | null; me: User; roles: TeamRole[]; ws: Workspace | undefined; onStar: (b: BoardItem) => void; onGone: () => void; onChanged: () => void; onCard: (id: string | null) => void;
}) {
  const [b, setB] = useState<Board | null>(null);
  const [view, setView] = useState<BoardViewKind>('board');
  const [cardLevel, setCardLevel] = useState<'all' | 'customer' | 'project' | 'task'>('all');
  const [viewEl, setViewEl] = useState<HTMLElement | null>(null);
  const [quick, setQuick] = useState<{id: string; rect: DOMRect} | null>(null);
  const [err, setErr] = useState('');
  const [dragging, setDragging] = useState<string | null>(null); // the card or list being dragged (hidden in place)
  const [ph, setPhState] = useState<{ list: string; index: number } | null>(null);
  const [lph, setLphState] = useState<number | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [filterEl, setFilterEl] = useState<HTMLElement | null>(null);
  const [visEl, setVisEl] = useState<HTMLElement | null>(null);
  const [sharing, setSharing] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const drag = useRef<Drag | null>(null), phRef = useRef(ph), lphRef = useRef(lph), busy = useRef(0);
  const setPh = (v: typeof ph) => { phRef.current = v; setPhState(v); };
  const setLph = (v: number | null) => { lphRef.current = v; setLphState(v); };
  const load = () => api.board(id).then((x) => { if (!drag.current && !busy.current) setB(x); }, (e) => setErr(e.message));
  useEntityRefresh(load);
  // Others' changes show up within a few seconds.
  useEffect(() => { load(); const t = setInterval(() => document.visibilityState === 'visible' && load(), 15000); return () => clearInterval(t); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useChanged('board', () => load());
  // A drag from another panel (the Inbox) that ends anywhere leaves no gap behind.
  useEffect(() => { const f = () => { if (!drag.current) setPh(null); }; window.addEventListener('dragend', f); return () => window.removeEventListener('dragend', f); }, []);
  const mut = (fn: (x: Board) => void) => setB((cur) => { if (!cur) return cur; const x = structuredClone(cur); fn(x); return x; });
  const act = async (fn: () => Promise<unknown>) => {
    busy.current++;
    try { await fn(); } catch (e: any) { toast(e.message, true); } finally { busy.current--; if (!busy.current) load(); }
  };
  if (err) return <main className="bd-board"><p className="note err" style={{ padding: 24 }}>{err}</p></main>;
  if (!b) return <main className="bd-board"><p className="note" style={{ padding: 24 }}>Đang tải…</p></main>;
  const role = roles.find((r) => r.id === b.roleId);
  // Who sees the board, like Trello's visibility button (a role board is usually named after its role).
  // In the company's workspace a board belongs to one department (role) or is private; in a person's, it is the workspace's or private.
  const company = !ws || ws.kind === 'company', priv = true;
  const visText='Riêng tư';
  const visTip='Chỉ người tạo board mới xem được';

  // Observers read and comment only; members work on cards; the board itself (name, background, how it shows, lists,
  // labels) is changed by its admins, and by members when an admin allows it. Everyone sees it as it was set.
  const canEdit = b.level !== 'observer', isAdmin = b.level === 'admin', canShape = b.canShape, labelText = b.labelText;
  const fold = (lid: string) => {
    if (!canShape) return;
    const to = !b.lists.find((l) => l.id === lid)?.folded;
    mut((x) => { x.lists.find((l) => l.id === lid)!.folded = to; });
    act(() => api.updateList(lid, { folded: to }));
  };
  const toggleLabels = () => { if (!canShape) return; mut((x) => { x.labelText = !x.labelText; }); act(() => api.updateBoard(b.id, { labelText: !labelText })); };
  const on = filtering(filter);
  const shown = on ? b.lists.reduce((n, l) => n + l.cards.filter((c) => matches(c, filter, me.id)).length, 0) : 0;

  const endDrag = () => { drag.current = null; dragged.card = null; setDragging(null); setPh(null); setLph(null); };
  const startCard = (e: React.DragEvent<HTMLElement>, cardId: string, listId: string) => {
    let actualListId = listId;
    let foundCard: BoardCard | undefined;
    for (const l of b.lists) {
      const c = (l.cards || []).find((x) => x?.id === cardId);
      if (c) {
        foundCard = c;
        actualListId = l.id;
        break;
      }
    }
    drag.current = { kind: 'card', id: cardId, from: actualListId, h: e.currentTarget.offsetHeight };
    dragged.card = foundCard && canEdit ? { id: foundCard.id, dueAt: foundCard.dueAt, startAt: foundCard.startAt } : null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardId);
    setTimeout(() => setDragging(cardId), 0); // after the browser has taken its picture of the card
  };
  const overList = (e: React.DragEvent<HTMLElement>, listId: string) => {
    const d = drag.current;
    if (d?.kind !== 'card' && !(dragged.inbox && canEdit)) return;
    e.preventDefault(); e.stopPropagation();
    const els = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card]')].filter((el) => el.dataset.card !== d?.id);
    let i = els.findIndex((el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (i < 0) i = els.length;
    if (phRef.current?.list !== listId || phRef.current.index !== i) setPh({ list: listId, index: i });
  };
  const dropCard = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const d = drag.current, to = phRef.current, inbox = dragged.inbox;
    endDrag();
    // An Inbox item becomes a card of the list, where it was dropped.
    if (!d && inbox && to) {
      dragged.inbox = null;
      const target = b.lists.find((l) => l.id === to.list);
      if (!target) return;
      const validCards = (target.cards || []).filter(Boolean);
      const anchor = validCards.filter((c) => !on || matches(c, filter, me.id))[to.index];
      const index = anchor ? validCards.indexOf(anchor) : validCards.length;
      act(async () => {
        const c = await api.inboxToList(inbox.id, to.list, index);
        mut((x) => {
          const tgt = x.lists.find((l) => l.id === to.list);
          if (tgt) {
            if (!tgt.cards) tgt.cards = [];
            tgt.cards.splice(index, 0, c);
          }
        });
        changed('inbox');
      });
      return;
    }
    if (d?.kind !== 'card' || !to) return;
    // The place among the cards shown (filters may hide some) becomes the place among all of the list's cards.
    const target = b.lists.find((l) => l.id === to.list);
    if (!target) return;
    const validCards = (target.cards || []).filter(Boolean);
    const rest = validCards.filter((c) => c.id !== d.id);
    const anchor = rest.filter((c) => !on || matches(c, filter, me.id))[to.index];
    const index = anchor ? rest.findIndex((c) => c.id === anchor.id) : rest.length;
    mut((x) => {
      let moved: BoardCard | undefined;
      for (const list of x.lists) {
        if (!list.cards) continue;
        const k = list.cards.findIndex((c) => c?.id === d.id);
        if (k >= 0) {
          [moved] = list.cards.splice(k, 1);
          break;
        }
      }
      if (!moved) return;
      moved.listId = to.list;
      const tgt = x.lists.find((l) => l.id === to.list);
      if (tgt) {
        if (!tgt.cards) tgt.cards = [];
        tgt.cards.splice(index, 0, moved);
      }
    });
    act(() => api.updateCard(d.id, { listId: to.list, index }));
  };
  const startList = (e: React.DragEvent<HTMLElement>, listId: string) => {
    const col = e.currentTarget.closest<HTMLElement>('[data-list]')!;
    drag.current = { kind: 'list', id: listId, w: col.offsetWidth };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', listId);
    e.dataTransfer.setDragImage(col, 20, 20);
    setTimeout(() => setDragging(listId), 0);
  };
  const overCanvas = (e: React.DragEvent<HTMLElement>) => {
    const d = drag.current;
    if (d?.kind !== 'list') return;
    e.preventDefault();
    const els = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-list]')].filter((el) => el.dataset.list !== d.id);
    let i = els.findIndex((el) => { const r = el.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
    if (i < 0) i = els.length;
    if (lphRef.current !== i) setLph(i);
  };
  const dropList = (e: React.DragEvent) => {
    const d = drag.current, to = lphRef.current;
    if (d?.kind !== 'list') return;
    e.preventDefault();
    endDrag();
    if (to === null) return;
    mut((x) => { const k = x.lists.findIndex((l) => l.id === d.id); const [l] = x.lists.splice(k, 1); x.lists.splice(to, 0, l); });
    act(() => api.updateList(d.id, { index: to }));
  };

  const cols: ReactNode[] = b.lists.map((l) => l.folded
    ? <button key={l.id} data-list={l.id} className={'bd-list-folded' + (l.id === dragging ? ' dragging' : '')} onClick={() => fold(l.id)} disabled={!canShape} title={canShape ? `Mở rộng ${l.name}` : `${l.name} · admin board đã thu gọn danh sách này`}><Icon name="collapse" size={14} /><span>{l.name}</span><em>{l.cards.length}</em></button>
    : <ListColumn key={l.id} board={b} list={l} canEdit={canEdit} canShape={canShape} hidden={l.id === dragging} dragging={dragging} ph={ph?.list === l.id ? ph.index : null} phH={drag.current?.kind === 'card' ? drag.current.h : dragged.inbox?.h || 40}
        filter={on ? (c) => matches(c, filter, me.id) : null} cardLevel={cardLevel} labelText={labelText} onLabels={toggleLabels} onOpen={(cid) => onCard(cid)} onQuick={(cid, el) => setQuick({ id: cid, rect: el.getBoundingClientRect() })} onFold={() => fold(l.id)}
        onDragStart={startList} onCardDragStart={startCard} onDragEnd={endDrag} onOver={overList} onDrop={dropCard} mut={mut} act={act} />);
  if (lph !== null) {
    let seen = 0, at = cols.length;
    for (let i = 0; i < b.lists.length; i++) { if (b.lists[i].id === dragging) continue; if (seen === lph) { at = i; break; } seen++; }
    cols.splice(at, 0, <div key="lph" className="bd-list-ph" style={{ width: drag.current?.kind === 'list' ? drag.current.w : 272 }} />);
  }

  return (
    <main className="bd-board" style={{ background: bg(b.bg) }}>
      <header className="bd-bar">
        <button className="bd-bar-btn bd-back" onClick={onGone} aria-label="Về danh sách board"><Icon name="left" size={16} /></button>
        {naming !== null
          ? <input className="bd-title-in" autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setNaming(null); }}
              onBlur={() => { const n = (naming || '').trim(); setNaming(null); if (n && n !== b.name) { mut((x) => { x.name = n; }); act(async () => { await api.updateBoard(b.id, { name: n }); onChanged(); }); } }} />
          : canShape ? <button className="bd-title" onClick={() => setNaming(b.name)} title="Đổi tên board">{b.name}</button> : <h1 className="bd-title">{b.name}</h1>}
        <button className="bd-bar-btn bd-view-button" onClick={(e) => setViewEl(viewEl ? null : e.currentTarget)} aria-expanded={!!viewEl} aria-label="Chọn chế độ xem"><Icon name="boards" size={16} />{VIEW_NAMES[view]}<Icon name="chevron" size={12} /></button>
        <div className="bd-level-tabs" role="tablist" aria-label="Cấp độ hiển thị">
          <button type="button" role="tab" aria-selected={cardLevel==='all'} className={'bd-level-btn'+(cardLevel==='all'?' on':'')} onClick={()=>setCardLevel('all')}>Tất cả</button>
          <button type="button" role="tab" aria-selected={cardLevel==='customer'} className={'bd-level-btn'+(cardLevel==='customer'?' on':'')} onClick={()=>setCardLevel('customer')}>Khách hàng</button>
          <button type="button" role="tab" aria-selected={cardLevel==='project'} className={'bd-level-btn'+(cardLevel==='project'?' on':'')} onClick={()=>setCardLevel('project')}>Dự án</button>
          <button type="button" role="tab" aria-selected={cardLevel==='task'} className={'bd-level-btn'+(cardLevel==='task'?' on':'')} onClick={()=>setCardLevel('task')}>Task</button>
        </div>
        <button className={'bd-bar-btn bd-star' + (b.starred ? ' on' : '')} onClick={() => { mut((x) => { x.starred = !x.starred; }); onStar(b); }} aria-label={b.starred ? 'Bỏ sao' : 'Gắn sao'}><Icon name="star" size={16} /></button>
        {isAdmin
          ? <button className={'bd-bar-btn bd-vis' + (visEl ? ' on' : '')} onClick={(e) => setVisEl(visEl ? null : e.currentTarget)} title={visTip}><Icon name={role || priv ? 'lock' : 'users'} size={15} />{visText}</button>
          : <span className="bd-bar-btn bd-vis" title={visTip}><Icon name={role || priv ? 'lock' : 'users'} size={15} />{visText}</span>}
        {!canEdit && <span className="bd-ro" title="Bạn chỉ xem và bình luận được trên board này">Chỉ xem</span>}
        <span className="bd-gap" />
        <button className={'bd-bar-btn bd-filter-b' + (on ? ' bd-filter-on' : '')} onClick={(e) => setFilterEl(filterEl ? null : e.currentTarget)} aria-label="Bộ lọc"><Icon name="filter" size={15} />Bộ lọc{on && <em className="bd-filter-n">{shown}</em>}</button>
        {on && <button className="bd-bar-btn" onClick={() => setFilter(NO_FILTER)}>Xoá bộ lọc</button>}
        <button className="bd-avs" onClick={() => setSharing(true)} title="Ai xem được board này"><AvatarStack people={b.members} max={5} align="right" focusable={false} render={(m) => <Avatar key={m.id} m={m} size={28} />} /></button>
        <button className="bd-bar-btn bd-share-b" onClick={() => setSharing(true)} aria-label="Chia sẻ"><Icon name="users" size={15} />Chia sẻ</button>
        <button className="bd-bar-btn" onClick={() => setDrawer(!drawer)} aria-label="Menu board" aria-expanded={drawer}><Icon name="more" size={16} /></button>
      </header>
      <div className="bd-body">
        {view !== 'board' ? <BoardAlternative board={b} view={view} filter={(c) => !on || matches(c, filter, me.id)} onOpen={onCard} /> : <div className="bd-canvas" onDragOver={overCanvas} onDrop={dropList}>
          {cols}
          {!canShape ? null : adding
            ? <Composer className="bd-list bd-add-list" placeholder="Nhập tên danh sách…" button="Thêm danh sách" onDone={() => setAdding(false)}
                onSubmit={(name) => act(async () => { const l = await api.createList(b.id, name); mut((x) => { x.lists.push(l); }); })} />
            : <button className="bd-add-list-b" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Thêm danh sách khác</button>}
        </div>
        }
        {drawer && <BoardMenu board={b} me={me} onShare={() => setSharing(true)} onClose={() => setDrawer(false)} onGone={onGone} onOpen={(cid) => onCard(cid)} act={async (fn) => { await act(fn); onChanged(); }} mut={mut} />}
      </div>
      {viewEl && <Pop anchor={viewEl} title="Chế độ xem" onClose={() => setViewEl(null)}><div className="bk-menu">{(Object.keys(VIEW_NAMES) as BoardViewKind[]).map((v) => <button key={v} onClick={() => { setView(v); setViewEl(null); }}><Icon name={v === 'board' ? 'boards' : v === 'calendar' ? 'calendar' : 'lines'} size={16} />{VIEW_NAMES[v]}{view === v && <Icon name="check" size={15} />}</button>)}<button disabled title="Thẻ chưa có dữ liệu vị trí"><Icon name="folder" size={16} />Bản đồ · Chưa có vị trí</button></div></Pop>}
      {quick && <QuickCard key={quick.id} id={quick.id} rect={quick.rect} board={b} me={me} onClose={() => setQuick(null)} onOpen={() => { onCard(quick.id); setQuick(null); }} onChanged={() => { load(); changed('planner'); }} />}
      {filterEl && <FilterPop anchor={filterEl} board={b} filter={filter} setFilter={setFilter} onClose={() => setFilterEl(null)} />}
      {visEl&&<Pop anchor={visEl} title="Board cá nhân" onClose={()=>setVisEl(null)}><p className="note">Chỉ chủ board và thành viên được thêm trực tiếp mới xem được board này.</p>{isAdmin&&<button className="btn btn-primary btn-sm" onClick={()=>{setVisEl(null);setSharing(true);}}>Quản lý thành viên</button>}</Pop>}
      {sharing && <ShareBoard board={b} ws={ws} role={role} me={me} onClose={() => setSharing(false)} onChanged={() => { load(); onChanged(); }} />}
      {card && <CardModal key={card} id={card} board={b} me={me} onClose={() => onCard(null)} onChanged={() => { load(); changed('planner'); }} />}
    </main>
  );
}

function FilterPop({ anchor, board, filter, setFilter, onClose }: { anchor: HTMLElement; board: Board; filter: Filter; setFilter: (f: Filter) => void; onClose: () => void }) {
  const flip = (k: 'members' | 'labels' | 'due', v: string) => setFilter({ ...filter, [k]: filter[k].includes(v) ? filter[k].filter((x) => x !== v) : [...filter[k], v] });
  const row = (k: 'members' | 'labels' | 'due', v: string, label: ReactNode) => (
    <label key={v} className="bk-check"><input type="checkbox" checked={filter[k].includes(v)} onChange={() => flip(k, v)} />{label}</label>
  );
  return (
    <Pop anchor={anchor} title="Bộ lọc" onClose={onClose} width={340}>
      <h5>Từ khoá</h5>
      <input className="bk-in" autoFocus value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Nhập từ khoá…" />
      <h5>Thành viên</h5>
      {row('members', 'none', <><span className="bk-av bd-av-none"><Icon name="user" size={13} /></span>Không có thành viên</>)}
      {row('members', 'me', <>Thẻ giao cho tôi</>)}
      {board.members.map((m) => row('members', m.id, <><Avatar m={m} size={22} />{m.name}</>))}
      <h5>Trạng thái thẻ</h5>
      <label className="bk-check"><input type="checkbox" checked={filter.done === 'done'} onChange={() => setFilter({ ...filter, done: filter.done === 'done' ? '' : 'done' })} />Đã đánh dấu hoàn thành</label>
      <label className="bk-check"><input type="checkbox" checked={filter.done === 'open'} onChange={() => setFilter({ ...filter, done: filter.done === 'open' ? '' : 'open' })} />Chưa hoàn thành</label>
      <h5>Ngày hết hạn</h5>
      {row('due', 'none', <>Không có ngày hết hạn</>)}
      {row('due', 'over', <><Icon name="clock" size={14} />Quá hạn</>)}
      {row('due', 'day', <>Hết hạn trong ngày tới</>)}
      {row('due', 'week', <>Hết hạn trong tuần tới</>)}
      {row('due', 'month', <>Hết hạn trong tháng tới</>)}
      <h5>Nhãn</h5>
      {row('labels', 'none', <>Không có nhãn</>)}
      {board.labels.map((l) => row('labels', l.id, <span className="bk-label" style={{ background: COLOR[l.color] }} title={l.name || `Nhãn ${COLOR_NAME[l.color]}`}>{l.name}</span>))}
    </Pop>
  );
}

// ---------------------------------------------------------------- lists and cards
type ListProps = {
  board: Board; list: Board['lists'][number]; canEdit: boolean; canShape: boolean; hidden: boolean; dragging: string | null; ph: number | null; phH: number;
  filter: ((c: BoardCard) => boolean) | null; cardLevel?: 'all' | 'customer' | 'project' | 'task'; labelText: boolean; onLabels: () => void; onOpen: (cardId: string) => void; onQuick: (cardId: string, el: HTMLElement) => void; onFold: () => void;
  onDragStart: (e: React.DragEvent<HTMLElement>, listId: string) => void; onCardDragStart: (e: React.DragEvent<HTMLElement>, cardId: string, listId: string) => void;
  onDragEnd: () => void; onOver: (e: React.DragEvent<HTMLElement>, listId: string) => void; onDrop: (e: React.DragEvent) => void;
  mut: (fn: (x: Board) => void) => void; act: (fn: () => Promise<unknown>) => Promise<void>;
};
function ListColumn(p: ListProps) {
  const { board, list, cardLevel = 'all' } = p;
  const [name, setName] = useState<string | null>(null);
  const [composing, setComposing] = useState<'top' | 'bottom' | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [cardKind, setCardKind] = useState<'customer' | 'project' | 'task'>('task');
  const [projectCardId, setProjectCardId] = useState('');
  const [customerCardId, setCustomerCardId] = useState('');

  const allCards = board.lists.flatMap(l => (l.cards || []).filter(Boolean));
  const customers = allCards.filter(c => c?.kind === 'customer');
  const projects = allCards.filter(c => c?.kind === 'project');

  const visible = (list.cards || []).filter(Boolean).filter((c) => {
    if (!c) return false;
    if (c.id === p.dragging) return true;
    if (cardLevel === 'customer' && c.kind !== 'customer') return false;
    if (cardLevel === 'project' && c.kind !== 'project') return false;
    if (cardLevel === 'task' && c.kind !== 'task' && c.kind !== undefined) return false;
    return !p.filter || p.filter(c) || (c.kind === 'project' && board.lists.some(l => (l.cards || []).some(t => t && t.projectCardId === c.id && p.filter!(t)))) || (c.kind === 'customer' && board.lists.some(l => (l.cards || []).some(item => item && item.customerId === c.customerId && p.filter!(item))));
  });

  const renderCard = (c: BoardCard) => {
    if (!c) return null;
    return (
      <CardFront key={c.id} card={c} board={board} canEdit={p.canEdit} hidden={c.id === p.dragging} labelText={p.labelText} onLabels={p.onLabels}
        onDragStart={(e) => p.onCardDragStart(e, c.id, c.listId || list.id)} onDragEnd={p.onDragEnd} onOpen={() => p.onOpen(c.id)} onQuick={(el) => p.onQuick(c.id, el)}
        onDone={() => {
          p.mut((x) => {
            for (const l of x.lists) {
              const k = (l.cards || []).find((y) => y?.id === c.id);
              if (k) { k.done = !k.done; break; }
            }
          });
          p.act(() => api.updateCard(c.id, { done: !c.done }));
        }} />
    );
  };

  const renderProjectBlock = (c: BoardCard) => {
    if (!c) return null;
    const tasks = allCards.filter(t => t && t.projectCardId === c.id);
    const done = tasks.filter(t => t.done).length;
    const shown = tasks.filter(t => !p.filter || p.filter(t));
    return (
      <section className="bd-project-card" key={c.id}>
        <div className="bd-project-caption"><Icon name="folder" size={14}/> PROJECT <span>{done}/{tasks.length} task</span></div>
        {renderCard(c)}
        <progress className="bd-project-progress" value={done} max={tasks.length || 1} aria-label="Tiến độ Project"/>
        <div className="bd-project-tasks">
          {shown.map(t => <div key={t.id}>{renderCard(t)}</div>)}
          {!tasks.length && <p className="empty-note">Chưa có Task trong Project này.</p>}
        </div>
        {p.canEdit && <button className="bd-add-card" onClick={() => { setCardKind('task'); setProjectCardId(c.id); setCustomerCardId(''); setComposing('bottom'); }}><Icon name="plus" size={14}/>Thêm Task vào Project</button>}
      </section>
    );
  };

  const renderCustomerBlock = (c: BoardCard) => {
    if (!c) return null;
    const custProjects = projects.filter(pr => pr && pr.customerId === c.customerId);
    const custTasks = allCards.filter(t => t && t.customerId === c.customerId && t.kind !== 'customer' && t.kind !== 'project');
    const directCustTasks = custTasks.filter(t => !t.projectCardId || !projects.some(pr => pr && pr.id === t.projectCardId));
    const doneTasks = custTasks.filter(t => t.done).length;
    return (
      <section className="bd-customer-card" key={c.id}>
        <div className="bd-customer-caption">
          <Icon name="users" size={14}/> KHÁCH HÀNG: {c.title}
          <span>{custProjects.length} dự án · {doneTasks}/{custTasks.length} task</span>
        </div>
        {renderCard(c)}
        <div className="bd-customer-body">
          {custProjects.map(pr => renderProjectBlock(pr))}
          {directCustTasks.map(t => <div key={t.id}>{renderCard(t)}</div>)}
          {!custProjects.length && !directCustTasks.length && <p className="empty-note">Chưa có Dự án hoặc Task trong Khách hàng này.</p>}
        </div>
        {p.canEdit && (
          <div className="bd-customer-actions">
            <button className="bd-add-card" onClick={() => { setCardKind('project'); setCustomerCardId(c.id); setProjectCardId(''); setComposing('bottom'); }}><Icon name="plus" size={13}/>Thêm Dự án</button>
            <button className="bd-add-card" onClick={() => { setCardKind('task'); setCustomerCardId(c.id); setProjectCardId(''); setComposing('bottom'); }}><Icon name="plus" size={13}/>Thêm Task</button>
          </div>
        )}
      </section>
    );
  };

  const cards: ReactNode[] = visible.map(c => {
    if (!c) return null;
    if (cardLevel === 'task') return <div key={c.id}>{renderCard(c)}</div>;
    if (cardLevel === 'project') return renderProjectBlock(c);
    if (cardLevel === 'customer') return renderCustomerBlock(c);

    // cardLevel === 'all'
    if (c.kind === 'customer') return renderCustomerBlock(c);
    if (c.kind === 'project') {
      const parentCustomer = c.customerId && customers.some(cu => cu && cu.customerId === c.customerId);
      if (parentCustomer) return null;
      return renderProjectBlock(c);
    }
    if (c.projectCardId && projects.some(pr => pr && pr.id === c.projectCardId)) return null;
    if (c.customerId && customers.some(cu => cu && cu.customerId === c.customerId)) return null;
    return <div key={c.id}>{renderCard(c)}</div>;
  });

  if (p.ph !== null) {
    // The gap goes before the ph-th card shown (the dragged one, hidden, does not count).
    let seen = 0, at = cards.length;
    for (let i = 0; i < visible.length; i++) { if (visible[i].id === p.dragging) continue; if (seen === p.ph) { at = i; break; } seen++; }
    cards.splice(at, 0, <div key="ph" className="bd-card-ph" style={{ height: p.phH }} />);
  }
  const add = async (title: string, top: boolean) => {
    const parentCust = customerCardId ? customers.find(cu => cu.id === customerCardId) : null;
    const custId = parentCust?.customerId || null;
    const c = await api.createCard(list.id, title, top, true, cardKind, cardKind === 'task' ? projectCardId || null : null, customerCardId || null, custId);
    p.mut((x) => { const l = x.lists.find((y) => y.id === list.id)!; if (top) l.cards.unshift(c); else l.cards.push(c); });
    setComposing(null);
  };

  const composerPicker = (
    <div className="bd-card-type-picker">
      <label>Loại thẻ
        <select aria-label="Loại thẻ" value={cardKind} onChange={e => { setCardKind(e.target.value as 'customer' | 'project' | 'task'); setProjectCardId(''); setCustomerCardId(''); }}>
          <option value="task">Task · Công việc</option>
          <option value="project">Project · Dự án</option>
          <option value="customer">Khách hàng · Customer</option>
        </select>
      </label>
      {cardKind === 'project' && customers.length > 0 && (
        <label>Thuộc Khách hàng
          <select aria-label="Thuộc Khách hàng" value={customerCardId} onChange={e => setCustomerCardId(e.target.value)}>
            <option value="">Chưa phân loại / Nội bộ</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
      )}
      {cardKind === 'task' && (
        <>
          <label>Thuộc Project
            <select aria-label="Thuộc Project" value={projectCardId} onChange={e => setProjectCardId(e.target.value)}>
              <option value="">Task độc lập</option>
              {projects.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          {customers.length > 0 && !projectCardId && (
            <label>Thuộc Khách hàng
              <select aria-label="Thuộc Khách hàng" value={customerCardId} onChange={e => setCustomerCardId(e.target.value)}>
                <option value="">Chưa phân loại / Nội bộ</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
          )}
        </>
      )}
    </div>
  );

  return (
    <section className={'bd-list' + (p.hidden ? ' dragging' : '')} data-list={list.id} onDragOver={(e) => p.onOver(e, list.id)} onDrop={p.onDrop}>
      <header className="bd-list-h" draggable={p.canShape && name === null} onDragStart={(e) => p.onDragStart(e, list.id)} onDragEnd={p.onDragEnd}>
        {name !== null
          ? <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setName(null); }}
              onBlur={() => { const n = (name || '').trim(); setName(null); if (n && n !== list.name) { p.mut((x) => { x.lists.find((y) => y.id === list.id)!.name = n; }); p.act(() => api.updateList(list.id, { name: n })); } }} />
          : <h3 onClick={() => p.canShape && setName(list.name)} title={p.canShape ? 'Đổi tên' : undefined}>{list.name}</h3>}
        <span className="bd-count" title={p.filter ? 'Thẻ khớp bộ lọc / tất cả' : 'Số thẻ'}>{p.filter ? `${visible.length}/${list.cards.length}` : list.cards.length}</span>
        {p.canShape && <button className="bd-icon" onClick={p.onFold} aria-label={`Thu gọn ${list.name}`} title="Thu gọn danh sách (mọi người đều thấy)"><Icon name="collapse" size={14} /></button>}
        {p.canEdit && <button className="bd-icon" onClick={(e) => setMenu(menu ? null : e.currentTarget)} aria-label={`Thao tác với danh sách ${list.name}`}><Icon name="more" size={15} /></button>}
      </header>
      {composing === 'top' && <Composer className="bd-composer" placeholder="Nhập tiêu đề thẻ…" button="Thêm thẻ" multiline keepOpen onDone={() => setComposing(null)} onSubmit={(t) => add(t, true)} children={composerPicker} />}
      <div className="bd-cards">{cards}</div>
      {composing === 'bottom'
        ? <Composer className="bd-composer" placeholder="Nhập tiêu đề thẻ…" button="Thêm thẻ" multiline keepOpen onDone={() => setComposing(null)} onSubmit={(t) => add(t, false)} children={composerPicker} />
        : composing === null && p.canEdit && <button className="bd-add-card" onClick={() => setComposing('bottom')}><Icon name="plus" size={15} />Thêm thẻ</button>}
      {menu && <ListMenu anchor={menu} board={board} list={list} canShape={p.canShape} onClose={() => setMenu(null)} onAdd={() => { setMenu(null); setComposing('top'); }} onFold={() => { setMenu(null); p.onFold(); }} mut={p.mut} act={p.act} />}
    </section>
  );
}

/** Trello's list actions: add, copy, move, sort, move or archive every card, archive the list, fold it. */
function ListMenu({ anchor, board, list, canShape, onClose, onAdd, onFold, mut, act }: { anchor: HTMLElement; board: Board; list: Board['lists'][number]; canShape: boolean; onClose: () => void; onAdd: () => void; onFold: () => void; mut: (fn: (x: Board) => void) => void; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const me = useStore((s) => s.user)!;
  // Each card stays with whoever made it (cards from before makers were kept: the board's admins).
  const mine = list.cards.filter((c) => me.role === 'admin' || (c.createdBy ? c.createdBy === me.id : board.level === 'admin'));
  const [view, setView] = useState<'main' | 'copy' | 'move' | 'sort' | 'cards'>('main');
  const [copyName, setCopyName] = useState(list.name);
  const [pos, setPos] = useState(board.lists.findIndex((l) => l.id === list.id));
  const done = (fn: () => Promise<unknown>) => { onClose(); act(fn); };
  const titles = { main: 'Thao tác với danh sách', copy: 'Sao chép danh sách', move: 'Di chuyển danh sách', sort: 'Sắp xếp danh sách', cards: 'Di chuyển tất cả thẻ' };
  return (
    <Pop anchor={anchor} title={titles[view]} onClose={onClose} onBack={view === 'main' ? undefined : () => setView('main')}>
      {view === 'main' && <div className="bk-menu">
        <button onClick={onAdd}>Thêm thẻ</button>
        {canShape && <>
          <button onClick={() => setView('copy')}>Sao chép danh sách</button>
          <button onClick={() => setView('move')}>Di chuyển danh sách</button>
          <button onClick={() => setView('sort')}>Sắp xếp theo…</button>
          <hr />
          <button onClick={() => setView('cards')} disabled={!list.cards.length}>Di chuyển tất cả thẻ trong danh sách này</button>
        </>}
        <button disabled={!mine.length} title={!mine.length ? 'Danh sách này không có thẻ nào do bạn tạo' : undefined}
          onClick={() => { if (confirm(`Lưu trữ ${mine.length} thẻ do bạn tạo trong “${list.name}”?${mine.length < list.cards.length ? ' Thẻ của người khác giữ nguyên.' : ''}`)) done(async () => { mut((x) => { const l = x.lists.find((y) => y.id === list.id)!; l.cards = l.cards.filter((c) => !mine.includes(c)); }); await api.archiveListCards(list.id); }); }}>Lưu trữ mọi thẻ của bạn trong danh sách này</button>
        {canShape && <>
          <hr />
          <button onClick={() => done(async () => { mut((x) => { x.lists = x.lists.filter((y) => y.id !== list.id); }); await api.updateList(list.id, { archived: true }); })}>Lưu trữ danh sách này</button>
          <button onClick={onFold}>Thu gọn danh sách</button>
        </>}
        {!canShape && <p className="note bk-menu-note">Đổi tên, di chuyển, sắp xếp hay lưu trữ danh sách: chỉ admin board (hoặc khi admin cho phép thành viên).</p>}
      </div>}
      {view === 'copy' && <>
        <h5>Tên</h5>
        <textarea className="bk-in" rows={2} autoFocus value={copyName} onChange={(e) => setCopyName(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!copyName.trim()} onClick={() => done(() => api.copyList(list.id, copyName.trim()))}>Tạo danh sách</button>
      </>}
      {view === 'move' && <>
        <label className="bk-field"><span>Vị trí</span><select value={pos} onChange={(e) => setPos(Number(e.target.value))}>{board.lists.map((l, i) => <option key={l.id} value={i}>{i + 1}{l.id === list.id ? ' (hiện tại)' : ''}</option>)}</select></label>
        <button className="btn btn-primary btn-sm" onClick={() => done(async () => { mut((x) => { const k = x.lists.findIndex((l) => l.id === list.id); const [l] = x.lists.splice(k, 1); x.lists.splice(pos, 0, l); }); await api.updateList(list.id, { index: pos }); })}>Di chuyển</button>
      </>}
      {view === 'sort' && <div className="bk-menu">
        {([['newest', 'Ngày tạo (mới nhất trước)'], ['oldest', 'Ngày tạo (cũ nhất trước)'], ['name', 'Tên thẻ (theo thứ tự chữ cái)'], ['due', 'Ngày hết hạn']] as const).map(([k, l]) => <button key={k} onClick={() => done(() => api.sortList(list.id, k))}>{l}</button>)}
      </div>}
      {view === 'cards' && <div className="bk-menu">
        {board.lists.map((l) => <button key={l.id} disabled={l.id === list.id} onClick={() => done(() => api.moveListCards(list.id, l.id))}>{l.name}{l.id === list.id ? ' (hiện tại)' : ''}</button>)}
      </div>}
    </Pop>
  );
}

/** The front of a card on the board: cover, labels, title with its "done" mark, badges and members. */
function CardFront({ card, board, canEdit, hidden, labelText, onLabels, onDragStart, onDragEnd, onOpen, onQuick, onDone }: {
  card: BoardCard; board: Board; canEdit: boolean; hidden: boolean; labelText: boolean; onLabels: () => void;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void; onDragEnd: () => void; onOpen: () => void; onQuick: (el: HTMLElement) => void; onDone: () => void;
}) {
  if (!card) return null;
  const labels = board.labels.filter((l) => (card.labels || []).includes(l.id));
  const members = board.members.filter((m) => (card.members || []).includes(m.id));
  const due = dueState(card.dueAt, card.done);
  const badges = card.dueAt || card.startAt || card.desc || card.comments || card.attachments || card.checks || members.length || card.customerName;
  return (
    <article className={'bd-card' + (hidden ? ' dragging' : '') + (card.done ? ' is-done' : '')} data-card={card.id} draggable={canEdit} onDragStart={onDragStart} onDragEnd={onDragEnd}
      onContextMenu={(e) => { e.preventDefault(); onQuick(e.currentTarget); }} onClick={onOpen} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }} aria-label={card.title}>
      {card.cover && <div className="bd-card-cover" style={{ background: COLOR[card.cover] }} />}
      <div className="bd-card-in">
        {labels.length > 0 && (
          <div className="bd-card-labels">
            {labels.map((l) => <button key={l.id} className={'bd-lbl' + (labelText ? ' text' : '')} style={{ background: COLOR[l.color] }} title={l.name || COLOR_NAME[l.color]}
              onClick={(e) => { e.stopPropagation(); onLabels(); }}>{labelText ? l.name : ''}</button>)}
          </div>
        )}
        <div className="bd-card-title">
          <button className={'bd-done' + (card.done ? ' on' : '')} disabled={!canEdit} onClick={(e) => { e.stopPropagation(); onDone(); }} aria-label={card.done ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'}>{card.done && <Icon name="check" size={11} />}</button>
          <span>{card.title}</span>
        </div>
        {badges || card.kind ? (
          <div className="bd-badges">
            {card.kind === 'customer' && <span className="bd-badge-kind bd-badge-kind-cust"><Icon name="users" size={12} />Khách hàng</span>}
            {card.kind === 'project' && <span className="bd-badge-kind bd-badge-kind-prj"><Icon name="folder" size={12} />Dự án</span>}
            {card.customerName && card.kind !== 'customer' && <span className="bd-badge-cust" title="Khách hàng"><Icon name="folder" size={13} />{card.customerName}</span>}
            {(card.dueAt || card.startAt) && <span className={'bd-badge-due ' + due} title={due === 'over' ? 'Quá hạn' : due === 'soon' ? 'Sắp hết hạn' : due === 'done' ? 'Đã hoàn thành' : 'Ngày'}><Icon name="clock" size={13} />{card.startAt && card.dueAt ? `${shortDate(card.startAt)} – ${shortDate(card.dueAt)}` : shortDate((card.dueAt || card.startAt)!)}</span>}
            {card.desc && <span title="Thẻ có mô tả"><Icon name="lines" size={13} /></span>}
            {card.comments > 0 && <span title="Bình luận"><Icon name="comment" size={13} />{card.comments}</span>}
            {card.attachments > 0 && <span title="Đính kèm"><Icon name="clip" size={13} />{card.attachments}</span>}
            {card.checks && <span className={card.checks[0] === card.checks[1] ? 'bd-badge-ok' : ''} title="Việc cần làm"><Icon name="checklist" size={13} />{card.checks[0]}/{card.checks[1]}</span>}
            {members.length > 0 && <AvatarStack className="bd-card-avs" people={members} max={3} align="right" render={(m) => <Avatar key={m.id} m={m} size={24} />} />}
          </div>
        ) : null}
      </div>
      <button className="bd-card-pen" aria-label="Thao tác nhanh với thẻ" onClick={(e) => { e.stopPropagation(); onQuick(e.currentTarget.closest<HTMLElement>('.bd-card')!); }}><Icon name="text" size={13} /></button>
    </article>
  );
}

/** The board's menu on the right: about, activity, archived items, background, labels, who sees it, delete. */
function BoardMenu({ board, me, onShare, onClose, onGone, onOpen, act, mut }: { board: Board; me: User; onShare: () => void; onClose: () => void; onGone: () => void; onOpen: (cardId: string) => void; act: (fn: () => Promise<unknown>) => Promise<void>; mut: (fn: (x: Board) => void) => void }) {
  const [view, setView] = useState<'main' | 'about' | 'activity' | 'archived' | 'bg' | 'labels' | 'rights'>('main');
  const [feed, setFeed] = useState<BoardActivity[] | null>(null);
  const [arch, setArch] = useState<Awaited<ReturnType<typeof api.boardArchived>> | null>(null);
  const [archTab, setArchTab] = useState<'cards' | 'lists'>('cards');
  const [about, setAbout] = useState(board.about);
  const [label, setLabel] = useState<BoardLabel | 'new' | null>(null);
  useEffect(() => {
    if (view === 'activity') api.boardActivity(board.id).then(setFeed).catch((e) => toast(e.message, true));
    if (view === 'archived') api.boardArchived(board.id).then(setArch).catch((e) => toast(e.message, true));
  }, [view, board.id]);
  const reloadArch = () => api.boardArchived(board.id).then(setArch).catch(() => {});
  const canEdit = board.level !== 'observer', canDelete = board.level === 'admin', canShape = board.canShape;
  const titles = { main: 'Menu', about: 'Về board này', activity: 'Hoạt động', archived: 'Mục đã lưu trữ', bg: 'Đổi hình nền', labels: 'Nhãn', rights: 'Quyền sửa board' };
  return (
    <aside className="bd-drawer" aria-label="Menu board">
      <header>
        {view !== 'main' ? <button className="bk-x" onClick={() => setView('main')} aria-label="Quay lại"><Icon name="left" size={15} /></button> : <span className="bk-x-gap" />}
        <b>{titles[view]}</b>
        <button className="bk-x" onClick={onClose} aria-label="Đóng menu"><Icon name="x" size={15} /></button>
      </header>
      <div className="bd-drawer-b">
        {view === 'main' && <div className="bk-menu bd-drawer-menu">
          <button onClick={() => setView('about')}><Icon name="info" size={16} />Về board này</button>
          <button onClick={() => setView('activity')}><Icon name="activity" size={16} />Hoạt động</button>
          <button onClick={() => setView('archived')}><Icon name="archive" size={16} />Mục đã lưu trữ</button>
          <button onClick={() => { onClose(); onShare(); }}><Icon name="users" size={16} />Chia sẻ và quyền</button>
          <hr />
          {canShape && <button onClick={() => setView('bg')}><span className="bd-bg-dot" style={{ background: bg(board.bg) }} />Đổi hình nền</button>}
          {canShape && <button onClick={() => setView('labels')}><Icon name="tag" size={16} />Nhãn</button>}
          {canShape && <button onClick={() => act(async () => { mut((x) => { x.labelText = !x.labelText; }); await api.updateBoard(board.id, { labelText: !board.labelText }); })}><Icon name="tag" size={16} />{board.labelText ? 'Ẩn tên nhãn trên thẻ' : 'Hiện tên nhãn trên thẻ'}</button>}
          {canDelete && <button onClick={() => setView('rights')}><Icon name="lock" size={16} />Quyền sửa board</button>}
          {board.members.some((m) => m.id === me.id && m.added) && board.level !== 'admin' && <><hr /><button onClick={async () => { if (!confirm(`Rời board “${board.name}”?`)) return; try { await api.removeBoardMember(board.id, me.id); onGone(); } catch (e: any) { toast(e.message, true); } }}><Icon name="user" size={16} />Rời board</button></>}
          {canDelete && <><hr /><button className="bk-danger" onClick={async () => { if (!confirm(`Xoá vĩnh viễn board “${board.name}” cùng mọi danh sách và thẻ?`)) return; try { await api.deleteBoard(board.id); onGone(); } catch (e: any) { toast(e.message, true); } }}><Icon name="trash" size={16} />Xoá board</button></>}
        </div>}
        {view === 'about' && <>
          <h5>Mô tả</h5>
          {canShape ? <>
            <textarea className="bk-in" rows={6} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Board này dùng để làm gì, quy ước các cột, ai phụ trách…"
              onBlur={() => about !== board.about && act(() => api.updateBoard(board.id, { about }))} />
            <p className="note">Lưu tự động khi bạn bấm ra ngoài ô.</p>
          </> : <p className="bd-about">{board.about || 'Chưa có mô tả.'}</p>}
        </>}
        {view === 'activity' && (feed === null ? <BrandLoading label="Đang tải…"/> : !feed.length ? <p className="note">Chưa có hoạt động nào.</p> : (
          <ul className="cm-feed">{feed.map((a) => <li key={a.id} className="cm-act"><Avatar m={board.members.find((m) => m.id === a.userId) || { id: a.userId, name: a.userName }} size={28} /><div><p><b>{a.userName}</b> {activityText(a, false, onOpen)}</p><span>{ago(a.createdAt)}</span></div></li>)}</ul>
        ))}
        {view === 'archived' && <>
          <div className="bd-tabs2"><button className={archTab === 'cards' ? 'on' : ''} onClick={() => setArchTab('cards')}>Thẻ</button><button className={archTab === 'lists' ? 'on' : ''} onClick={() => setArchTab('lists')}>Danh sách</button></div>
          {arch === null ? <BrandLoading label="Đang tải…"/> : archTab === 'cards' ? (arch.cards.length ? arch.cards.map((c) => (
            <div key={c.id} className="bd-arch">
              <button className="bd-arch-card" onClick={() => onOpen(c.id)}><b>{c.title}</b><small>trong {c.listName}</small></button>
              {canEdit && <div className="cm-row"><button className="bk-link" onClick={async () => { await act(() => api.updateCard(c.id, { archived: false })); reloadArch(); }}>Khôi phục</button>
                {(me.role === 'admin' || (c.createdBy ? c.createdBy === me.id : canDelete)) && <>·<button className="bk-link bk-danger" onClick={async () => { if (!confirm('Xoá hẳn thẻ này?')) return; await act(() => api.deleteCard(c.id)); reloadArch(); }}>Xoá</button></>}</div>}
            </div>
          )) : <p className="note">Không có thẻ nào được lưu trữ.</p>) : (arch.lists.length ? arch.lists.map((l) => (
            <div key={l.id} className="bd-arch"><b>{l.name}</b>{canShape && <div className="cm-row"><button className="bk-link" onClick={async () => { await act(() => api.updateList(l.id, { archived: false })); reloadArch(); }}>Khôi phục</button>
              {canDelete && <>·<button className="bk-link bk-danger" onClick={async () => { if (!confirm('Xoá hẳn danh sách và các thẻ trong đó?')) return; await act(() => api.deleteList(l.id)); reloadArch(); }}>Xoá</button></>}</div>}</div>
          )) : <p className="note">Không có danh sách nào được lưu trữ.</p>)}
        </>}
        {view === 'bg' && <>
          <p className="note">Mọi người trên board đều thấy hình nền này.</p>
          <div className="bd-bgs">{Object.keys(BG).map((k) => <button key={k} className={k === board.bg ? 'on' : ''} style={{ background: BG[k] }} aria-label={`Nền ${k}`} onClick={() => { mut((x) => { x.bg = k; }); act(() => api.boardBackground(board.id, k)); }} />)}</div>
        </>}
        {view === 'rights' && <>
          <p className="note">Thành viên luôn làm việc được trên thẻ (thêm, sửa, kéo thẻ, bình luận). Ai được sửa chính board: tên, hình nền, mô tả, cách hiển thị, danh sách và nhãn?</p>
          <label className="bk-check"><input type="radio" name="bd-rights" checked={!board.memberEdit} onChange={() => act(async () => { mut((x) => { x.memberEdit = false; x.canShape = x.level === 'admin'; }); await api.updateBoard(board.id, { memberEdit: false }); })} />Chỉ admin board</label>
          <label className="bk-check"><input type="radio" name="bd-rights" checked={board.memberEdit} onChange={() => act(async () => { mut((x) => { x.memberEdit = true; x.canShape = x.level !== 'observer'; }); await api.updateBoard(board.id, { memberEdit: true }); })} />Admin và thành viên</label>
          <p className="note">Muốn cho riêng một người quyền này: đặt họ làm Admin trong Chia sẻ.</p>
        </>}
        {view === 'labels' && <>
          {board.labels.map((l) => (
            <div key={l.id} className="bk-label-row">
              <span className="bk-label" style={{ background: COLOR[l.color] }}>{l.name}</span>
              <button className="bk-x" onClick={() => setLabel(l)} aria-label="Sửa nhãn"><Icon name="text" size={13} /></button>
            </div>
          ))}
          <button className="btn btn-gray bk-wide" onClick={() => setLabel('new')}>Tạo nhãn mới</button>
          {label && <LabelForm board={board} label={label === 'new' ? null : label} onClose={() => setLabel(null)} act={act} />}
        </>}
      </div>
    </aside>
  );
}

function LabelForm({ board, label, onClose, act }: { board: Board; label: BoardLabel | null; onClose: () => void; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [name, setName] = useState(label?.name || '');
  const [color, setColor] = useState(label?.color || 'green');
  return (
    <div className="bd-label-form">
      <div className="bk-label-prev"><span style={{ background: COLOR[color] }}>{name}</span></div>
      <input className="bk-in" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên nhãn (có thể để trống)" />
      <div className="bk-colors">{Object.keys(COLOR).map((k) => <button key={k} className={k === color ? 'on' : ''} style={{ background: COLOR[k] }} aria-label={`Màu ${COLOR_NAME[k]}`} onClick={() => setColor(k)} />)}</div>
      <div className="cm-row bk-split">
        <button className="btn btn-primary btn-sm" onClick={async () => { await act(() => (label ? api.updateLabel(label.id, { name, color }) : api.createLabel(board.id, { name, color }))); onClose(); }}>{label ? 'Lưu' : 'Tạo mới'}</button>
        <button className="btn btn-gray btn-sm" onClick={onClose}>Huỷ</button>
        {label && <button className="btn btn-sm cm-danger" onClick={async () => { if (!confirm('Xoá nhãn này khỏi board và mọi thẻ?')) return; await act(() => api.deleteLabel(label.id)); onClose(); }}>Xoá</button>}
      </div>
    </div>
  );
}

/** A small form that adds an item: Enter adds, Escape closes; `keepOpen` stays open for the next one. */
function Composer({ children, className, placeholder, button, multiline, keepOpen, onSubmit, onDone }: { children?: ReactNode; className: string; placeholder: string; button: string; multiline?: boolean; keepOpen?: boolean; onSubmit: (v: string) => void | Promise<void>; onDone: () => void }) {
  const [v, setV] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const submit = async () => { const t = v.trim(); if (!t || submitting) return; setSubmitting(true); try { await onSubmit(t); setV(''); if (!keepOpen) onDone(); } catch (e: any) { toast(e.message, true); } finally { setSubmitting(false); } };
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) done.current(); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);
  const keys = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') onDone(); };
  return (
    <form ref={box} className={className} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {children}
      {multiline ? <textarea autoFocus rows={2} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={keys} />
        : <input autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={keys} />}
      <div className="bd-row">
        <button className="btn btn-primary btn-sm" disabled={!v.trim() || submitting}>{submitting ? 'Đang thêm…' : button}</button>
        <button type="button" className="bd-icon" onClick={onDone} aria-label="Đóng"><Icon name="x" size={15} /></button>
      </div>
    </form>
  );
}
