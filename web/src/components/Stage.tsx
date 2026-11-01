import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { player } from '../engine/player';
import { timeline } from '../engine/renderer';
import { useStore, select, setOpts, fmt, getState, setState, sceneOp } from '../store';
import { Icon, IconButton } from './ui';
import type { Aspect } from '../types';

const PREVIEW: Record<Aspect, [number, number]> = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [960, 960] };
function usePlayer<T>(sel: () => T) { return useSyncExternalStore((cb) => player.subscribe(cb), sel); }

export function Stage() {
  const project = useStore((s) => s.project);
  const busy = useStore((s) => s.busy);
  const opts = useStore((s) => s.opts);
  const jobs = useStore((s) => s.jobs);
  const sel = useStore((s) => s.sel);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aspect = (project?.aspect || '16:9') as Aspect;
  const sb = project?.storyboard || null;
  const playing = usePlayer(() => player.playing);
  const time = usePlayer(() => Math.round(player.time * 10) / 10);
  const assembly = sb?.mode === 'edit';
  const waiting = usePlayer(() => player.waiting);
  const total = player.total;

  useEffect(() => {
    const c = canvasRef.current!; const [w, h] = PREVIEW[aspect];
    c.width = w; c.height = h; player.attach(c);
  }, [aspect]);
  useEffect(() => {
    if (!playing || !sb) return;
    const i = player.sceneIndexAt(player.time);
    if (i !== getState().sel) setState({ sel: i });
  }, [time, playing, sb]);

  const tl = timeline(sb);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const seekFromEvent = (e: React.PointerEvent) => {
    const r = trackRef.current!.getBoundingClientRect();
    player.seek(((e.clientX - r.left) / r.width) * total);
  };
  const running = new Set(jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.sceneId));
  const jump = (d: number) => {
    if (!sb) return;
    const i = Math.max(0, Math.min(tl.length - 1, player.sceneIndexAt(player.time) + d));
    select(i);
  };

  return (
    <section className="center">
      <div className="stage">
        <canvas id="stage" ref={canvasRef} className={sb ? '' : 'hidden'} />
        {!sb && !busy && (
          <div className="welcome">
            <img src="/brand/mark.png" alt="" />
            <h2>Dán link sheet<br />là có bản ghép source.</h2>
            <p>Các video source được xếp đúng thứ tự trong sheet; chỉnh tiếp trên timeline.</p>
          </div>
        )}
        {busy && <div className="hud"><div className="spinner" /><span>{busy}</span></div>}
        {!busy && waiting && <div className="hud small"><div className="spinner" /><span>Đang tải clip từ Drive…</span></div>}
      </div>

      {!assembly && <div className="transport">
        <span className="time mono">{fmt(time)}<em> / {fmt(total)}</em></span>
        <div className="controls">
          <IconButton icon="back" label="Cảnh trước" onClick={() => jump(-1)} disabled={!sb} />
          <button id="btnPlay" className="play" onClick={() => player.toggle()} disabled={!sb} aria-label={playing ? 'Tạm dừng' : 'Phát'} title="Phát / dừng (phím cách)">
            <Icon name={playing ? 'pause' : 'play'} size={22} />
          </button>
          <IconButton icon="fwd" label="Cảnh sau" onClick={() => jump(1)} disabled={!sb} />
        </div>
        <div className="toggles">{!assembly && <>
          <IconButton icon="cc" label="Phụ đề" active={opts.captions} onClick={() => setOpts({ captions: !opts.captions })} />
          <IconButton icon="badge" label="Logo" active={opts.logo} onClick={() => setOpts({ logo: !opts.logo })} />
          <IconButton icon="music" label="Nhạc nền" active={opts.music} onClick={() => setOpts({ music: !opts.music })} />
          <IconButton icon="mic" label="Giọng đọc" active={opts.voice} onClick={() => setOpts({ voice: !opts.voice })} />
        </>}</div>
      </div>}

      {!assembly && <div className="timeline">
        <div className="track" ref={trackRef}
          onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.clip')) return; setDrag(true); (e.target as HTMLElement).setPointerCapture(e.pointerId); seekFromEvent(e); }}
          onPointerMove={(e) => drag && seekFromEvent(e)} onPointerUp={() => setDrag(false)}>
          {!sb && <div className="track-empty">Các cảnh sẽ hiện ở đây</div>}
          {tl.map((seg) => (
            <button key={seg.scene.id} className={'clip' + (seg.i === sel ? ' sel' : '')} style={{ flex: `${seg.dur} 1 0`, ['--c1' as any]: sb!.palette.bg1, ['--c2' as any]: seg.i % 2 ? sb!.palette.accent : sb!.palette.bg2 }}
              onClick={() => select(seg.i)} title={seg.scene.headline}>
              <span className="clip-top">
                <b>{seg.i + 1}</b>
                <span className="clip-ico">
                  {seg.scene.media && <Icon name={seg.scene.media.type === 'video' ? 'film' : 'photo'} size={12} />}
                  {seg.scene.voice && <Icon name="mic" size={12} />}
                  {running.has(seg.scene.id) && <span className="dotspin" />}
                </span>
              </span>
              <span className="clip-name">{seg.scene.headline}</span>
              <span className="clip-dur">{seg.dur}s</span>
            </button>
          ))}
          {sb && <div className="playhead" style={{ left: `${total ? (time / total) * 100 : 0}%` }} />}
        </div>
        {sb && <IconButton icon="plus" label="Thêm cảnh" className="add-scene" onClick={() => sceneOp('add')} />}
      </div>}
    </section>
  );
}
