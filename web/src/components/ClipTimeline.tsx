import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { player } from '../engine/player';
import { useStore, setState, select, trimShot, moveShot, deleteShot, splitAt, flatShots, fmt, undo } from '../store';
import { Icon, IconButton } from './ui';

// The assembly's timeline (bottom of the editor): a header column naming the tracks, a ruler, a lane with the sheet's
// rows and the video track with one filmstrip per clip. Drag a clip to reorder, drag its edges to trim the in/out
// points, ⌘B splits at the playhead, Delete removes, ⌘Z / ⇧⌘Z undo/redo, Space plays, ← → step a frame (⇧ = 1 s).
// Zoom like Premiere / CapCut: ⌘/Ctrl or Alt + wheel and trackpad pinch zoom around the pointer, the wheel alone scrolls
// sideways, = / − zoom around the playhead, \ fits the whole timeline.
const thumbOf = (url: string) => url.replace('?', '/thumb?');
const PAD = 12; // px before 0:00
const MIN_PPS = 0.5, MAX_PPS = 400; // pixels per second: a 30-minute assembly fits, single frames (≈13 px) can be trimmed
function usePlayer<T>(sel: () => T) { return useSyncExternalStore((cb) => player.subscribe(cb), sel); }

type Drag =
  | { kind: 'trim'; si: number; k: number; edge: 'start' | 'end'; x0: number; orig: { from: number; dur: number } }
  | { kind: 'move'; index: number; x0: number; dx: number }
  | { kind: 'seek' };

export function ClipTimeline() {
  const sb = useStore((s) => s.project?.storyboard)!;
  const sel = useStore((s) => s.clip);
  const time = usePlayer(() => player.time);
  const playing = usePlayer(() => player.playing);
  const total = player.total;
  const [pps, setPps] = useState(20); // pixels per second
  const ppsRef = useRef(pps); ppsRef.current = pps;
  // Zooming keeps one moment of the timeline under the same pixel: `t` (seconds) stays at `x` (px from the left edge).
  const anchor = useRef<{ t: number; x: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const flat = flatShots(sb);
  const setSel = (clip: number | null) => setState({ clip });

  const starts: number[] = [];
  let acc = 0;
  for (const x of flat) { starts.push(acc); acc += x.sh.dur; }
  const rows = sb.scenes.map((sc, si) => {
    const first = flat.findIndex((x) => x.si === si);
    return { si, label: sc.headline || `Hàng ${si + 1}`, start: first >= 0 ? starts[first] : 0, dur: sc.duration };
  });

  const zoom = (next: number, t = player.time, x?: number) => {
    const el = scroller.current; if (!el) return;
    const cur = ppsRef.current, to = Math.max(MIN_PPS, Math.min(MAX_PPS, next));
    if (to === cur) return;
    let ax = x ?? PAD + t * cur - el.scrollLeft;
    if (x === undefined && (ax < 0 || ax > el.clientWidth)) ax = el.clientWidth / 2; // playhead off screen: bring it to the middle
    anchor.current = { t, x: ax };
    setPps(to);
  };
  const fit = () => { const w = scroller.current?.clientWidth || 800; anchor.current = { t: 0, x: PAD }; setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, (w - PAD - 40) / Math.max(1, total)))); };
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = Math.max(0, PAD + a.t * pps - a.x);
  }, [pps]);
  // Wheel: modifier or pinch zooms around the pointer, a plain vertical wheel scrolls the timeline sideways.
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const x = e.clientX - el.getBoundingClientRect().left;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        const t = Math.max(0, (x + el.scrollLeft - PAD) / ppsRef.current);
        // Pinch / precise trackpads send small deltas; a mouse wheel sends big notches.
        const k = Math.abs(e.deltaY) >= 40 && e.deltaMode === 0 && !e.ctrlKey ? (e.deltaY < 0 ? 1.25 : 0.8) : Math.exp(-e.deltaY * 0.012);
        zoom(ppsRef.current * k, t, x);
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const split = () => { const i = splitAt(player.time); if (i >= 0) setSel(i); };
  const remove = () => { if (sel !== null) { deleteShot(sel); setSel(null); } };

  useEffect(() => {
    const el = scroller.current; if (!el || !playing) return;
    const x = PAD + time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, x - 120);
  }, [time, pps, playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
      if (mod && key === 'z') { e.preventDefault(); undo(e.shiftKey); }
      else if (mod && key === 'b') { e.preventDefault(); split(); }
      else if (e.key === ' ') { e.preventDefault(); player.toggle(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel !== null) { e.preventDefault(); remove(); } }
      else if (e.key === '=' || e.key === '+') { e.preventDefault(); zoom(ppsRef.current * 1.5); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(ppsRef.current / 1.5); }
      else if (e.key === '\\') { e.preventDefault(); fit(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); player.seek(player.time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const timeAt = (clientX: number) => { const el = scroller.current!; return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft - PAD) / pps); };
  const pick = (i: number) => { setSel(i); select(flat[i].si); };
  const down = (e: React.PointerEvent, d: Drag) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(d); };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'seek') player.seek(timeAt(e.clientX));
    else if (drag.kind === 'trim') trimShot(drag.si, drag.k, drag.edge, drag.orig, (e.clientX - drag.x0) / pps);
    else setDrag({ ...drag, dx: e.clientX - drag.x0 });
  };
  const up = () => {
    if (drag?.kind === 'move') {
      if (Math.abs(drag.dx) > 4) {
        const mid = starts[drag.index] + flat[drag.index].sh.dur / 2 + drag.dx / pps;
        let to = starts.findIndex((s, i) => mid < s + flat[i].sh.dur / 2);
        if (to < 0) to = flat.length;
        if (to > drag.index) to -= 1;
        moveShot(drag.index, to);
        setSel(to);
      } else player.seek(starts[drag.index] + 0.01);
    }
    setDrag(null);
  };
  const tick = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pps >= 70) || 1200;

  return (
    <div className="ctl">
      <div className="ctl-bar">
        <div className="ctl-tools">
          <IconButton icon="undo" label="Hoàn tác (⌘Z)" size={16} onClick={() => undo()} />
          <IconButton icon="undo" label="Làm lại (⇧⌘Z)" size={16} className="flip" onClick={() => undo(true)} />
          <span className="ctl-sep" />
          <button className="ctl-btn" onClick={split} title="Tách clip tại vạch phát (⌘B)">✂ Tách</button>
          <button className="ctl-btn" onClick={remove} disabled={sel === null} title="Xoá clip đang chọn (Delete)"><Icon name="trash" size={14} />Xoá</button>
        </div>
        <div className="ctl-zoom">
          <span className="ctl-count">{flat.length} clip · {fmt(total)}</span>
          <button className="ctl-btn" onClick={fit} title="Cả timeline vừa khung (\\)">Vừa khung</button>
          <button className="ctl-icon" onClick={() => zoom(pps / 1.5)} title="Thu nhỏ (−)" aria-label="Thu nhỏ">−</button>
          {/* Logarithmic, so both ends of the zoom range get the same room on the slider. */}
          <input type="range" min={Math.log(MIN_PPS)} max={Math.log(MAX_PPS)} step={0.01} value={Math.log(pps)} onChange={(e) => zoom(Math.exp(Number(e.target.value)))}
            title="Zoom: ⌘/Ctrl hoặc Alt + lăn chuột, chụm 2 ngón trên trackpad, phím = và −" aria-label="Zoom timeline" />
          <button className="ctl-icon" onClick={() => zoom(pps * 1.5)} title="Phóng to (=)" aria-label="Phóng to">+</button>
        </div>
      </div>
      <div className="ctl-body">
        <div className="ctl-heads">
          <div className="ctl-head ruler" />
          <div className="ctl-head rows"><Icon name="layers" size={13} />Hàng sheet</div>
          <div className="ctl-head video"><Icon name="film" size={13} />Video</div>
        </div>
        <div className="ctl-scroll" ref={scroller} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="ctl-inner" style={{ width: PAD + total * pps + 200 }}>
            <div className="ctl-ruler" onPointerDown={(e) => { down(e, { kind: 'seek' }); player.seek(timeAt(e.clientX)); }}>
              {Array.from({ length: Math.floor(total / tick) + 2 }, (_, i) => <span key={i} style={{ left: PAD + i * tick * pps }}>{fmt(i * tick)}</span>)}
            </div>
            <div className="ctl-rows">
              {rows.map((r) => <div key={r.si} className="ctl-row" style={{ left: PAD + r.start * pps, width: Math.max(2, r.dur * pps - 2) }} title={r.label}>{r.label}</div>)}
            </div>
            <div className="ctl-track" onPointerDown={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
              {flat.map((x, i) => {
                const moving = drag?.kind === 'move' && drag.index === i;
                const w = Math.max(4, x.sh.dur * pps - 2);
                return (
                  <div key={i} className={'ctl-clip' + (sel === i ? ' sel' : '') + (moving ? ' moving' : '')}
                    style={{ left: PAD + starts[i] * pps, width: w, transform: moving ? `translateX(${drag.dx}px)` : undefined, backgroundImage: `url("${thumbOf(x.sh.media.url)}")` }}
                    title={`${x.sh.media.prompt}\nVào ${(x.sh.from || 0).toFixed(1)}s · dài ${x.sh.dur.toFixed(1)}s`}
                    onPointerDown={(e) => { pick(i); down(e, { kind: 'move', index: i, x0: e.clientX, dx: 0 }); }}>
                    {w > 50 && <span className="ctl-name">{x.sh.media.prompt}</span>}
                    {w > 34 && <span className="ctl-dur mono">{x.sh.dur.toFixed(1)}s</span>}
                    <i className="ctl-edge l" onPointerDown={(e) => { pick(i); down(e, { kind: 'trim', si: x.si, k: x.k, edge: 'start', x0: e.clientX, orig: { from: x.sh.from || 0, dur: x.sh.dur } }); }} />
                    <i className="ctl-edge r" onPointerDown={(e) => { pick(i); down(e, { kind: 'trim', si: x.si, k: x.k, edge: 'end', x0: e.clientX, orig: { from: x.sh.from || 0, dur: x.sh.dur } }); }} />
                  </div>
                );
              })}
            </div>
            <div className="ctl-playhead" style={{ left: PAD + time * pps }} onPointerDown={(e) => down(e, { kind: 'seek' })}><i /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
