// DMI Studio — canvas renderer. Pure function of (storyboard, time) → frame.
(function () {
  const FONTS = {
    sans: { head: '700 {s}px "Inter", system-ui, sans-serif', body: '500 {s}px "Inter", system-ui, sans-serif' },
    serif: { head: '700 {s}px "Playfair Display", Georgia, serif', body: 'italic 500 {s}px "Playfair Display", Georgia, serif' },
    mono: { head: '700 {s}px "JetBrains Mono", ui-monospace, monospace', body: '500 {s}px "JetBrains Mono", ui-monospace, monospace' },
    display: { head: '400 {s}px "Bebas Neue", "Impact", sans-serif', body: '500 {s}px "Inter", system-ui, sans-serif' },
  };
  const font = (sb, kind, size) => (FONTS[sb.font] || FONTS.sans)[kind].replace('{s}', Math.round(size));

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  function rand(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  function hexA(hex, a) {
    let h = (hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------------------------------------------------------------- timeline
  function timeline(sb) {
    let t = 0;
    return (sb.scenes || []).map((s, i) => {
      const d = Math.max(1, Number(s.duration) || 4);
      const seg = { i, scene: s, start: t, end: t + d, dur: d };
      t += d;
      return seg;
    });
  }
  const totalDuration = (sb) => (sb.scenes || []).reduce((a, s) => a + Math.max(1, Number(s.duration) || 4), 0);

  // ---------------------------------------------------------------- backgrounds
  function drawBackground(ctx, W, H, sb, scene, t, idx) {
    const p = sb.palette || {};
    const type = scene.background || 'gradient';
    const ang = t * 0.15 + idx;
    const g = ctx.createLinearGradient(
      W / 2 - Math.cos(ang) * W, H / 2 - Math.sin(ang) * H,
      W / 2 + Math.cos(ang) * W, H / 2 + Math.sin(ang) * H);
    g.addColorStop(0, p.bg1 || '#0f172a');
    g.addColorStop(1, type === 'solid' ? (p.bg1 || '#0f172a') : (p.bg2 || '#1e293b'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const M = Math.min(W, H);
    const r = rand(idx * 97 + 13);

    if (type === 'particles') {
      for (let k = 0; k < 70; k++) {
        const x = (r() * W + t * (10 + r() * 30)) % W;
        const y = (r() * H - t * (15 + r() * 40) + H * 10) % H;
        const s = 1 + r() * M * 0.006;
        ctx.fillStyle = hexA(k % 4 ? p.text : p.accent, 0.15 + r() * 0.35);
        ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      }
    } else if (type === 'grid') {
      ctx.strokeStyle = hexA(p.accent, 0.18); ctx.lineWidth = Math.max(1, M * 0.002);
      const horizon = H * 0.55, cols = 18;
      for (let k = -cols; k <= cols; k++) {
        ctx.beginPath(); ctx.moveTo(W / 2 + k * W * 0.02, horizon); ctx.lineTo(W / 2 + k * W * 0.18, H); ctx.stroke();
      }
      for (let k = 0; k < 14; k++) {
        const f = ((k + (t * 0.6) % 1) / 14);
        const y = horizon + Math.pow(f, 2) * (H - horizon);
        ctx.globalAlpha = f; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (type === 'waves') {
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        const base = H * (0.62 + k * 0.08), amp = M * (0.03 + k * 0.01);
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += W / 60) ctx.lineTo(x, base + Math.sin(x / W * 6 + t * (0.8 + k * 0.2) + k) * amp);
        ctx.lineTo(W, H); ctx.closePath();
        ctx.fillStyle = hexA(k % 2 ? p.accent : p.text, 0.06 + k * 0.015);
        ctx.fill();
      }
    } else if (type === 'blobs') {
      for (let k = 0; k < 4; k++) {
        const cx = W * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.3 + k * 2.1)));
        const cy = H * (0.2 + 0.6 * (0.5 + 0.5 * Math.cos(t * 0.25 + k * 1.7)));
        const rad = M * (0.35 + 0.1 * k);
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        rg.addColorStop(0, hexA(k % 2 ? p.accent : p.bg2, 0.45));
        rg.addColorStop(1, hexA(p.bg1, 0));
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
    }
    // vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, M * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- text helpers
  function wrap(ctx, text, maxW) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = []; let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  // fit a headline: shrink until it fits in maxLines
  function fitText(ctx, sb, text, kind, size, maxW, maxLines) {
    let s = size, lines;
    for (let k = 0; k < 12; k++) {
      ctx.font = font(sb, kind, s);
      lines = wrap(ctx, text, maxW);
      if (lines.length <= maxLines) break;
      s *= 0.88;
    }
    return { size: s, lines };
  }

  // Animated element: returns transform params given anim type and local progress
  function anim(type, t, delay, dur = 0.7) {
    const raw = clamp((t - delay) / dur);
    const p = easeOut(raw);
    switch (type) {
      case 'slide-up': return { a: p, dy: (1 - p) * 60, s: 1, raw };
      case 'zoom': return { a: p, dy: 0, s: 0.75 + 0.25 * p, raw };
      case 'pop': return { a: clamp(raw * 2), dy: 0, s: raw === 0 ? 0.01 : easeBack(raw), raw };
      case 'typewriter': return { a: raw > 0 ? 1 : 0, dy: 0, s: 1, raw, type: true };
      default: return { a: p, dy: 0, s: 1, raw };
    }
  }

  function drawLines(ctx, lines, x, y, lh, align, A, cx, cy, typeProgress) {
    ctx.save();
    ctx.globalAlpha *= A.a;
    ctx.translate(cx, cy + A.dy); ctx.scale(A.s, A.s); ctx.translate(-cx, -cy);
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    let chars = Infinity;
    if (A.type) chars = Math.floor(lines.join(' ').length * clamp(typeProgress));
    lines.forEach((ln, i) => {
      let out = ln;
      if (chars !== Infinity) { out = ln.slice(0, Math.max(0, chars)); chars -= ln.length + 1; }
      if (out) ctx.fillText(out, x, y + i * lh);
    });
    ctx.restore();
  }

  function animateNumber(str, p) {
    const m = String(str || '').match(/^(.*?)(-?[\d.,]+)(.*)$/);
    if (!m) return str;
    const num = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(num)) return str;
    const dec = (m[2].split('.')[1] || '').length;
    const v = num * easeOut(clamp(p));
    return m[1] + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3];
  }

  // ---------------------------------------------------------------- layouts
  function drawScene(ctx, W, H, sb, scene, t, idx, opts) {
    drawBackground(ctx, W, H, sb, scene, t, idx);
    const p = sb.palette || {};
    const M = Math.min(W, H);
    const vertical = H > W * 1.1;
    const pad = M * 0.09;
    const an = scene.animation || 'fade';
    const typeP = (d) => (t - d) / Math.max(0.8, (scene.headline || '').length * 0.045);
    ctx.fillStyle = p.text || '#fff';

    const layout = scene.layout || 'title';

    if (layout === 'title' || layout === 'outro') {
      let y = H * (layout === 'outro' ? 0.4 : 0.42);
      if (scene.icon) {
        const A = anim('pop', t, 0.05);
        ctx.font = `${Math.round(M * 0.13)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        drawLines(ctx, [scene.icon], W / 2, y - M * 0.2, 0, 'center', A, W / 2, y - M * 0.2);
      }
      const f = fitText(ctx, sb, scene.headline, 'head', M * (sb.font === 'display' ? 0.15 : 0.1), W - pad * 2, 3);
      ctx.font = font(sb, 'head', f.size); ctx.fillStyle = p.text;
      const lh = f.size * 1.12;
      const top = y - ((f.lines.length - 1) * lh) / 2;
      drawLines(ctx, f.lines, W / 2, top, lh, 'center', anim(an, t, 0.2), W / 2, y, typeP(0.2));
      let after = top + f.lines.length * lh + M * 0.02;
      // accent underline
      const u = anim('fade', t, 0.6);
      ctx.fillStyle = p.accent; ctx.globalAlpha = u.a;
      const uw = M * 0.12 * easeOut(u.raw);
      ctx.fillRect(W / 2 - uw / 2, after - M * 0.01, uw, Math.max(3, M * 0.008));
      ctx.globalAlpha = 1;
      if (scene.subtext) {
        if (layout === 'outro') {
          ctx.font = font(sb, 'body', M * 0.045);
          const tw = ctx.measureText(scene.subtext).width + M * 0.1, th = M * 0.1;
          const A = anim('pop', t, 0.8);
          ctx.save(); ctx.globalAlpha = A.a;
          ctx.translate(W / 2, after + M * 0.1); ctx.scale(A.s, A.s);
          ctx.fillStyle = p.accent; roundRect(ctx, -tw / 2, -th / 2, tw, th, th / 2); ctx.fill();
          ctx.fillStyle = p.bg1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(scene.subtext, 0, 0);
          ctx.restore();
        } else {
          const s = fitText(ctx, sb, scene.subtext, 'body', M * 0.045, W - pad * 2.5, 3);
          ctx.font = font(sb, 'body', s.size); ctx.fillStyle = hexA(p.text, 0.82);
          drawLines(ctx, s.lines, W / 2, after + M * 0.07, s.size * 1.35, 'center', anim('slide-up', t, 0.6), W / 2, after);
        }
      }
    }

    else if (layout === 'bullets') {
      const x = pad;
      const f = fitText(ctx, sb, scene.headline, 'head', M * 0.075, W - pad * 2, 2);
      ctx.font = font(sb, 'head', f.size); ctx.fillStyle = p.text;
      let y = vertical ? H * 0.22 : H * 0.2;
      drawLines(ctx, f.lines, x, y, f.size * 1.12, 'left', anim(an, t, 0.1), x, y, typeP(0.1));
      y += f.lines.length * f.size * 1.12 + M * 0.06;
      const items = (scene.bullets || []).slice(0, 5);
      const bs = M * (vertical ? 0.05 : 0.048);
      items.forEach((b, i) => {
        const A = anim('slide-up', t, 0.5 + i * 0.35);
        const s = fitText(ctx, sb, b, 'body', bs, W - pad * 2 - bs * 1.6, 2);
        ctx.save(); ctx.globalAlpha = A.a;
        ctx.fillStyle = p.accent;
        ctx.beginPath(); ctx.arc(x + bs * 0.35, y + A.dy, bs * 0.22 * (A.raw ? easeBack(A.raw) : 0), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.font = font(sb, 'body', s.size); ctx.fillStyle = p.text;
        drawLines(ctx, s.lines, x + bs * 1.1, y, s.size * 1.25, 'left', A, x, y);
        y += s.lines.length * s.size * 1.25 + bs * 0.9;
      });
      if (scene.icon) {
        const A = anim('zoom', t, 0.3);
        ctx.font = `${Math.round(M * 0.22)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.save(); ctx.globalAlpha = 0.22 * A.a;
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(scene.icon, W - pad * 0.6, H - pad * (opts.captions ? 1.8 : 0.6));
        ctx.restore();
      }
    }

    else if (layout === 'stat') {
      const A = anim(an === 'typewriter' ? 'zoom' : an, t, 0.1);
      const cp = clamp((t - 0.1) / Math.min(2, scene.duration * 0.5));
      const value = animateNumber(scene.stat_value || scene.headline, cp);
      const f = fitText(ctx, sb, scene.stat_value || scene.headline, 'head', M * 0.26, W - pad * 2, 1);
      ctx.font = font(sb, 'head', f.size); ctx.fillStyle = p.accent;
      const y = H * 0.4;
      drawLines(ctx, [value], W / 2, y, 0, 'center', A, W / 2, y);
      const label = scene.stat_label || scene.subtext || '';
      const head = scene.stat_value ? scene.headline : '';
      let yy = y + f.size * 0.6 + M * 0.05;
      if (label) {
        const s = fitText(ctx, sb, label, 'body', M * 0.05, W - pad * 2, 2);
        ctx.font = font(sb, 'body', s.size); ctx.fillStyle = p.text;
        drawLines(ctx, s.lines, W / 2, yy, s.size * 1.3, 'center', anim('slide-up', t, 0.5), W / 2, yy);
        yy += s.lines.length * s.size * 1.3 + M * 0.03;
      }
      if (head) {
        const s = fitText(ctx, sb, head, 'head', M * 0.045, W - pad * 2, 2);
        ctx.font = font(sb, 'head', s.size); ctx.fillStyle = hexA(p.text, 0.7);
        drawLines(ctx, s.lines, W / 2, H * 0.17, s.size * 1.2, 'center', anim('fade', t, 0.2), W / 2, H * 0.17);
      }
    }

    else if (layout === 'quote') {
      const qA = anim('zoom', t, 0);
      ctx.font = font({ font: 'serif' }, 'head', M * 0.4); ctx.fillStyle = hexA(p.accent, 0.35);
      drawLines(ctx, ['“'], W / 2, H * 0.27, 0, 'center', qA, W / 2, H * 0.27);
      const f = fitText(ctx, sb, scene.headline, 'body', M * 0.07, W - pad * 2.4, 5);
      ctx.font = font(sb, 'body', f.size); ctx.fillStyle = p.text;
      const lh = f.size * 1.3, y = H * 0.48 - ((f.lines.length - 1) * lh) / 2;
      drawLines(ctx, f.lines, W / 2, y, lh, 'center', anim(an, t, 0.3), W / 2, H * 0.48, typeP(0.3));
      if (scene.subtext) {
        ctx.font = font(sb, 'head', M * 0.036); ctx.fillStyle = p.accent;
        const yy = y + f.lines.length * lh + M * 0.05;
        drawLines(ctx, ['— ' + scene.subtext], W / 2, yy, 0, 'center', anim('fade', t, 1.0), W / 2, yy);
      }
    }

    else if (layout === 'split') {
      const A = anim('fade', t, 0);
      const panelP = easeOut(clamp(t / 0.8));
      ctx.fillStyle = hexA(p.accent, 0.9);
      let tx, ty, tw, iconX, iconY;
      if (vertical) {
        ctx.fillRect(0, 0, W, H * 0.42 * panelP);
        iconX = W / 2; iconY = H * 0.21; tx = pad; ty = H * 0.52; tw = W - pad * 2;
      } else {
        ctx.fillRect(0, 0, W * 0.42 * panelP, H);
        iconX = W * 0.21; iconY = H / 2; tx = W * 0.42 + pad; ty = H * 0.38; tw = W * 0.58 - pad * 2;
      }
      if (scene.icon) {
        ctx.font = `${Math.round(M * 0.2)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        drawLines(ctx, [scene.icon], iconX, iconY, 0, 'center', anim('pop', t, 0.4), iconX, iconY);
      }
      const f = fitText(ctx, sb, scene.headline, 'head', M * 0.08, tw, 3);
      ctx.font = font(sb, 'head', f.size); ctx.fillStyle = p.text;
      drawLines(ctx, f.lines, tx, ty, f.size * 1.12, 'left', anim(an, t, 0.5), tx, ty, typeP(0.5));
      if (scene.subtext) {
        const yy = ty + f.lines.length * f.size * 1.12 + M * 0.04;
        const s = fitText(ctx, sb, scene.subtext, 'body', M * 0.042, tw, 4);
        ctx.font = font(sb, 'body', s.size); ctx.fillStyle = hexA(p.text, 0.8);
        drawLines(ctx, s.lines, tx, yy, s.size * 1.35, 'left', anim('slide-up', t, 0.9), tx, yy);
      }
      void A;
    }

    // captions
    if (opts.captions && scene.caption) {
      const cs = M * 0.034;
      ctx.font = `500 ${Math.round(cs)}px "Inter", system-ui, sans-serif`;
      const lines = wrap(ctx, scene.caption, W * 0.8).slice(0, 3);
      const lh = cs * 1.35, boxH = lines.length * lh + cs * 0.9;
      const by = H - boxH - M * 0.05;
      const boxW = Math.min(W * 0.86, Math.max(...lines.map((l) => ctx.measureText(l).width)) + cs * 1.6);
      const ca = clamp(t / 0.3) * clamp((scene.duration - t) / 0.3);
      ctx.save(); ctx.globalAlpha *= ca;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; roundRect(ctx, (W - boxW) / 2, by, boxW, boxH, cs * 0.5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, W / 2, by + cs * 0.45 + lh * (i + 0.5)));
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- frame with transitions
  const XF = 0.45; // crossfade seconds
  function renderFrame(ctx, W, H, sb, time, opts = {}) {
    const tl = timeline(sb);
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (!tl.length) { ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H); ctx.restore(); return; }
    const total = tl[tl.length - 1].end;
    const tt = clamp(time, 0, total - 0.0001);
    const k = tl.findIndex((s) => tt >= s.start && tt < s.end);
    const cur = tl[k < 0 ? tl.length - 1 : k];
    drawScene(ctx, W, H, sb, cur.scene, tt - cur.start, cur.i, opts);
    const next = tl[cur.i + 1];
    if (next && cur.end - tt < XF) {
      ctx.globalAlpha = 1 - (cur.end - tt) / XF;
      drawScene(ctx, W, H, sb, next.scene, 0, next.i, opts);
      ctx.globalAlpha = 1;
    }
    // global fade in/out
    const edge = Math.min(clamp(tt / 0.4), clamp((total - tt) / 0.5));
    if (edge < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - edge})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  window.DMIRenderer = { renderFrame, timeline, totalDuration };
})();
