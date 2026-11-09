// The gap between two panes: dragging it makes one of them wider or narrower. The width is a CSS variable on the
// panes' parent (its stylesheet reads it, falling back to the usual width) and stays for next time in this browser.
// Double-click (or Enter) puts it back; the arrow keys, Home and End move it too. Hidden on phones, where panes stack.
// `side="before"` (default) sizes the pane just before the handle; `side="after"` the one just after it (a fixed
// column on the right, such as a card's comments).
import { useEffect, useRef } from 'react';

export function ResizeHandle({ cssVar, storage, min, max, label, side = 'before' }: { cssVar: string; storage: string; min: number; max: number; label: string; side?: 'before' | 'after' }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `dms.width.${storage}`;
  const sign = side === 'after' ? -1 : 1;
  const set = (width: number | null, keep = false) => {
    const host = ref.current?.parentElement;
    if (!host) return;
    if (width === null) {
      host.style.removeProperty(cssVar);
      ref.current?.removeAttribute('aria-valuenow');
      if (keep) try { localStorage.removeItem(key); } catch { /* private mode */ }
      return;
    }
    const w = Math.round(Math.min(max, Math.max(min, width)));
    host.style.setProperty(cssVar, `${w}px`);
    if (ref.current) ref.current.setAttribute('aria-valuenow', String(w));
    if (keep) try { localStorage.setItem(key, String(w)); } catch { /* private mode */ }
  };
  // The pane being sized is the one just before (or after) the handle.
  const width = () => ((side === 'after' ? ref.current?.nextElementSibling : ref.current?.previousElementSibling) as HTMLElement | null)?.getBoundingClientRect().width || min;
  useEffect(() => {
    try { const w = Number(localStorage.getItem(key)); if (w) set(w); } catch { /* private mode */ }
    const host = ref.current?.parentElement;
    return () => { host?.style.removeProperty(cssVar); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent) => {
    if (e.button) return;
    e.preventDefault();
    const start = e.clientX, from = width();
    document.body.classList.add('resizing');
    ref.current?.classList.add('on');
    const move = (m: PointerEvent) => set(from + sign * (m.clientX - start));
    const up = (m: PointerEvent) => {
      set(from + sign * (m.clientX - start), true);
      document.body.classList.remove('resizing');
      ref.current?.classList.remove('on');
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16, w = width();
    if (e.key === 'Enter') { e.preventDefault(); set(null, true); return; }
    const grow = e.key === (side === 'after' ? 'ArrowLeft' : 'ArrowRight'), shrink = e.key === (side === 'after' ? 'ArrowRight' : 'ArrowLeft');
    const next = grow ? w + step : shrink ? w - step : e.key === 'Home' ? min : e.key === 'End' ? max : undefined;
    if (next === undefined) return;
    e.preventDefault(); set(next, true);
  };
  return <div ref={ref} className="resize-handle" role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={min} aria-valuemax={max}
    tabIndex={0} title="Kéo để đổi độ rộng · bấm đúp để về mặc định" onPointerDown={down} onDoubleClick={() => set(null, true)} onKeyDown={onKey} />;
}
