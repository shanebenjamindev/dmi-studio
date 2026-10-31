// Canvas renderer: a pure function of (storyboard, time) → frame.
// Layers per scene: background (AI video/image or procedural) → text layout → brand logo → captions.
import type { Storyboard, Scene } from '../types';

export interface RenderOpts {
  captions?: boolean;
  logo?: boolean;
  getMedia?: (scene: Scene) => CanvasImageSource | null;
  brand?: { full?: HTMLImageElement; white?: HTMLImageElement; mark?: HTMLImageElement };
}

const FONTS: Record<string, { head: string; body: string }> = {
  brand: { head: '800 {s}px "Montserrat", "Inter", system-ui, sans-serif', body: '500 {s}px "Montserrat", "Inter", system-ui, sans-serif' },
  sans: { head: '700 {s}px "Inter", system-ui, sans-serif', body: '500 {s}px "Inter", system-ui, sans-serif' },
  serif: { head: '700 {s}px "Playfair Display", Georgia, serif', body: 'italic 500 {s}px "Playfair Display", Georgia, serif' },
  mono: { head: '700 {s}px "JetBrains Mono", ui-monospace, monospace', body: '500 {s}px "JetBrains Mono", ui-monospace, monospace' },
  display: { head: '400 {s}px "Bebas Neue", Impact, sans-serif', body: '500 {s}px "Inter", system-ui, sans-serif' },
};
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const font = (sb: Storyboard, kind: 'head' | 'body', size: number) => (FONTS[sb.font] || FONTS.brand)[kind].replace('{s}', String(Math.round(size)));

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeBack = (t: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
function rand(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hex(h: string) { h = (h || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return parseInt(h.slice(0, 6), 16) || 0; }
export function hexA(h: string, a: number) { const n = hex(h); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
export function lum(h: string) { const n = hex(h); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
const ok = (i?: HTMLImageElement) => !!i && i.complete && i.naturalWidth > 0;

export interface Segment { i: number; scene: Scene; start: number; end: number; dur: number }
export function timeline(sb: Storyboard | null): Segment[] {
  let t = 0;
  return (sb?.scenes || []).map((scene, i) => {
    const dur = Math.max(1, Number(scene.duration) || 4);
    const seg = { i, scene, start: t, end: t + dur, dur };
    t += dur;
    return seg;
  });
}
export const totalDuration = (sb: Storyboard | null) => (sb?.scenes || []).reduce((a, s) => a + Math.max(1, Number(s.duration) || 4), 0);

function sourceSize(src: any): [number, number] {
  return [src.videoWidth || src.naturalWidth || src.width || 1, src.videoHeight || src.naturalHeight || src.height || 1];
}

// ------------------------------------------------------------------ backgrounds
function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, sb: Storyboard, scene: Scene, t: number, idx: number, opts: RenderOpts) {
  const p = sb.palette;
  const M = Math.min(W, H);
  const media = opts.getMedia?.(scene);
  if (media) {
    const [sw, sh] = sourceSize(media);
    const zoom = scene.media?.type === 'image' ? 1 + 0.08 * clamp(t / Math.max(1, scene.duration)) : 1;
    const s = Math.max(W / sw, H / sh) * zoom;
    ctx.fillStyle = p.bg1; ctx.fillRect(0, 0, W, H);
    try { ctx.drawImage(media, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s); } catch { /* frame not ready */ }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, hexA(p.bg1, 0.5)); g.addColorStop(0.5, hexA(p.bg1, 0.55)); g.addColorStop(1, hexA(p.bg1, 0.85));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    const type = scene.background || 'gradient';
    const ang = t * 0.15 + idx;
    const g = ctx.createLinearGradient(W / 2 - Math.cos(ang) * W, H / 2 - Math.sin(ang) * H, W / 2 + Math.cos(ang) * W, H / 2 + Math.sin(ang) * H);
    g.addColorStop(0, p.bg1); g.addColorStop(1, type === 'solid' ? p.bg1 : p.bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const r = rand(idx * 97 + 13);
    if (type === 'particles') {
      for (let k = 0; k < 70; k++) {
        const x = (r() * W + t * (10 + r() * 30)) % W;
        const y = (r() * H - t * (15 + r() * 40) + H * 10) % H;
        ctx.fillStyle = hexA(k % 4 ? p.text : p.accent, 0.15 + r() * 0.35);
        ctx.beginPath(); ctx.arc(x, y, 1 + r() * M * 0.006, 0, Math.PI * 2); ctx.fill();
      }
    } else if (type === 'grid') {
      ctx.strokeStyle = hexA(p.accent, 0.2); ctx.lineWidth = Math.max(1, M * 0.002);
      const horizon = H * 0.55;
      for (let k = -18; k <= 18; k++) { ctx.beginPath(); ctx.moveTo(W / 2 + k * W * 0.02, horizon); ctx.lineTo(W / 2 + k * W * 0.18, H); ctx.stroke(); }
      for (let k = 0; k < 14; k++) {
        const f = (k + ((t * 0.6) % 1)) / 14, y = horizon + f * f * (H - horizon);
        ctx.globalAlpha = f; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (type === 'waves') {
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        const base = H * (0.62 + k * 0.08), amp = M * (0.03 + k * 0.01);
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += W / 60) ctx.lineTo(x, base + Math.sin((x / W) * 6 + t * (0.8 + k * 0.2) + k) * amp);
        ctx.lineTo(W, H); ctx.closePath();
        ctx.fillStyle = hexA(k % 2 ? p.accent : p.text, 0.06 + k * 0.015); ctx.fill();
      }
    } else if (type === 'blobs') {
      for (let k = 0; k < 4; k++) {
        const cx = W * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.3 + k * 2.1)));
        const cy = H * (0.2 + 0.6 * (0.5 + 0.5 * Math.cos(t * 0.25 + k * 1.7)));
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, M * (0.35 + 0.1 * k));
        rg.addColorStop(0, hexA(k % 2 ? p.accent : p.bg2, 0.45)); rg.addColorStop(1, hexA(p.bg1, 0));
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
    }
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, M * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, lum(p.bg1) > 0.6 ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.35)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ text helpers
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function fit(ctx: CanvasRenderingContext2D, sb: Storyboard, text: string, kind: 'head' | 'body', size: number, maxW: number, maxLines: number) {
  let s = size, lines: string[] = [];
  for (let k = 0; k < 12; k++) {
    ctx.font = font(sb, kind, s); lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines) break;
    s *= 0.88;
  }
  return { size: s, lines };
}
interface A { a: number; dy: number; s: number; raw: number; type?: boolean }
function anim(type: string, t: number, delay: number, dur = 0.7): A {
  const raw = clamp((t - delay) / dur), p = easeOut(raw);
  switch (type) {
    case 'slide-up': return { a: p, dy: (1 - p) * 60, s: 1, raw };
    case 'zoom': return { a: p, dy: 0, s: 0.75 + 0.25 * p, raw };
    case 'pop': return { a: clamp(raw * 2), dy: 0, s: raw === 0 ? 0.01 : easeBack(raw), raw };
    case 'typewriter': return { a: raw > 0 ? 1 : 0, dy: 0, s: 1, raw, type: true };
    default: return { a: p, dy: 0, s: 1, raw };
  }
}
function lines(ctx: CanvasRenderingContext2D, ls: string[], x: number, y: number, lh: number, align: CanvasTextAlign, A: A, cx: number, cy: number, typeP = 1) {
  ctx.save();
  ctx.globalAlpha *= A.a;
  ctx.translate(cx, cy + A.dy); ctx.scale(A.s, A.s); ctx.translate(-cx, -cy);
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  let chars = A.type ? Math.floor(ls.join(' ').length * clamp(typeP)) : Infinity;
  ls.forEach((ln, i) => {
    let out = ln;
    if (chars !== Infinity) { out = ln.slice(0, Math.max(0, chars)); chars -= ln.length + 1; }
    if (out) ctx.fillText(out, x, y + i * lh);
  });
  ctx.restore();
}
function countUp(str: string, p: number) {
  const m = String(str || '').match(/^(.*?)(-?[\d.,]+)(.*)$/);
  if (!m) return str;
  const num = parseFloat(m[2].replace(/,/g, ''));
  if (!isFinite(num)) return str;
  const dec = (m[2].split('.')[1] || '').length;
  return m[1] + (num * easeOut(clamp(p))).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3];
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ------------------------------------------------------------------ layouts
function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, sb: Storyboard, scene: Scene, t: number, idx: number, opts: RenderOpts) {
  drawBackground(ctx, W, H, sb, scene, t, idx, opts);
  const p = sb.palette, M = Math.min(W, H), vertical = H > W * 1.1, pad = M * 0.09;
  const an = scene.animation || 'fade', layout = scene.layout || 'title';
  const typeP = (d: number) => (t - d) / Math.max(0.8, (scene.headline || '').length * 0.045);
  const B = opts.brand, withLogo = !!(opts.logo && B && ok(B.mark));
  let outroBottom = 0;
  ctx.fillStyle = p.text;
  ctx.save();
  if (scene.media && lum(p.text) > 0.5) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = M * 0.025; ctx.shadowOffsetY = M * 0.003; }

  if (layout === 'title' || layout === 'outro') {
    const y = H * (layout === 'outro' ? (withLogo ? 0.33 : 0.4) : 0.42);
    if (scene.icon) {
      ctx.font = `${Math.round(M * 0.13)}px ${EMOJI}`;
      lines(ctx, [scene.icon], W / 2, y - M * 0.2, 0, 'center', anim('pop', t, 0.05), W / 2, y - M * 0.2);
    }
    const f = fit(ctx, sb, scene.headline, 'head', M * (sb.font === 'display' ? 0.15 : 0.1), W - pad * 2, 3);
    ctx.font = font(sb, 'head', f.size); ctx.fillStyle = p.text;
    const lh = f.size * 1.12, top = y - ((f.lines.length - 1) * lh) / 2;
    lines(ctx, f.lines, W / 2, top, lh, 'center', anim(an, t, 0.2), W / 2, y, typeP(0.2));
    const after = top + f.lines.length * lh + M * 0.02;
    const u = anim('fade', t, 0.6);
    ctx.fillStyle = p.accent; ctx.globalAlpha = u.a;
    const uw = M * 0.12 * easeOut(u.raw);
    ctx.fillRect(W / 2 - uw / 2, after - M * 0.01, uw, Math.max(3, M * 0.008));
    ctx.globalAlpha = 1;
    if (scene.subtext) {
      if (layout === 'outro') {
        ctx.font = font(sb, 'head', M * 0.042);
        const tw = ctx.measureText(scene.subtext).width + M * 0.12, th = M * 0.1;
        const A2 = anim('pop', t, 0.8);
        ctx.save(); ctx.globalAlpha = A2.a; ctx.translate(W / 2, after + M * 0.1); ctx.scale(A2.s, A2.s);
        const bg = ctx.createLinearGradient(-tw / 2, 0, tw / 2, 0);
        bg.addColorStop(0, p.accent); bg.addColorStop(1, hexA(p.accent, 0.85));
        ctx.fillStyle = bg; roundRect(ctx, -tw / 2, -th / 2, tw, th, th / 2); ctx.fill();
        ctx.fillStyle = lum(p.accent) > 0.55 ? '#0a0a0a' : '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(scene.subtext, 0, 0);
        ctx.restore();
        outroBottom = after + M * 0.1 + th / 2;
      } else {
        const s = fit(ctx, sb, scene.subtext, 'body', M * 0.045, W - pad * 2.5, 3);
        ctx.font = font(sb, 'body', s.size); ctx.fillStyle = hexA(p.text, 0.85);
        lines(ctx, s.lines, W / 2, after + M * 0.07, s.size * 1.35, 'center', anim('slide-up', t, 0.6), W / 2, after);
      }
    }
  } else if (layout === 'bullets') {
    const x = pad;
    const f = fit(ctx, sb, scene.headline, 'head', M * 0.075, W - pad * 2, 2);
    ctx.font = font(sb, 'head', f.size); ctx.fillStyle = p.text;
    let y = vertical ? H * 0.22 : H * 0.2;
    lines(ctx, f.lines, x, y, f.size * 1.12, 'left', anim(an, t, 0.1), x, y, typeP(0.1));
    y += f.lines.length * f.size * 1.12 + M * 0.06;
    const bs = M * (vertical ? 0.05 : 0.048);
    (scene.bullets || []).filter((b) => b.trim()).slice(0, 5).forEach((b, i) => {
      const A2 = anim('slide-up', t, 0.5 + i * 0.35);
      const s = fit(ctx, sb, b, 'body', bs, W - pad * 2 - bs * 1.6, 2);
      ctx.save(); ctx.globalAlpha = A2.a; ctx.fillStyle = p.accent;
      ctx.beginPath(); ctx.arc(x + bs * 0.35, y + A2.dy, bs * 0.22 * (A2.raw ? easeBack(A2.raw) : 0), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.font = font(sb, 'body', s.size); ctx.fillStyle = p.text;
      lines(ctx, s.lines, x + bs * 1.1, y, s.size * 1.25, 'left', A2, x, y);
      y += s.lines.length * s.size * 1.25 + bs * 0.9;
    });
    if (scene.icon && !scene.media) {
      const A2 = anim('zoom', t, 0.3);
      ctx.font = `${Math.round(M * 0.22)}px ${EMOJI}`;
      ctx.save(); ctx.globalAlpha = 0.22 * A2.a; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(scene.icon, W - pad * 0.6, H - pad * (opts.captions ? 1.8 : 0.6)); ctx.restore();
    }
  } else if (layout === 'stat') {
    const A2 = anim(an === 'typewriter' ? 'zoom' : an, t, 0.1);
    const cp = clamp((t - 0.1) / Math.min(2, scene.duration * 0.5));
    const raw = scene.stat_value || scene.headline;
    const f = fit(ctx, sb, raw, 'head', M * 0.26, W - pad * 2, 1);
    ctx.font = font(sb, 'head', f.size); ctx.fillStyle = p.accent;
    const y = H * 0.42;
    lines(ctx, [countUp(raw, cp)], W / 2, y, 0, 'center', A2, W / 2, y);
    const label = scene.stat_label || scene.subtext || '';
    if (label) {
      const yy = y + f.size * 0.6 + M * 0.05;
      const s = fit(ctx, sb, label, 'body', M * 0.05, W - pad * 2, 2);
      ctx.font = font(sb, 'body', s.size); ctx.fillStyle = p.text;
      lines(ctx, s.lines, W / 2, yy, s.size * 1.3, 'center', anim('slide-up', t, 0.5), W / 2, yy);
    }
    if (scene.stat_value && scene.headline) {
      const s = fit(ctx, sb, scene.headline, 'head', M * 0.045, W - pad * 2, 2);
      ctx.font = font(sb, 'head', s.size); ctx.fillStyle = hexA(p.text, 0.75);
      lines(ctx, s.lines, W / 2, H * 0.17, s.size * 1.2, 'center', anim('fade', t, 0.2), W / 2, H * 0.17);
    }
  } else if (layout === 'quote') {
    ctx.font = font({ ...sb, font: 'serif' }, 'head', M * 0.4); ctx.fillStyle = hexA(p.accent, 0.4);
    lines(ctx, ['“'], W / 2, H * 0.27, 0, 'center', anim('zoom', t, 0), W / 2, H * 0.27);
    const f = fit(ctx, sb, scene.headline, 'body', M * 0.07, W - pad * 2.4, 5);
    ctx.font = font(sb, 'body', f.size); ctx.fillStyle = p.text;
    const lh = f.size * 1.3, y = H * 0.48 - ((f.lines.length - 1) * lh) / 2;
    lines(ctx, f.lines, W / 2, y, lh, 'center', anim(an, t, 0.3), W / 2, H * 0.48, typeP(0.3));
    if (scene.subtext) {
      ctx.font = font(sb, 'head', M * 0.036); ctx.fillStyle = p.accent;
      const yy = y + f.lines.length * lh + M * 0.05;
      lines(ctx, ['— ' + scene.subtext], W / 2, yy, 0, 'center', anim('fade', t, 1.0), W / 2, yy);
    }
  } else if (layout === 'split') {
    const pp = easeOut(clamp(t / 0.8));
    ctx.fillStyle = hexA(p.accent, scene.media ? 0.82 : 0.92);
    let tx: number, ty: number, tw: number, ix: number, iy: number;
    if (vertical) { ctx.fillRect(0, 0, W, H * 0.42 * pp); ix = W / 2; iy = H * 0.21; tx = pad; ty = H * 0.52; tw = W - pad * 2; }
    else { ctx.fillRect(0, 0, W * 0.42 * pp, H); ix = W * 0.21; iy = H / 2; tx = W * 0.42 + pad; ty = H * 0.38; tw = W * 0.58 - pad * 2; }
    if (scene.icon) { ctx.font = `${Math.round(M * 0.2)}px ${EMOJI}`; lines(ctx, [scene.icon], ix, iy, 0, 'center', anim('pop', t, 0.4), ix, iy); }
    const f = fit(ctx, sb, scene.headline, 'head', M * 0.08, tw, 3);
    ctx.font = font(sb, 'head', f.size); ctx.fillStyle = p.text;
    lines(ctx, f.lines, tx, ty, f.size * 1.12, 'left', anim(an, t, 0.5), tx, ty, typeP(0.5));
    if (scene.subtext) {
      const yy = ty + f.lines.length * f.size * 1.12 + M * 0.04;
      const s = fit(ctx, sb, scene.subtext, 'body', M * 0.042, tw, 4);
      ctx.font = font(sb, 'body', s.size); ctx.fillStyle = hexA(p.text, 0.82);
      lines(ctx, s.lines, tx, yy, s.size * 1.35, 'left', anim('slide-up', t, 0.9), tx, yy);
    }
  }

  ctx.restore(); // end text shadow

  // brand logo: small mark on every scene, full lockup on the outro
  if (withLogo && B) {
    const darkBg = lum(p.bg1) < 0.55;
    if (layout === 'outro') {
      const img = darkBg ? B.white : B.full;
      if (ok(img)) {
        const capTop = opts.captions && scene.caption ? H - M * 0.2 : H - M * 0.06;
        const top = Math.max(H * 0.62, (outroBottom || H * 0.5) + M * 0.07);
        let lw = Math.min(W * (vertical ? 0.78 : 0.4), M * 1.1), lh = (lw * img!.naturalHeight) / img!.naturalWidth;
        if (top + lh > capTop) { lh = Math.max(M * 0.05, capTop - top); lw = (lh * img!.naturalWidth) / img!.naturalHeight; }
        const A2 = anim('slide-up', t, 1.1);
        ctx.save(); ctx.globalAlpha *= A2.a; ctx.drawImage(img!, (W - lw) / 2, top + A2.dy * 0.5, lw, lh); ctx.restore();
      }
    } else {
      const mh = M * 0.065, mw = (mh * B.mark!.naturalWidth) / B.mark!.naturalHeight;
      ctx.save(); ctx.globalAlpha *= 0.92 * clamp(t / 0.5);
      ctx.drawImage(B.mark!, W - pad * 0.5 - mw, pad * 0.5, mw, mh); ctx.restore();
    }
  }

  if (opts.captions && scene.caption) {
    const cs = M * 0.034;
    ctx.font = `500 ${Math.round(cs)}px "Inter", system-ui, sans-serif`;
    const ls = wrap(ctx, scene.caption, W * 0.8).slice(0, 3);
    const lh = cs * 1.35, boxH = ls.length * lh + cs * 0.9, by = H - boxH - M * 0.05;
    const boxW = Math.min(W * 0.86, Math.max(...ls.map((l) => ctx.measureText(l).width)) + cs * 1.6);
    ctx.save(); ctx.globalAlpha *= clamp(t / 0.3) * clamp((scene.duration - t) / 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(ctx, (W - boxW) / 2, by, boxW, boxH, cs * 0.5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ls.forEach((l, i) => ctx.fillText(l, W / 2, by + cs * 0.45 + lh * (i + 0.5)));
    ctx.restore();
  }
}

export const XF = 0.45; // crossfade seconds
export function renderFrame(ctx: CanvasRenderingContext2D, W: number, H: number, sb: Storyboard | null, time: number, opts: RenderOpts = {}) {
  const tl = timeline(sb);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  if (!sb || !tl.length) { ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H); ctx.restore(); return; }
  const total = tl[tl.length - 1].end;
  const tt = clamp(time, 0, total - 0.0001);
  const cur = tl.find((s) => tt >= s.start && tt < s.end) || tl[tl.length - 1];
  drawScene(ctx, W, H, sb, cur.scene, tt - cur.start, cur.i, opts);
  const next = tl[cur.i + 1];
  if (next && cur.end - tt < XF) {
    ctx.globalAlpha = 1 - (cur.end - tt) / XF;
    drawScene(ctx, W, H, sb, next.scene, 0, next.i, opts);
    ctx.globalAlpha = 1;
  }
  const edge = Math.min(clamp(tt / 0.4), clamp((total - tt) / 0.5));
  if (edge < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - edge})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}
