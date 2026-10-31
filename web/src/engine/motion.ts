// Procedural motion previews for the car templates: each template gets a small canvas animation
// that illustrates its edit (orbit, crash zoom, drift smoke…). Pure code — no API, no stored files.
type G = CanvasRenderingContext2D;
interface F { g: G; W: number; H: number; M: number; t: number; p: number; cw: number }

const TAU = Math.PI * 2;
const LOOP = 4;
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x: number) => { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2; };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const frac = (x: number) => x - Math.floor(x);
const pingpong = (p: number) => 0.5 - 0.5 * Math.cos(p * TAU);

// ---------------------------------------------------------------- painting helpers
function vgrad(f: F, stops: [number, string][], y0 = 0, y1 = f.H) {
  const gr = f.g.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  f.g.fillStyle = gr; f.g.fillRect(0, y0, f.W, y1 - y0);
}
function radial(f: F, inner: string, outer: string, cx = 0.5, cy = 0.35, r = 1) {
  const gr = f.g.createRadialGradient(f.W * cx, f.H * cy, 0, f.W * cx, f.H * cy, Math.max(f.W, f.H) * r);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  f.g.fillStyle = gr; f.g.fillRect(0, 0, f.W, f.H);
}
function glow(g: G, x: number, y: number, r: number, color: string, a = 1) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = a; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.globalAlpha = 1;
}
function floorFade(f: F, gy: number, color = 'rgba(0,0,0,') {
  const gr = f.g.createLinearGradient(0, gy, 0, f.H);
  gr.addColorStop(0, color + '0.55)'); gr.addColorStop(0.5, color + '0.9)'); gr.addColorStop(1, color + '1)');
  f.g.fillStyle = gr; f.g.fillRect(0, gy, f.W, f.H - gy);
}
/** Draw `fn` mirrored under the ground line, then fade it — glossy studio floor. */
function reflect(f: F, gy: number, fn: () => void, color?: string) {
  const { g } = f;
  g.save(); g.translate(0, gy * 2); g.scale(1, -1); g.globalAlpha = 0.3; fn(); g.restore();
  floorFade(f, gy, color);
}
function jag(g: G, pts: [number, number][], color: string, width: number, blur: number) {
  g.save(); g.strokeStyle = color; g.lineWidth = width; g.shadowColor = color; g.shadowBlur = blur; g.lineJoin = 'round';
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.restore();
}
function bolt(x0: number, y0: number, x1: number, y1: number, seed: number, n = 12, amp = 0.08): [number, number][] {
  const d = Math.hypot(x1 - x0, y1 - y0);
  return Array.from({ length: n + 1 }, (_, i) => {
    const k = i / n, j = i === 0 || i === n ? 0 : (rnd(seed + i * 7.3) - 0.5) * d * amp;
    return [lerp(x0, x1, k) + j, lerp(y0, y1, k) + j * 0.3] as [number, number];
  });
}

// ---------------------------------------------------------------- cars (unit width, origin on the ground at the car's centre)
function bodyPath(g: G) {
  g.beginPath();
  g.moveTo(-0.5, -0.07);
  g.lineTo(-0.49, -0.16);
  g.quadraticCurveTo(-0.47, -0.2, -0.38, -0.21);
  g.lineTo(-0.2, -0.22);
  g.quadraticCurveTo(-0.08, -0.335, 0.06, -0.33);
  g.quadraticCurveTo(0.16, -0.32, 0.24, -0.225);
  g.quadraticCurveTo(0.42, -0.2, 0.49, -0.145);
  g.quadraticCurveTo(0.525, -0.1, 0.5, -0.055);
  g.lineTo(-0.48, -0.045);
  g.closePath();
}
function glassPath(g: G) {
  g.beginPath();
  g.moveTo(-0.17, -0.218);
  g.quadraticCurveTo(-0.07, -0.312, 0.05, -0.308);
  g.quadraticCurveTo(0.14, -0.3, 0.205, -0.226);
  g.closePath();
}
interface CarOpts { paint?: string; sx?: number; lights?: number; spin?: number; shine?: number; wire?: string; explode?: number }
function wheel(g: G, spin: number, wire?: string, lw = 0.004) {
  g.beginPath(); g.arc(0, 0, 0.075, 0, TAU);
  if (wire) { g.strokeStyle = wire; g.lineWidth = lw; g.stroke(); } else { g.fillStyle = '#0a0a0b'; g.fill(); }
  g.beginPath(); g.arc(0, 0, 0.047, 0, TAU);
  if (wire) g.stroke(); else { g.fillStyle = '#8d939c'; g.fill(); }
  g.strokeStyle = wire || '#3b3f46'; g.lineWidth = wire ? lw : 0.009;
  for (let k = 0; k < 5; k++) { const a = spin + (k * TAU) / 5; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 0.045, Math.sin(a) * 0.045); g.stroke(); }
}
function drawCar(g: G, x: number, y: number, w: number, o: CarOpts = {}) {
  const e = o.explode || 0, lw = 1.6 / w;
  g.save(); g.translate(x, y); g.scale(w * (o.sx ?? 1), w);
  for (const wx of [-0.31, 0.31]) { g.save(); g.translate(wx + Math.sign(wx) * 0.12 * e, -0.068 + 0.09 * e); wheel(g, o.spin || 0, o.wire, lw); g.restore(); }
  if (e > 0) {
    g.globalAlpha = clamp(e * 1.5);
    g.fillStyle = '#6b7280'; g.fillRect(0.22, -0.2 - 0.2 * e, 0.16, 0.08);
    g.fillStyle = '#9ca3af'; g.fillRect(-0.12, -0.17 - 0.12 * e, 0.12, 0.07);
    g.globalAlpha = 1;
  }
  bodyPath(g);
  if (o.wire) { g.strokeStyle = o.wire; g.lineWidth = lw; g.stroke(); }
  else {
    g.fillStyle = o.paint || '#c9ced6'; g.fill();
    const sh = g.createLinearGradient(0, -0.34, 0, -0.04);
    sh.addColorStop(0, 'rgba(255,255,255,0.45)'); sh.addColorStop(0.35, 'rgba(255,255,255,0.08)'); sh.addColorStop(0.55, 'rgba(0,0,0,0.05)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = sh; g.fill();
    if (o.shine !== undefined) {
      g.save(); g.clip();
      const sx = lerp(-0.7, 0.7, o.shine), band = g.createLinearGradient(sx - 0.12, 0, sx + 0.12, 0);
      band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.5, 'rgba(255,255,255,0.75)'); band.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = band; g.fillRect(-0.6, -0.4, 1.2, 0.4); g.restore();
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = lw * 0.8;
    g.beginPath(); g.moveTo(-0.44, -0.12); g.lineTo(0.46, -0.115); g.stroke();
  }
  g.save(); g.translate(0, -0.22 * e); glassPath(g);
  if (o.wire) g.stroke(); else { g.fillStyle = '#0c1118'; g.fill(); }
  g.restore();
  if (!o.wire) {
    const L = o.lights ?? 0.6;
    g.fillStyle = `rgba(255,252,235,${0.35 + 0.65 * L})`; g.beginPath(); g.ellipse(0.475, -0.125, 0.028, 0.012, -0.3, 0, TAU); g.fill();
    if (L > 0.5) glow(g, 0.5, -0.125, 0.12 * L, 'rgba(255,250,225,0.55)');
    g.fillStyle = '#d0142c'; g.fillRect(-0.497, -0.165, 0.02, 0.03);
  }
  g.restore();
}
function drawCarFront(g: G, x: number, y: number, w: number, o: { paint?: string; lights?: number; rear?: boolean } = {}) {
  const L = o.lights ?? 0.6;
  g.save(); g.translate(x, y); g.scale(w, w);
  g.fillStyle = '#0a0a0b'; g.fillRect(-0.5, -0.11, 0.15, 0.11); g.fillRect(0.35, -0.11, 0.15, 0.11);
  g.beginPath(); g.moveTo(-0.38, -0.31); g.lineTo(-0.27, -0.5); g.lineTo(0.27, -0.5); g.lineTo(0.38, -0.31); g.closePath();
  g.fillStyle = o.paint || '#c9ced6'; g.fill();
  g.beginPath(); g.moveTo(-0.33, -0.32); g.lineTo(-0.25, -0.47); g.lineTo(0.25, -0.47); g.lineTo(0.33, -0.32); g.closePath();
  g.fillStyle = '#0c1118'; g.fill();
  g.beginPath(); g.moveTo(-0.5, -0.07); g.lineTo(-0.5, -0.24); g.quadraticCurveTo(-0.48, -0.32, -0.4, -0.33); g.lineTo(0.4, -0.33); g.quadraticCurveTo(0.48, -0.32, 0.5, -0.24); g.lineTo(0.5, -0.07); g.closePath();
  g.fillStyle = o.paint || '#c9ced6'; g.fill();
  const sh = g.createLinearGradient(0, -0.5, 0, -0.05);
  sh.addColorStop(0, 'rgba(255,255,255,0.4)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.05)'); sh.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = sh; g.fill();
  if (o.rear) {
    g.fillStyle = '#ff1f3d'; g.fillRect(-0.44, -0.27, 0.88, 0.035);
    glow(g, -0.38, -0.25, 0.18, 'rgba(255,30,60,0.6)', L); glow(g, 0.38, -0.25, 0.18, 'rgba(255,30,60,0.6)', L);
  } else {
    g.fillStyle = '#121418'; g.fillRect(-0.17, -0.2, 0.34, 0.08);
    for (const s of [-1, 1]) {
      g.fillStyle = `rgba(255,252,235,${0.3 + 0.7 * L})`; g.beginPath(); g.ellipse(s * 0.34, -0.25, 0.08, 0.022, 0, 0, TAU); g.fill();
      if (L > 0.3) glow(g, s * 0.34, -0.25, 0.22 * L, 'rgba(255,250,230,0.6)');
    }
  }
  g.restore();
}
function drawCarTop(g: G, x: number, y: number, len: number, ang: number, paint = '#e6e9ee') {
  g.save(); g.translate(x, y); g.rotate(ang); g.scale(len, len);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.roundRect(-0.48, -0.2, 1, 0.46, 0.12); g.fill();
  g.fillStyle = paint; g.beginPath(); g.roundRect(-0.5, -0.22, 1, 0.44, 0.13); g.fill();
  g.fillStyle = '#0c1118';
  g.beginPath(); g.moveTo(0.18, -0.17); g.lineTo(0.3, -0.19); g.lineTo(0.3, 0.19); g.lineTo(0.18, 0.17); g.closePath(); g.fill();
  g.fillRect(-0.32, -0.16, 0.08, 0.32);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-0.24, -0.16, 0.42, 0.32);
  g.restore();
}
function clipCar(g: G, x: number, y: number, w: number) {
  const m = g.getTransform(); g.translate(x, y); g.scale(w, w); bodyPath(g); g.setTransform(m); g.clip();
}


// Speed ramp: fast → slow-motion dip at `at` → fast. Returns scene progress (0..1) and current speed for loop progress p.
function ramp(p: number, at = 0.5, depth = 0.9, width = 0.12) {
  const speed = (x: number) => 1 - depth * Math.exp(-(((x - at) / width) ** 2));
  let total = 0, upto = 0;
  for (let i = 0; i < 80; i++) { const x = (i + 0.5) / 80, v = speed(x) / 80; total += v; if (x < p) upto += v; }
  return { pos: upto / total, speed: speed(p) };
}
/** Small speed-curve HUD with a playhead, like the curve editor in CapCut. */
function rampHud(f: F, p: number, speed: number, at = 0.5, depth = 0.9, width = 0.12) {
  const { g, W, H, M } = f, x0 = W * 0.08, x1 = W * 0.92, y0 = H * 0.2, h = H * 0.06;
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.stroke();
  g.strokeStyle = '#ffd400'; g.lineWidth = M * 0.006; g.beginPath();
  for (let i = 0; i <= 60; i++) { const x = i / 60, v = 1 - depth * Math.exp(-(((x - at) / width) ** 2)); const px = lerp(x0, x1, x), py = y0 - v * h; i ? g.lineTo(px, py) : g.moveTo(px, py); }
  g.stroke();
  const px = lerp(x0, x1, p);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(px, y0 - speed * h, M * 0.012, 0, TAU); g.fill();
  g.font = `700 ${Math.round(M * 0.05)}px -apple-system, Inter, sans-serif`; g.textAlign = 'right';
  g.fillStyle = speed < 0.4 ? '#ffd400' : '#fff';
  g.fillText(speed < 0.4 ? `×${Math.max(0.1, speed).toFixed(1)}` : `×${(1 + (speed - 0.4) * 3).toFixed(1)}`, x1, y0 - h - M * 0.03);
  g.restore();
}

// ---------------------------------------------------------------- effects, one per template id
const FX: Record<string, (f: F) => void> = {
  'orbit-360'(f) {
    const { g, W, H, p, cw } = f, gy = H * 0.64;
    radial(f, '#3a4250', '#08090c', 0.5, 0.3, 0.8);
    for (let i = 0; i < 3; i++) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(W * (0.2 + i * 0.22), H * 0.06, W * 0.16, H * 0.006); }
    const s = Math.cos(p * TAU), sx = (Math.abs(s) * 0.75 + 0.25) * (s < 0 ? -1 : 1);
    const car = () => { drawCar(g, W / 2, gy, cw * 0.9, { sx, shine: frac(p * 2), lights: 1 }); g.globalAlpha = clamp(1 - Math.abs(s) * 3); drawCarFront(g, W / 2, gy, cw * 0.4, { rear: s < 0 && Math.sin(p * TAU) > 0 }); g.globalAlpha = 1; };
    reflect(f, gy, car); car();
  },
  'crash-zoom'(f) {
    const { g, W, H, M, p, cw } = f, gy = H * 0.66, w = cw * 0.8;
    vgrad(f, [[0, '#2b1f3d'], [0.55, '#d9731f'], [0.66, '#ffb36b'], [0.661, '#2a2522'], [1, '#141210']]);
    const k = ease((p - 0.3) / 0.14), z = 1 + 7 * k;
    const hx = W / 2 + 0.475 * w, hy = gy - 0.125 * w;
    g.save(); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-lerp(W / 2, hx, k), -lerp(H / 2, hy, k));
    drawCar(g, W / 2, gy, w, { lights: p > 0.45 ? 1 : 0, paint: '#e8e4dc' }); g.restore();
    if (p > 0.28 && p < 0.5) for (let i = 0; i < 48; i++) {
      const a = rnd(i) * TAU, r0 = M * (0.2 + rnd(i + 3) * 0.3);
      g.strokeStyle = `rgba(255,255,255,${0.35 * Math.sin(((p - 0.28) / 0.22) * Math.PI)})`; g.lineWidth = M * 0.004;
      g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); g.lineTo(W / 2 + Math.cos(a) * r0 * 3, H / 2 + Math.sin(a) * r0 * 3); g.stroke();
    }
    if (p > 0.45) glow(g, W / 2, H / 2, M * 0.9, 'rgba(255,240,210,0.85)', clamp((p - 0.45) * 6) * (0.85 + 0.15 * Math.sin(p * 90)));
  },
  'fpv-dive'(f) {
    const { g, W, H, M, p } = f;
    const road = (y: number) => W / 2 + Math.sin((y / H) * 4 + 1) * W * 0.22;
    const cy = H * (0.9 - 0.75 * p), cx = road(cy), dxdy = Math.cos((cy / H) * 4 + 1) * W * 0.22 * (4 / H);
    const z = lerp(1, 2.8, ease(p));
    g.save(); g.translate(W / 2, H / 2); g.scale(z, z); g.rotate(Math.sin(p * TAU) * 0.08); g.translate(-cx, -cy);
    g.fillStyle = '#2f4a2a'; g.fillRect(-W, -H, W * 3, H * 3);
    for (let i = 0; i < 160; i++) { g.fillStyle = i % 3 ? '#1f3a1d' : '#3d5e33'; g.beginPath(); g.arc(rnd(i) * W * 1.4 - W * 0.2, rnd(i + 9) * H * 1.4 - H * 0.2, M * (0.015 + rnd(i + 4) * 0.02), 0, TAU); g.fill(); }
    g.strokeStyle = '#3c3f44'; g.lineWidth = W * 0.09; g.lineCap = 'round'; g.beginPath();
    for (let y = -H * 0.3; y <= H * 1.3; y += H / 60) (y < -H * 0.29 ? g.moveTo(road(y), y) : g.lineTo(road(y), y)); g.stroke();
    g.strokeStyle = '#e8d27a'; g.lineWidth = W * 0.004; g.setLineDash([W * 0.02, W * 0.02]); g.stroke(); g.setLineDash([]);
    drawCarTop(g, cx, cy, W * 0.06, Math.atan2(-1, -dxdy), '#e23b2e');
    g.restore();
    g.fillStyle = `rgba(230,240,245,${0.55 * (1 - ease(p * 1.6))})`; g.fillRect(0, 0, W, H);
  },
  'low-tracking'(f) {
    const { g, W, H, M, t, cw } = f, gy = H * 0.7;
    vgrad(f, [[0, '#f0b770'], [0.5, '#6d6f74'], [0.69, '#9a9ea6'], [0.7, '#2d2f33'], [1, '#121315']]);
    for (let i = 0; i < 7; i++) { const x = frac(i / 7 - t * 1.8) * W * 1.6 - W * 0.3; g.fillStyle = '#e8e3d0'; g.fillRect(x, H * 0.86, W * 0.12, H * 0.012); }
    for (let i = 0; i < 40; i++) { const x = frac(rnd(i) - t * 2.5) * W * 1.5 - W * 0.25; g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, gy + rnd(i + 2) * (H - gy), W * 0.2, M * 0.002); }
    drawCar(g, W * 0.42, gy + Math.sin(t * 40) * M * 0.0015, cw * 1.35, { spin: -t * 25, paint: '#1d2027', shine: 0.85, lights: 1 });
    glow(g, W * 0.05, H * 0.2, M * 0.5, 'rgba(255,200,120,0.5)');
  },
  'bullet-time'(f) {
    const { g, W, H, M, p, cw } = f, gy = H * 0.72;
    vgrad(f, [[0, '#f2c38b'], [0.6, '#d68b48'], [1, '#6e4220']]);
    glow(g, W * 0.5, H * 0.45, M * 0.7, 'rgba(255,240,200,0.8)');
    g.fillStyle = '#7a4a22'; g.beginPath(); g.moveTo(0, gy); g.quadraticCurveTo(W * 0.3, gy - H * 0.08, W * 0.55, gy + H * 0.02); g.quadraticCurveTo(W * 0.8, gy + H * 0.08, W, gy - H * 0.03); g.lineTo(W, H); g.lineTo(0, H); g.fill();
    for (let i = 0; i < 90; i++) {
      const d = rnd(i + 1), x = W * (rnd(i) * 1.2 - 0.1) + (p - 0.5) * W * 0.25 * (d + 0.3), y = H * (0.25 + rnd(i + 2) * 0.5);
      g.fillStyle = `rgba(250,220,170,${0.3 + d * 0.6})`; g.beginPath(); g.arc(x, y, M * (0.002 + d * 0.007), 0, TAU); g.fill();
    }
    g.save(); g.translate(W / 2, H * 0.5); g.rotate(-0.12);
    drawCar(g, 0, cw * 0.15, cw * 0.95, { sx: Math.cos(Math.sin(p * TAU) * 0.6), paint: '#1d2027', shine: p, lights: 0.4 }); g.restore();
  },
  'dolly-zoom'(f) {
    const { g, W, H, M, p, cw } = f, vx = W / 2, vy = H * 0.5, k = lerp(0.6, 2.4, pingpong(p));
    g.fillStyle = '#05080e'; g.fillRect(0, 0, W, H);
    for (let i = 14; i >= 0; i--) {
      const s = 1 / (1 + i * 0.3 * k), hw = W * 0.75 * s, hh = H * 0.55 * s, shade = Math.round(18 + 50 * s);
      g.fillStyle = `rgb(${shade},${shade + 6},${shade + 14})`; g.fillRect(vx - hw, vy - hh, hw * 2, hh * 2);
      g.fillStyle = `rgba(220,235,255,${0.4 + 0.6 * s})`;
      g.fillRect(vx - hw * 0.4, vy - hh, hw * 0.8, M * 0.006 * s * 2);
      g.fillRect(vx - hw, vy - hh * 0.2, M * 0.005 * s * 2, hh * 0.4); g.fillRect(vx + hw - M * 0.01 * s, vy - hh * 0.2, M * 0.005 * s * 2, hh * 0.4);
    }
    radial(f, 'rgba(60,120,200,0)', 'rgba(5,15,35,0.6)', 0.5, 0.5, 0.7);
    drawCarFront(g, W / 2, H * 0.84, cw * 0.62, { paint: '#c4cbd4', lights: 1 });
  },
  'top-down'(f) {
    const { g, W, H, M, p } = f;
    g.fillStyle = '#4b5a2c'; g.fillRect(0, 0, W, H);
    const cols = ['#c8642a', '#e0a33a', '#9b3b22', '#6e7a34'];
    for (let i = 0; i < 220; i++) { g.fillStyle = cols[i % 4]; g.beginPath(); g.arc(rnd(i) * W, rnd(i + 7) * H, M * (0.012 + rnd(i + 3) * 0.02), 0, TAU); g.fill(); }
    const at = (u: number): [number, number] => [W / 2 + W * 0.3 * Math.sin(u * TAU * 1.5), H * (0.04 + 0.92 * u)];
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [col, lw] of [['#d9d4c5', 0.13], ['#3a3c40', 0.115]] as const) {
      g.strokeStyle = col; g.lineWidth = W * lw; g.beginPath();
      for (let u = 0; u <= 1.001; u += 0.01) { const [x, y] = at(u); u ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    }
    const u = 1 - p, [x, y] = at(u), [x2, y2] = at(u + 0.01), ang = Math.atan2(y - y2, x - x2);
    g.strokeStyle = 'rgba(10,10,10,0.5)'; g.lineWidth = M * 0.006; g.beginPath();
    for (let v = Math.min(1, u + 0.25); v >= u; v -= 0.01) { const [a, b] = at(v); g.lineTo(a, b); } g.stroke();
    for (let i = 0; i < 8; i++) glow(g, x2 + (rnd(i) - 0.5) * M * 0.06, y2 + rnd(i + 1) * M * 0.05, M * 0.05, 'rgba(230,230,230,0.5)');
    drawCarTop(g, x, y, W * 0.11, ang + Math.sin(p * TAU * 3) * 0.35, '#f5f5f5');
  },
  'ramp-pass'(f) {
    const { g, W, H, M, p, cw } = f, gy = H * 0.68, { pos, speed } = ramp(p);
    vgrad(f, [[0, '#1b2233'], [0.55, '#4a5566'], [0.67, '#8a7f86'], [0.68, '#24262b'], [1, '#0e0f12']]);
    for (let i = 0; i < 8; i++) { const x = frac(i / 8 - pos * 3) * W * 1.4 - W * 0.2; g.fillStyle = '#d9d4c5'; g.fillRect(x, H * 0.84, W * 0.1, H * 0.01); }
    const blur = clamp((speed - 0.3) * 1.4);
    for (let i = 0; i < 50; i++) { const x = frac(rnd(i) - pos * 4) * W * 1.4 - W * 0.2; g.fillStyle = `rgba(255,255,255,${0.12 * blur})`; g.fillRect(x, gy + rnd(i + 2) * (H - gy), W * 0.3 * blur, M * 0.002); }
    for (let i = 0; i < 60; i++) { const x = rnd(i) * W, y = frac(rnd(i + 5) + pos * 2) * H; g.strokeStyle = `rgba(200,215,235,${0.35})`; g.lineWidth = M * 0.002; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + M * (0.004 + 0.05 * speed)); g.stroke(); }
    const x = lerp(-0.7, 1.7, pos) * W;
    for (let k = 3; k >= 1; k--) { g.globalAlpha = 0.18 * blur; drawCar(g, x - k * W * 0.06 * blur, gy, cw * 1.05, { paint: '#1d2027', lights: 1 }); }
    g.globalAlpha = 1;
    drawCar(g, x, gy, cw * 1.05, { spin: -pos * 60, paint: '#1d2027', lights: 1, shine: 1 - pos });
    rampHud(f, p, speed);
  },
  'ramp-drift'(f) {
    const { g, W, H, M, p, cw } = f, gy = H * 0.66, { pos, speed } = ramp(p);
    radial(f, '#30333a', '#060607', 0.5, 0.05, 0.9);
    for (let i = 0; i < 3; i++) glow(g, W * (0.15 + i * 0.35), H * 0.04, M * 0.25, 'rgba(255,255,255,0.35)');
    const x = lerp(-0.45, 1.45, pos) * W, ang = Math.sin(clamp(pos * 1.6 - 0.3) * Math.PI) * 0.32;
    for (let i = 0; i < 70; i++) {
      const b = i / 70; if (b > pos) continue;
      const a = clamp((pos - b) * 2.2), sx = lerp(-0.45, 1.45, b) * W - 0.3 * cw;
      glow(g, sx - a * W * 0.1, gy - M * 0.02 - a * H * 0.25 * rnd(i), M * (0.04 + a * 0.22), 'rgba(235,235,240,0.8)', (1 - a) * 0.5);
    }
    g.save(); g.translate(x, gy); g.rotate(-ang); drawCar(g, 0, 0, cw * 0.85, { spin: -pos * 50, paint: '#e8eaee', lights: 1, shine: 0.4 }); g.restore();
    rampHud(f, p, speed);
  },
  'ramp-launch'(f) {
    const { g, W, H, M, p, cw } = f, gy = H * 0.7, { pos, speed } = ramp(p, 0.42, 0.92, 0.14);
    vgrad(f, [[0, '#f0c27b'], [0.62, '#d98f45'], [0.69, '#f2d2a0'], [0.7, '#3a332c'], [1, '#17130f']]);
    g.fillStyle = '#f5f1e6'; for (let i = 0; i < 6; i++) g.fillRect(W * 0.3 + i * W * 0.012, gy + H * 0.02, W * 0.006, H * 0.06);
    const move = clamp((pos - 0.3) / 0.7), x = W * 0.42 + move * move * W * 1.4, rw = x - 0.31 * cw * 0.85;
    const burst = clamp((pos - 0.18) * 4) * (1 - move);
    for (let i = 0; i < 120; i++) {
      const a = frac(rnd(i) + pos * 3), vx = -(0.2 + rnd(i + 1)) * W * 0.5, vy = -(0.1 + rnd(i + 2)) * H * 0.3;
      g.fillStyle = `rgba(120,95,70,${burst * (1 - a)})`; g.beginPath(); g.arc(rw + vx * a, gy + vy * a + H * 0.3 * a * a, M * (0.002 + rnd(i + 3) * 0.007), 0, TAU); g.fill();
    }
    for (let i = 0; i < 12; i++) glow(g, rw - rnd(i) * W * 0.35 * (0.3 + move), gy - rnd(i + 1) * H * 0.1, M * (0.08 + rnd(i + 2) * 0.12), 'rgba(210,170,120,0.8)', 0.35 * clamp(pos * 3));
    g.save(); g.translate(x, gy); g.rotate(-0.025 * burst); drawCar(g, 0, 0, cw * 0.85, { spin: -pos * 80, paint: '#c21d2b', lights: 1, shine: 0.3 }); g.restore();
    rampHud(f, p, speed, 0.42, 0.92, 0.14);
  },
  'drift-smoke'(f) {
    const { g, W, H, M, t, p, cw } = f, gy = H * 0.66, cx = W * 0.55 + Math.sin(p * TAU) * W * 0.05;
    radial(f, '#2a2c31', '#050506', 0.5, 0.1, 0.9);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(W * 0.45, 0); g.lineTo(W * 0.55, 0); g.lineTo(W * 0.95, gy); g.lineTo(W * 0.05, gy); g.fill();
    const puffs = (front: boolean) => {
      for (let i = front ? 1 : 0; i < 60; i += 2) {
        const a = frac(p * 1.5 + i / 60), ox = cx - 0.33 * cw, oy = gy - M * 0.03;
        glow(g, ox - a * W * 0.55 * (0.5 + rnd(i)), oy - a * H * 0.3 * rnd(i + 1), M * (0.05 + a * 0.3), 'rgba(235,235,240,0.8)', (1 - a) * 0.45);
      }
    };
    puffs(false);
    const car = () => { g.save(); g.translate(cx, gy); g.rotate(Math.sin(p * TAU) * 0.04); drawCar(g, 0, 0, cw * 0.85, { spin: -t * 40, paint: '#1a1c22', shine: 0.3, lights: 1 }); g.restore(); };
    reflect(f, gy, car); car(); puffs(true);
  },
  lightning(f) {
    const { g, W, H, M, t, p, cw } = f, gy = H * 0.7, seed = Math.floor(t / LOOP);
    vgrad(f, [[0, '#0a0f2b'], [0.7, '#141a3a'], [0.701, '#07080f'], [1, '#020205']]);
    for (let i = 0; i < 6; i++) glow(g, W * rnd(i + seed), H * 0.1 * rnd(i + 2), M * 0.4, 'rgba(40,45,80,0.9)');
    const flash = (p > 0.3 && p < 0.34) || (p > 0.38 && p < 0.41) ? 1 : p > 0.41 ? Math.max(0, 0.3 - (p - 0.41)) : 0;
    if (flash > 0) {
      g.fillStyle = `rgba(200,210,255,${flash * 0.35})`; g.fillRect(0, 0, W, H);
      jag(g, bolt(W * (0.25 + 0.5 * rnd(seed)), 0, W * 0.62, gy - cw * 0.05, seed, 14, 0.12), '#eef2ff', M * 0.008, M * 0.05);
    }
    const car = () => drawCar(g, W / 2, gy, cw * 0.85, { paint: '#2a2f3a', lights: p > 0.31 ? 1 : 0, shine: flash > 0.5 ? 0.6 : undefined });
    reflect(f, gy, car); car();
    if (p > 0.31 && p < 0.85) for (let i = 0; i < 5; i++) {
      const s = Math.floor(t * 18) * 13 + i, x = W / 2 + (rnd(s) - 0.5) * cw * 0.8, y = gy - rnd(s + 1) * cw * 0.3;
      jag(g, bolt(x, y, x + (rnd(s + 2) - 0.5) * cw * 0.25, y + (rnd(s + 3) - 0.5) * cw * 0.15, s, 6, 0.4), '#7fd8ff', M * 0.003, M * 0.02);
    }
    g.strokeStyle = 'rgba(180,190,230,0.3)'; g.lineWidth = M * 0.002;
    for (let i = 0; i < 90; i++) { const x = frac(rnd(i) + t * 0.1) * W, y = frac(rnd(i + 5) + t * 1.8) * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x - M * 0.01, y + M * 0.05); g.stroke(); }
  },
  'fire-trail'(f) {
    const { g, W, H, M, t, cw } = f, gy = H * 0.7, cx = W * 0.62;
    vgrad(f, [[0, '#060b26'], [0.68, '#2a1230'], [0.7, '#140806'], [1, '#050302']]);
    glow(g, W * 0.3, gy, M * 0.6, 'rgba(255,90,20,0.35)');
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const k = i / 70, x = cx - 0.33 * cw - k * W * 0.9, fl = rnd(i + Math.floor(t * 14) * 3), h = M * (0.05 + 0.1 * fl) * (1 - k * 0.6);
      const gr = g.createRadialGradient(x, gy, 0, x, gy - h * 0.5, h);
      gr.addColorStop(0, 'rgba(255,240,170,0.9)'); gr.addColorStop(0.4, 'rgba(255,120,30,0.6)'); gr.addColorStop(1, 'rgba(120,20,0,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, gy - h * 0.4, h * 0.45, h, 0, 0, TAU); g.fill();
    }
    for (let i = 0; i < 40; i++) { const a = frac(rnd(i) + t * 0.8), x = cx - 0.33 * cw - rnd(i + 1) * W * 0.8; g.fillStyle = `rgba(255,200,90,${1 - a})`; g.fillRect(x, gy - a * H * 0.3, M * 0.004, M * 0.004); }
    g.globalCompositeOperation = 'source-over';
    drawCar(g, cx, gy, cw * 0.8, { spin: -t * 30, paint: '#15171c', lights: 1, shine: 0.15 });
  },
  'explosion-escape'(f) {
    const { g, W, H, M, p, cw } = f, gy = H * 0.68, k = ease(p * 1.25);
    const shake = p > 0.05 && p < 0.35 ? (rnd(p * 999) - 0.5) * M * 0.02 : 0;
    g.save(); g.translate(shake, shake * 0.6);
    vgrad(f, [[0, '#1c0a04'], [0.67, '#3a1606'], [0.68, '#191007'], [1, '#080503']]);
    for (let i = 0; i < 5; i++) { g.fillStyle = '#0d0603'; g.fillRect(W * (i * 0.22 - 0.05), gy - H * (0.15 + rnd(i) * 0.15), W * 0.16, H * 0.3); }
    const r = M * (0.15 + 0.9 * k), cx = W / 2, cy = gy - M * 0.1;
    glow(g, cx, cy, r * 1.3, 'rgba(60,20,10,0.9)', 1);
    g.globalCompositeOperation = 'lighter';
    glow(g, cx, cy, r, 'rgba(255,120,30,0.9)'); glow(g, cx, cy, r * 0.55, 'rgba(255,220,120,0.9)'); glow(g, cx, cy, r * 0.25, 'rgba(255,255,230,0.9)', 1 - k * 0.6);
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 36; i++) {
      const a = rnd(i) * Math.PI + Math.PI, d = r * (0.5 + rnd(i + 1) * 1.1);
      g.fillStyle = i % 3 ? '#1a0d06' : '#ffb054'; g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, M * 0.012, M * 0.008);
    }
    drawCarFront(g, W / 2, lerp(gy + M * 0.02, H * 1.02, ease(p)), cw * lerp(0.35, 1.05, ease(p)), { paint: '#2a2c30', lights: 1 });
    g.restore();
  },
  'speed-warp'(f) {
    const { g, W, H, M, t, p, cw } = f, cx = W / 2, cy = H * 0.42, speed = 0.15 + ease(p) * 1.6;
    radial(f, '#0b1640', '#02040d', 0.5, 0.42, 0.8);
    for (let i = 0; i < 160; i++) {
      const a = rnd(i) * TAU, z = frac(rnd(i + 1) + t * speed * 0.4), d1 = M * 0.03 / (1.05 - z), d0 = d1 * (1 - 0.15 * speed);
      g.strokeStyle = i % 4 ? `rgba(160,230,255,${z})` : `rgba(255,255,255,${z})`; g.lineWidth = M * 0.002 * (1 + z * 2);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0); g.lineTo(cx + Math.cos(a) * d1, cy + Math.sin(a) * d1); g.stroke();
    }
    if (p > 0.65 && p < 0.75) { g.fillStyle = `rgba(200,240,255,${0.5 * Math.sin(((p - 0.65) / 0.1) * Math.PI)})`; g.fillRect(0, 0, W, H); }
    drawCarFront(g, cx, H * 0.86, cw * 0.6, { rear: true, paint: '#1c1f26', lights: 1 });
  },
  'glass-shatter'(f) {
    const { g, W, H, M, p, cw } = f, k = clamp((p - 0.3) / 0.7);
    radial(f, '#2a3038', '#020203', 0.5, 0.2, 0.8);
    g.globalAlpha = lerp(0.25, 1, ease(k * 2));
    drawCarFront(g, W / 2, H * 0.8, cw * lerp(0.45, 0.7, ease(k)), { paint: '#c9d6e3', lights: k > 0 ? 1 : 0.2 }); g.globalAlpha = 1;
    if (p < 0.3) {
      g.fillStyle = 'rgba(200,220,240,0.12)'; g.fillRect(W * 0.08, H * 0.12, W * 0.84, H * 0.76);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = M * 0.003; g.strokeRect(W * 0.08, H * 0.12, W * 0.84, H * 0.76);
      for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(W * (0.2 + i * 0.15), H * 0.15); g.lineTo(W * (0.05 + i * 0.15), H * 0.45); g.stroke(); }
      return;
    }
    for (let i = 0; i < 60; i++) {
      const x0 = W * (0.1 + rnd(i) * 0.8), y0 = H * (0.14 + rnd(i + 1) * 0.72), dx = x0 - W / 2, dy = y0 - H * 0.5, s = M * (0.03 + rnd(i + 2) * 0.05);
      const x = x0 + dx * k * 1.5 * (0.4 + rnd(i + 3)), y = y0 + dy * k * 1.5 * (0.4 + rnd(i + 4)) + k * k * H * 0.2, rot = k * (rnd(i + 5) - 0.5) * 6;
      g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha = 1 - k * 0.7;
      g.fillStyle = 'rgba(210,230,250,0.28)'; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = M * 0.002;
      g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.8, s * 0.6); g.lineTo(-s * 0.7, s * 0.4); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
    g.globalAlpha = 1;
  },
  'neon-tunnel'(f) {
    const { g, W, H, M, t, cw } = f, cx = W / 2, cy = H * 0.45;
    radial(f, '#2a0050', '#08000f', 0.5, 0.45, 0.8);
    let near = '#ff2fd1';
    for (let i = 0; i < 14; i++) {
      const d = frac(i / 14 - t * 0.3), s = 0.15 / (1 - d * 0.97), col = i % 2 ? '#00e5ff' : '#ff2fd1';
      if (d > 0.85) near = col;
      g.save(); g.strokeStyle = col; g.globalAlpha = clamp(d * 3) * clamp((1 - d) * 8); g.lineWidth = M * 0.006 * s * 3; g.shadowColor = col; g.shadowBlur = M * 0.04;
      g.beginPath(); g.roundRect(cx - W * 0.5 * s, cy - H * 0.4 * s, W * s, H * 0.8 * s, M * 0.05 * s); g.stroke(); g.restore();
    }
    glow(g, cx, H * 0.86, cw * 0.6, near === '#00e5ff' ? 'rgba(0,229,255,0.35)' : 'rgba(255,47,209,0.35)');
    drawCarFront(g, cx, H * 0.88, cw * 0.62, { paint: '#22223a', lights: 1 });
  },
  'light-painting'(f) {
    const { g, W, H, M, p, cw } = f, gy = H * 0.66, bx = lerp(-0.15, 1.15, p) * W, w = cw * 0.92;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    drawCar(g, W / 2, gy, w, { paint: '#3a3e47', shine: clamp((bx - (W / 2 - w / 2)) / w), lights: 0.2 });
    const m = g.createLinearGradient(bx - W * 0.35, 0, bx + W * 0.35, 0);
    m.addColorStop(0, 'rgba(0,0,0,0.94)'); m.addColorStop(0.5, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,0.94)');
    g.fillStyle = m; g.fillRect(0, 0, W, H);
    g.save(); g.shadowColor = '#fff'; g.shadowBlur = M * 0.06; g.fillStyle = '#fff'; g.fillRect(bx - M * 0.004, H * 0.08, M * 0.008, H * 0.84); g.restore();
  },
  'headlight-reveal'(f) {
    const { g, W, H, M, t, p, cw } = f, gy = H * 0.72, w = cw * 0.66;
    const on = p > 0.2 ? (p < 0.26 ? (rnd(Math.floor(t * 30)) > 0.4 ? 1 : 0) : 1) : 0;
    const ceil = [0, 1, 2].map((i) => (p > 0.5 + i * 0.08 ? (p < 0.54 + i * 0.08 ? (rnd(Math.floor(t * 25) + i) > 0.5 ? 1 : 0) : 1) : 0));
    const amb = 0.04 + ceil.reduce<number>((a, b) => a + b, 0) * 0.22;
    radial(f, '#3a3d44', '#0b0b0c', 0.5, 0.2, 0.9);
    drawCarFront(g, W / 2, gy, w, { paint: '#9aa1ab', lights: on });
    floorFade(f, gy, 'rgba(15,15,16,');
    g.fillStyle = `rgba(0,0,0,${1 - amb})`; g.fillRect(0, 0, W, H);
    if (on) {
      g.globalCompositeOperation = 'lighter';
      for (const s of [-1, 1]) {
        const x = W / 2 + s * 0.34 * w, y = gy - 0.25 * w, gr = g.createLinearGradient(0, y, 0, H);
        gr.addColorStop(0, 'rgba(255,250,230,0.45)'); gr.addColorStop(1, 'rgba(255,250,230,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(x - M * 0.02, y); g.lineTo(x + M * 0.02, y); g.lineTo(x + s * W * 0.4 + W * 0.15, H); g.lineTo(x + s * W * 0.4 - W * 0.15, H); g.fill();
        glow(g, x, y, M * 0.12, 'rgba(255,250,230,0.9)');
      }
      g.globalCompositeOperation = 'source-over';
    }
    ceil.forEach((c, i) => { if (c) { g.fillStyle = '#f5f7fa'; g.fillRect(W * (0.15 + i * 0.25), H * 0.05, W * 0.2, H * 0.008); glow(g, W * (0.25 + i * 0.25), H * 0.06, M * 0.2, 'rgba(255,255,255,0.4)'); } });
    for (let i = 0; i < 6; i++) glow(g, W * frac(rnd(i) + t * 0.02), gy - H * 0.15 * rnd(i + 1), M * 0.3, 'rgba(200,205,215,0.12)', 0.5 + amb);
  },
  'cyber-rain'(f) {
    const { g, W, H, M, t, p, cw } = f, gy = H * 0.66, neon = ['#ff2fd1', '#00e5ff', '#ffd400'];
    vgrad(f, [[0, '#07101c'], [0.65, '#0c2233'], [0.66, '#05090e'], [1, '#020406']]);
    for (let i = 0; i < 8; i++) {
      const left = i < 4, bw = W * (0.1 + rnd(i) * 0.08), x = left ? W * 0.11 * i - W * 0.05 : W - W * 0.11 * (i - 4) - bw + W * 0.05, top = H * (0.05 + rnd(i + 3) * 0.3);
      g.fillStyle = '#0a1724'; g.fillRect(x, top, bw, gy - top);
      for (let j = 0; j < 14; j++) { const on = rnd(i * 31 + j + Math.floor(t * 2)) > 0.35; g.fillStyle = on ? neon[(i + j) % 3] : '#0f2030'; g.globalAlpha = on ? 0.7 : 1; g.fillRect(x + bw * 0.15 + (j % 2) * bw * 0.4, top + H * 0.02 + Math.floor(j / 2) * H * 0.045, bw * 0.25, H * 0.02); }
      g.globalAlpha = 1;
      g.save(); g.shadowColor = neon[i % 3]; g.shadowBlur = M * 0.04; g.fillStyle = neon[i % 3]; g.fillRect(left ? x + bw : x - M * 0.012, top + H * 0.08, M * 0.012, H * 0.18); g.restore();
      g.globalAlpha = 0.25; g.fillStyle = neon[i % 3]; g.fillRect(x + bw * 0.4, gy, bw * 0.2, (H - gy) * 0.8); g.globalAlpha = 1;
    }
    drawCarFront(g, W / 2, lerp(gy + H * 0.08, gy + H * 0.14, p), cw * lerp(0.55, 0.66, p), { paint: '#1c2b3a', lights: 1 });
    g.strokeStyle = 'rgba(170,210,255,0.35)'; g.lineWidth = M * 0.002;
    for (let i = 0; i < 160; i++) { const x = frac(rnd(i) + t * 0.05) * W, y = frac(rnd(i + 5) + t * 2.2) * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x - M * 0.006, y + M * 0.04); g.stroke(); }
  },
  'snow-drift'(f) {
    const { g, W, H, M, t, p, cw } = f, gy = H * 0.66, cx = W * 0.55;
    vgrad(f, [[0, '#a9c4dd'], [0.64, '#e7f0f7'], [0.66, '#f4f8fb'], [1, '#d6e3ee']]);
    glow(g, W * 0.85, H * 0.15, M * 0.5, 'rgba(255,250,235,0.9)');
    g.save(); g.translate(cx, gy); g.rotate(0.05 + Math.sin(p * TAU) * 0.03); drawCar(g, 0, 0, cw * 0.82, { spin: -t * 30, paint: '#15181e', shine: 0.7, lights: 1 }); g.restore();
    for (let i = 0; i < 160; i++) {
      const a = frac(p * 1.4 + rnd(i)), vx = -(0.3 + 0.7 * rnd(i + 1)) * W * 0.7, vy = -(0.4 + 0.6 * rnd(i + 2)) * H * 0.55;
      const x = cx - 0.32 * cw + vx * a, y = gy + vy * a + H * 0.6 * a * a;
      g.fillStyle = `rgba(255,255,255,${(1 - a) * 0.95})`; g.strokeStyle = `rgba(150,180,210,${(1 - a) * 0.5})`; g.lineWidth = M * 0.001;
      g.beginPath(); g.arc(x, y, M * (0.003 + rnd(i + 3) * 0.008), 0, TAU); g.fill(); g.stroke();
    }
  },
  'desert-dust'(f) {
    const { g, W, H, M, t, p, cw } = f, gy = H * 0.68, cx = W * 0.6;
    vgrad(f, [[0, '#3b1f4a'], [0.45, '#e2795a'], [0.66, '#ffd59a'], [0.68, '#e8c7a0'], [1, '#a77e52']]);
    g.fillStyle = '#ffe9b8'; g.beginPath(); g.arc(W * 0.3, gy - H * 0.02, M * 0.09, 0, TAU); g.fill();
    glow(g, W * 0.3, gy, M * 0.6, 'rgba(255,200,120,0.55)');
    g.fillStyle = 'rgba(110,60,90,0.55)'; g.beginPath(); g.moveTo(0, gy); for (let x = 0; x <= W; x += W / 12) g.lineTo(x, gy - H * 0.05 * (0.4 + rnd(x / W * 12))); g.lineTo(W, gy); g.fill();
    for (let i = 0; i < 50; i++) { const a = frac(p * 2 + i / 50); glow(g, cx - 0.35 * cw * 0.6 - a * W * 0.7, gy - a * H * 0.12 * (0.5 + rnd(i)), M * (0.04 + a * 0.18), 'rgba(235,190,130,0.8)', (1 - a) * 0.5); }
    drawCar(g, cx, gy + Math.sin(t * 30) * M * 0.002, cw * 0.6, { spin: -t * 30, paint: '#e04a1f', shine: 0.2, lights: 0.8 });
  },
  'coastal-road'(f) {
    const { g, W, H, M, t, p, cw } = f, hz = H * 0.42, gy = H * 0.78;
    vgrad(f, [[0, '#f6c88a'], [0.42, '#ffdca0'], [0.421, '#1b6b8f'], [0.7, '#0d3b5c'], [0.72, '#3d3a36'], [1, '#22201e']]);
    g.fillStyle = '#fff1c9'; g.beginPath(); g.arc(W * 0.72, hz, M * 0.07, Math.PI, 0); g.fill();
    glow(g, W * 0.72, hz, M * 0.45, 'rgba(255,220,150,0.5)');
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = M * 0.003;
    for (let i = 0; i < 26; i++) { const y = hz + (H * 0.28) * rnd(i), x = frac(rnd(i + 1) + t * 0.05 * (1 + y / H)) * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + W * 0.08 * (y / H), y); g.stroke(); }
    g.fillStyle = '#2a2622'; g.beginPath(); g.moveTo(0, hz); g.lineTo(W * 0.18, hz + H * 0.05); g.lineTo(W * 0.1, H * 0.72); g.lineTo(0, H * 0.72); g.fill();
    g.fillStyle = '#e8e2d2'; for (let i = 0; i < 6; i++) g.fillRect(frac(i / 6 - t * 0.4) * W * 1.3 - W * 0.15, H * 0.86, W * 0.08, H * 0.008);
    drawCar(g, lerp(-0.15, 1.15, p) * W, gy, cw * 0.55, { spin: t * 30, paint: '#f2f2f0', shine: 0.8, lights: 0.8 });
  },
  'water-splash'(f) {
    const { g, W, H, M, p, cw } = f, gy = H * 0.66, w = cw * 1.1, cx = W * 0.38, ox = cx + 0.31 * w, k = clamp(p * 1.2);
    vgrad(f, [[0, '#14222c'], [0.65, '#2b3c48'], [0.66, '#0b141a'], [1, '#05090c']]);
    for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(160,190,210,${0.05 + rnd(i) * 0.08})`; g.fillRect(W * rnd(i + 1), gy, W * 0.03, (H - gy) * rnd(i + 2)); }
    drawCar(g, cx, gy, w, { spin: -p * 6, paint: '#1d2a33', lights: 1, shine: 0.6 });
    g.fillStyle = `rgba(210,230,245,${0.35 * (1 - k)})`; g.beginPath(); g.ellipse(ox, gy, M * 0.2 * (0.4 + k), M * 0.12 * (0.4 + k), 0, Math.PI, 0); g.fill();
    for (let i = 0; i < 180; i++) {
      const a = -Math.PI * (0.1 + 0.8 * rnd(i)), v = M * (0.4 + 0.8 * rnd(i + 1));
      const x = ox + Math.cos(a) * v * k, y = gy + Math.sin(a) * v * k + M * 0.9 * k * k;
      if (y > gy + M * 0.02) continue;
      g.fillStyle = `rgba(225,240,250,${(1 - k) * 0.9})`; g.beginPath(); g.arc(x, y, M * (0.003 + rnd(i + 2) * 0.008), 0, TAU); g.fill();
    }
  },
  'exploded-view'(f) {
    const { g, W, H, p, cw } = f, gy = H * 0.66, e = ease(clamp(pingpong(p) * 1.4 - 0.2));
    radial(f, '#3a414d', '#0b0d11', 0.5, 0.35, 0.8);
    g.strokeStyle = 'rgba(160,180,200,0.12)'; g.lineWidth = 1;
    for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(0, gy + i * i * 3); g.lineTo(W, gy + i * i * 3); g.stroke(); }
    const car = () => drawCar(g, W / 2, gy - e * cw * 0.05, cw * 0.82, { explode: e, sx: Math.cos(Math.sin(p * TAU) * 0.45), paint: '#9fb4c7', lights: 0.5 });
    reflect(f, gy, car); car();
  },
  'wireframe-build'(f) {
    const { g, W, H, M, t, p, cw } = f, gy = H * 0.66, w = cw * 0.85, sx = lerp(W / 2 - w * 0.55, W / 2 + w * 0.55, clamp(p * 1.3));
    g.fillStyle = '#020814'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(22,195,246,0.18)'; g.lineWidth = 1;
    for (let i = -10; i <= 10; i++) { g.beginPath(); g.moveTo(W / 2 + i * W * 0.04, gy); g.lineTo(W / 2 + i * W * 0.2, H); g.stroke(); }
    for (let i = 0; i < 8; i++) { const y = gy + (H - gy) * (i / 8) ** 1.6; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    glow(g, W / 2, gy, w * 0.6, 'rgba(22,195,246,0.3)');
    g.globalAlpha = 0.75 + 0.25 * Math.sin(t * 20); drawCar(g, W / 2, gy, w, { wire: '#16c3f6' }); g.globalAlpha = 1;
    g.save(); g.beginPath(); g.rect(0, 0, sx, H); g.clip(); drawCar(g, W / 2, gy, w, { paint: '#d4d9e0', lights: 1, shine: 0.5 }); g.restore();
    g.save(); g.shadowColor = '#16c3f6'; g.shadowBlur = M * 0.05; g.fillStyle = '#9ef0ff'; g.fillRect(sx - 1, gy - w * 0.45, 2.5, w * 0.5); g.restore();
  },
  'liquid-metal'(f) {
    const { g, W, H, M, t, p, cw } = f, gy = H * 0.66, w = cw * 0.85, L = ease(p * 1.35);
    radial(f, '#2a2a30', '#030304', 0.5, 0.3, 0.8);
    g.fillStyle = 'rgba(210,215,222,0.8)'; g.beginPath(); g.ellipse(W / 2, gy, w * 0.55 * (1 - L * 0.6), M * 0.025 * (1 - L * 0.5), 0, 0, TAU); g.fill();
    const car = () => {
      g.save(); g.beginPath(); g.moveTo(0, H);
      const top = gy - L * w * 0.4;
      for (let x = 0; x <= W; x += W / 40) g.lineTo(x, top + Math.sin(x / W * 14 + t * 6) * M * 0.012 * (1 - L * 0.7));
      g.lineTo(W, H); g.clip();
      drawCar(g, W / 2, gy, w, { paint: '#d8dde3', shine: frac(t * 0.6), lights: 0 });
      if (p > 0.75) { g.globalAlpha = clamp((p - 0.75) * 5); drawCar(g, W / 2, gy, w, { paint: '#0b7df2', shine: 0.5, lights: 1 }); }
      g.restore();
    };
    reflect(f, gy, car); car();
  },
  'color-shift'(f) {
    const { g, W, H, M, p, cw } = f, gy = H * 0.66, w = cw * 0.88, x0 = W / 2 - w * 0.55, x1 = W / 2 + w * 0.55;
    vgrad(f, [[0, '#fbfbfc'], [0.66, '#e4e6ea'], [1, '#cfd3d9']]);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(W / 2, gy, w * 0.52, M * 0.03, 0, 0, TAU); g.fill();
    const opt = { sx: Math.cos(Math.sin(p * TAU) * 0.35), lights: 0.6, shine: 0.5 };
    drawCar(g, W / 2, gy, w, { ...opt, paint: '#2a2d33' });
    for (const [k, paint] of [[clamp(p * 2.2), '#1539e1'], [clamp(p * 2.2 - 1.1), '#d7263d']] as const) {
      if (k <= 0) continue;
      const x = lerp(x0, x1, k);
      g.save(); g.beginPath(); g.rect(0, 0, x, H); g.clip(); drawCar(g, W / 2, gy, w, { ...opt, paint }); g.restore();
      if (k < 1) { g.save(); clipCar(g, W / 2, gy, w); glow(g, x, gy - w * 0.15, w * 0.12, 'rgba(255,255,255,0.8)'); g.restore(); }
    }
  },
  'snow-foam'(f) {
    const { g, W, H, M, t, p, cw } = f, gy = H * 0.66, w = cw * 0.88, c = ease(p * 2.6), r = clamp((p - 0.55) / 0.38);
    vgrad(f, [[0, '#0b1c3d'], [0.66, '#081530'], [1, '#030a18']]);
    for (let i = 0; i < 4; i++) { g.fillStyle = '#8fd0ff'; g.fillRect(W * (0.08 + i * 0.24), H * 0.05, W * 0.16, H * 0.007); }
    const rx = lerp(W / 2 + w * 0.55, W / 2 - w * 0.55, r);
    drawCar(g, W / 2, gy, w, { paint: '#101318', lights: 0.4, shine: r > 0 ? clamp((rx - (W / 2 - w / 2)) / w) : undefined });
    g.save(); clipCar(g, W / 2, gy, w); g.beginPath(); g.rect(0, 0, r > 0 ? rx : W, H); g.clip();
    for (let i = 0; i < 140; i++) {
      if (rnd(i + 9) > c) continue;
      const x = W / 2 + (rnd(i) - 0.5) * w, y = gy - w * (0.05 + rnd(i + 1) * 0.3) + p * M * 0.04 * rnd(i + 2);
      g.fillStyle = `rgba(250,252,255,${0.85 + rnd(i + 3) * 0.15})`; g.beginPath(); g.arc(x, y, w * (0.03 + rnd(i + 4) * 0.035), 0, TAU); g.fill();
    }
    g.restore();
    if (r > 0 && r < 1) {
      g.strokeStyle = 'rgba(200,230,255,0.5)'; g.lineWidth = M * 0.002;
      for (let i = 0; i < 14; i++) { g.beginPath(); g.moveTo(W * 0.95, H * 0.12); g.lineTo(rx + (rnd(i + Math.floor(t * 20)) - 0.5) * M * 0.05, gy - w * (0.1 + 0.2 * rnd(i))); g.stroke(); }
    }
  },
  'ceramic-beading'(f) {
    const { g, W, H, M, t, p } = f;
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0b7df2'); bg.addColorStop(0.55, '#06306e'); bg.addColorStop(1, '#020c22');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W * (0.3 + 0.1 * Math.sin(t * 0.5)), 0); g.rotate(0.35);
    const band = g.createLinearGradient(-W * 0.12, 0, W * 0.12, 0); band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.5, 'rgba(255,255,255,0.28)'); band.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = band; g.fillRect(-W * 0.12, -H, W * 0.24, H * 3); g.restore();
    const roll = ease(clamp((p - 0.25) * 2));
    for (let i = 0; i < 70; i++) {
      const r = M * (0.012 + rnd(i) * 0.035), sp = 0.4 + rnd(i + 1);
      const x = W * rnd(i + 2) + roll * Math.sin(i) * M * 0.02, y = frac(rnd(i + 3) + roll * sp * 0.6 + p * 0.03) * (H + r * 4) - r * 2;
      const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.7, 'rgba(10,40,90,0.25)'); gr.addColorStop(1, 'rgba(0,10,30,0.55)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(x - r * 0.35, y - r * 0.4, r * 0.18, 0, TAU); g.fill();
    }
  },
  'polish-5050'(f) {
    const { g, W, H, M, t, p } = f, bx = W * lerp(0.12, 0.88, ease(p)), lx = W * 0.5, ly = H * 0.32;
    vgrad(f, [[0, '#2f3033'], [1, '#18191b']]);
    g.save(); g.beginPath(); g.rect(bx, 0, W - bx, H); g.clip();
    glow(g, lx, ly, M * 0.35, 'rgba(255,255,255,0.35)');
    g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 1;
    for (let i = 0; i < 70; i++) { const r = M * (0.05 + rnd(i) * 0.45), a = rnd(i + 1) * TAU; g.beginPath(); g.arc(lx, ly, r, a, a + 0.3 + rnd(i + 2) * 0.6); g.stroke(); }
    g.restore();
    g.save(); g.beginPath(); g.rect(0, 0, bx, H); g.clip();
    g.fillStyle = '#121214'; g.fillRect(0, 0, bx, H);
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(lx, ly, M * 0.13, M * 0.035, 0, 0, TAU); g.fill();
    glow(g, lx, ly, M * 0.2, 'rgba(255,255,255,0.3)');
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(bx - 0.5, 0, 1, H);
    const py = H * 0.62 + Math.sin(t * 5) * H * 0.12;
    g.fillStyle = '#e46b1f'; g.beginPath(); g.arc(bx, py, M * 0.15, 0, TAU); g.fill();
    g.fillStyle = '#1c1c1e'; g.beginPath(); g.arc(bx, py, M * 0.11, 0, TAU); g.fill();
    g.strokeStyle = '#4a4a4f'; g.lineWidth = M * 0.006;
    for (let k = 0; k < 3; k++) { const a = t * 18 + (k * TAU) / 3; g.beginPath(); g.moveTo(bx, py); g.lineTo(bx + Math.cos(a) * M * 0.1, py + Math.sin(a) * M * 0.1); g.stroke(); }
  },
};

export function drawMotion(g: G, id: string, W: number, H: number, t: number) {
  const M = Math.min(W, H);
  const f: F = { g, W, H, M, t, p: frac(t / LOOP), cw: Math.min(W * 0.84, H * 1.1) };
  g.save();
  (FX[id] || FX['orbit-360'])(f);
  g.restore();
}

// ---------------------------------------------------------------- one shared animation loop for every preview canvas
interface Item { c: HTMLCanvasElement; id: string; offset: number; visible: boolean }
const live = new Set<Item>();
let raf = 0, last = 0;
const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function paint(it: Item, t: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(it.c.clientWidth * dpr), h = Math.round(it.c.clientHeight * dpr);
  if (!w || !h) return;
  if (it.c.width !== w || it.c.height !== h) { it.c.width = w; it.c.height = h; }
  const g = it.c.getContext('2d'); if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawMotion(g, it.id, w, h, still ? 2.4 : t + it.offset);
}
function loop(now: number) {
  raf = live.size ? requestAnimationFrame(loop) : 0;
  if (now - last < 33) return; // ~30 fps is plenty for previews
  last = now;
  for (const it of live) if (it.visible) paint(it, now / 1000);
}

/** Animate `c` with template `id` while it is on screen. Returns a cleanup function. */
export function mountMotion(c: HTMLCanvasElement, id: string) {
  const it: Item = { c, id, offset: [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % LOOP, visible: false };
  const io = new IntersectionObserver(([e]) => { it.visible = e.isIntersecting; if (still && it.visible) paint(it, 0); });
  io.observe(c);
  live.add(it);
  if (!raf && !still) raf = requestAnimationFrame(loop);
  return () => { io.disconnect(); live.delete(it); };
}

/** Record one loop of a preview to a video file (WebM/MP4, whatever the browser's MediaRecorder offers). */
export async function recordMotion(id: string, aspect: string): Promise<Blob> {
  const [w, h] = aspect === '16:9' ? [1280, 720] : aspect === '1:1' ? [960, 960] : [720, 1280];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime || undefined, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  drawMotion(g, id, w, h, 0);
  rec.start();
  const t0 = performance.now();
  await new Promise<void>((res) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      drawMotion(g, id, w, h, Math.min(t, LOOP));
      if (t >= LOOP) return res();
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await done;
  return new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
}
