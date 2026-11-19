// Làng 3D của Ma Sói: mỗi người là một nhân vật đi lại tự do quanh làng (cần gạt trên điện thoại, WASD hoặc phím mũi
// tên trên máy tính). Vị trí gửi qua WebSocket tới Durable Object của phòng (server/boardgame-live.ts) khoảng 10 lần
// một giây; máy khác nội suy cho mượt. Bot đi lang thang theo quỹ đạo tính từ mã của bot nên máy nào cũng thấy giống
// nhau mà không cần gửi. Ban đêm trời tối, ai về nhà nấy và đứng yên; người chết thành bóng ma mờ.
// Trang game (index.html) gọi window.Village.enter / sync / leave; luật chơi vẫn nằm ở trang game.
import * as THREE from 'three';

const RADIUS = 26; // đi được trong vòng này
const HOME_R = 17; // nhà xếp vòng quanh đống lửa
const SPEED = 4.2; // đơn vị mỗi giây
const SEND_MS = 100;

let renderer, scene, camera, clock, sun, hemi, fire, fireLight, ground;
let canvas, stick, knob;
let room = null;
let me = null;
let ws = null;
let wsRetry = 0;
let wsTimer = null;
let night = false;
let frame = 0;
let lastSent = 0;
let lastSentPos = '';
let aim = 0; // camera nhìn lệch về phía trước bao nhiêu (bảng game mở thì lệch để nhân vật không bị che)
const people = new Map(); // id -> { group, body, label, badge, target, seat, bot, alive, name, color, votes }
const houses = [];
const solids = []; // [x, z, bán kính] chặn đường
const keys = new Set();
const pad = { x: 0, y: 0 };

/* ---------- Dựng làng ---------- */

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7);

function buildWorld() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9fd8ff, 30, 70);
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  hemi = new THREE.HemisphereLight(0xdff3ff, 0x4a6b3a, 1.1);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff2d6, 1.2);
  sun.position.set(-20, 30, 10);
  scene.add(sun);

  ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), mat(0x6fae5a));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  // Quảng trường đất quanh đống lửa và con đường vòng
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(7, 32), mat(0xc9a46b));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.01;
  scene.add(plaza);
  const road = new THREE.Mesh(new THREE.RingGeometry(HOME_R - 4.2, HOME_R - 2.6, 48), mat(0xc9a46b));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  scene.add(road);

  // Đống lửa
  fire = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 6), mat(0x6b3f1d));
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (k * Math.PI) / 4;
    log.position.y = 0.15;
    fire.add(log);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 7), new THREE.MeshBasicMaterial({ color: 0xffa23a }));
  flame.position.y = 0.85;
  flame.name = 'flame';
  fire.add(flame);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0xfff1a0 }));
  core.position.y = 0.6;
  fire.add(core);
  for (let k = 0; k < 10; k++) {
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28), mat(0x8a8a90));
    stone.position.set(Math.cos((k / 10) * Math.PI * 2) * 1.05, 0.12, Math.sin((k / 10) * Math.PI * 2) * 1.05);
    fire.add(stone);
  }
  fireLight = new THREE.PointLight(0xff8a3a, 2, 18, 1.6);
  fireLight.position.y = 1.5;
  fire.add(fireLight);
  scene.add(fire);
  solids.push([0, 0, 1.4]);

  // Nhà: đủ cho 20 người, xếp vòng quanh làng
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    const house = new THREE.Group();
    const wall = [0xf3e3c3, 0xe9d2a8, 0xf0dccf, 0xd9c8a6][k % 4];
    const roof = [0xb9562e, 0x8a3a2a, 0x9a6a2a, 0x6a4a8a][k % 4];
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2, 2.4), mat(wall));
    base.position.y = 1;
    house.add(base);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.5, 4), mat(roof));
    top.position.y = 2.75;
    top.rotation.y = Math.PI / 4;
    house.add(top);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.05), mat(0x5a3418));
    door.position.set(0, 0.6, 1.22);
    house.add(door);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), new THREE.MeshBasicMaterial({ color: 0x3a4a6a }));
    win.position.set(0.8, 1.3, 1.22);
    win.name = 'window';
    house.add(win);
    house.position.set(Math.cos(a) * HOME_R, 0, Math.sin(a) * HOME_R);
    house.lookAt(0, 0, 0);
    scene.add(house);
    houses.push(house);
    solids.push([house.position.x, house.position.z, 1.8]);
  }

  // Cây ngoài vòng nhà
  for (let k = 0; k < 46; k++) {
    const a = (k / 46) * Math.PI * 2 + (hash(String(k)) % 100) / 300;
    const r = 23 + (hash('r' + k) % 70) / 10;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.2, 6), mat(0x6b4a2a));
    trunk.position.y = 0.6;
    tree.add(trunk);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 7), mat(k % 3 ? 0x2f7a3e : 0x3b8f4a));
    leaves.position.y = 2.3;
    tree.add(leaves);
    tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    const s = 0.8 + (hash('s' + k) % 50) / 100;
    tree.scale.set(s, s, s);
    scene.add(tree);
  }
}

// Cửa nhà của ghế seat: ban đêm mỗi người về đây
function homeSpot(seat) {
  const house = houses[seat % houses.length];
  const p = house.position.clone().multiplyScalar((HOME_R - 2) / HOME_R);
  return { x: p.x, z: p.z, r: Math.atan2(-p.x, -p.z) };
}

// Chỗ đứng quanh đống lửa khi mới vào
function fireSpot(seat, total) {
  const a = (seat / Math.max(total, 1)) * Math.PI * 2;
  return { x: Math.cos(a) * 4.5, z: Math.sin(a) * 4.5, r: Math.atan2(-Math.cos(a), -Math.sin(a)) };
}

/* ---------- Nhân vật ---------- */

function textSprite(text, { bg = 'rgba(7,20,66,.78)', color = '#fff', size = 34 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `700 ${size}px "Be Vietnam Pro", system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  c.width = w;
  c.height = size + 20;
  ctx.font = `700 ${size}px "Be Vietnam Pro", system-ui, sans-serif`;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, c.height, c.height / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((w / c.height) * 0.45, 0.45, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function makePerson(p) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const color = new THREE.Color(p.color);
  const cloth = mat(color);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 10), cloth);
  torso.position.y = 0.72;
  body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), mat(0xf2c9a0));
  head.position.y = 1.42;
  body.add(head);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.42, 10), mat(color.clone().multiplyScalar(0.6)));
  hat.position.y = 1.78;
  body.add(hat);
  for (const dx of [-0.11, 0.11]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
    eye.position.set(dx, 1.46, 0.27);
    body.add(eye);
  }
  for (const dx of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.45, 6), mat(0x3a2a1a));
    leg.position.set(dx, 0.22, 0);
    leg.name = 'leg';
    body.add(leg);
  }
  group.add(body);
  const label = textSprite(p.name, p.isMe ? { bg: 'rgba(255,216,77,.92)', color: '#0b1e63' } : {});
  label.position.y = 2.35;
  group.add(label);
  scene.add(group);
  return { group, body, label, badge: null, name: p.name, isMe: p.isMe };
}

function setGhost(person, ghost) {
  person.body.traverse((o) => {
    if (!o.material) return;
    o.material.transparent = ghost;
    o.material.opacity = ghost ? 0.35 : 1;
    o.material.depthWrite = !ghost;
  });
}

function setBadge(person, votes) {
  if (person.votes === votes) return;
  person.votes = votes;
  if (person.badge) person.group.remove(person.badge);
  person.badge = votes ? textSprite(`${votes} phiếu`, { bg: 'rgba(255,107,122,.95)', size: 30 }) : null;
  if (person.badge) {
    person.badge.position.y = 2.9;
    person.group.add(person.badge);
  }
}

/* ---------- Điều khiển ---------- */

function buildControls() {
  stick = document.createElement('div');
  stick.className = 'v-stick';
  stick.setAttribute('aria-label', 'Cần gạt di chuyển');
  knob = document.createElement('div');
  knob.className = 'v-knob';
  stick.append(knob);
  document.body.append(stick);
  let id = null;
  const move = (e) => {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    pad.x = dx / max;
    pad.y = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const end = () => {
    id = null;
    pad.x = pad.y = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    stick.setPointerCapture(id);
    move(e);
  });
  stick.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea')) return;
    keys.add(e.key.toLowerCase());
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
}

function input() {
  let x = pad.x;
  let y = pad.y;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  const len = Math.hypot(x, y);
  return len > 1 ? { x: x / len, y: y / len } : { x, y };
}

// Đi tới (x, z) nhưng không xuyên qua nhà, đống lửa hay ra khỏi làng
function walkable(x, z) {
  const r = Math.hypot(x, z);
  if (r > RADIUS) {
    x = (x / r) * RADIUS;
    z = (z / r) * RADIUS;
  }
  for (const [sx, sz, sr] of solids) {
    const dx = x - sx;
    const dz = z - sz;
    const d = Math.hypot(dx, dz);
    if (d < sr + 0.35) {
      const k = (sr + 0.35) / (d || 1);
      x = sx + dx * k;
      z = sz + dz * k;
    }
  }
  return { x, z };
}

/* ---------- Kết nối ---------- */

function connect() {
  if (!room) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/boardgame/rooms/${room}/live?pid=${encodeURIComponent(me)}`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    wsRetry = 0;
    lastSentPos = '';
  };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'all') m.spots.forEach(place);
    if (m.type === 'pos') place(m);
  };
  ws.onclose = () => {
    ws = null;
    if (!room) return;
    // Mất kết nối thì thử lại, lâu dần (tối đa 10 giây); máy chủ cục bộ không có phòng 3D thì cứ chơi một mình
    wsTimer = setTimeout(connect, Math.min(10000, 1000 * 2 ** wsRetry++));
  };
}

// Người khác vừa gửi vị trí
const seen = new Map(); // id -> { x, z, r } mới nhất, kể cả khi chưa có nhân vật
function place(s) {
  if (s.id === me) return;
  seen.set(s.id, { x: s.x, z: s.z, r: s.r });
  const p = people.get(s.id);
  if (p && !night) p.target = { x: s.x, z: s.z, r: s.r };
}

function send(pos) {
  const now = performance.now();
  const key = `${pos.x.toFixed(2)},${pos.z.toFixed(2)},${pos.r.toFixed(2)}`;
  // Gửi khi có thay đổi (tối đa 10 lần một giây), và nhắc lại mỗi 3 giây cho người mới vào
  if (now - lastSent < SEND_MS || (key === lastSentPos && now - lastSent < 3000)) return;
  if (ws?.readyState !== 1) return;
  lastSent = now;
  lastSentPos = key;
  ws.send(JSON.stringify({ type: 'pos', x: pos.x, z: pos.z, r: pos.r }));
}

/* ---------- Vòng lặp ---------- */

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function tick() {
  frame = requestAnimationFrame(tick);
  if (document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  const mine = people.get(me);
  if (mine) {
    const { x, y } = night || !mine.alive ? { x: 0, y: 0 } : input();
    const moving = x || y;
    if (moving) {
      const next = walkable(mine.group.position.x + x * SPEED * dt, mine.group.position.z + y * SPEED * dt);
      mine.group.position.x = next.x;
      mine.group.position.z = next.z;
      mine.group.rotation.y = Math.atan2(x, y);
    }
    if (!night) send({ x: mine.group.position.x, z: mine.group.position.z, r: mine.group.rotation.y });
    animateWalk(mine, moving, t);
    // Camera nhìn chéo từ phía sau, đi theo nhân vật của mình. Khi bảng game đang mở (che nửa dưới màn hình),
    // camera nhìn lệch về phía trước để nhân vật nằm ở nửa trên còn thấy được.
    const p = mine.group.position;
    const sheetOpen = !document.body.classList.contains('sheet-min');
    aim += ((sheetOpen ? 4.5 : 0) - aim) * (1 - Math.exp(-dt * 4));
    camera.position.lerp(new THREE.Vector3(p.x, p.y + 9, p.z + 10.5 + aim), 1 - Math.exp(-dt * 5));
    camera.lookAt(p.x, p.y + 1, p.z + aim);
    fadeHouses(p);
  } else {
    // Người chỉ xem (chưa có ghế): nhìn toàn cảnh làng từ trên cao
    camera.position.set(0, 18, 24);
    camera.lookAt(0, 0, 0);
  }
  for (const [id, p] of people) {
    if (id === me) continue;
    let target = p.target;
    if (p.bot && !night) target = botSpot(id, p.seat, t);
    if (!target) continue;
    const pos = p.group.position;
    const k = 1 - Math.exp(-dt * 8);
    const moving = Math.hypot(target.x - pos.x, target.z - pos.z) > 0.05;
    pos.x += (target.x - pos.x) * k;
    pos.z += (target.z - pos.z) * k;
    p.group.rotation.y += angleDiff(p.group.rotation.y, target.r) * k;
    animateWalk(p, moving, t);
  }
  // Lửa bập bùng
  const flame = fire.getObjectByName('flame');
  flame.scale.y = 1 + Math.sin(t * 9) * 0.12 + Math.sin(t * 23) * 0.05;
  fireLight.intensity = (night ? 4 : 1.5) + Math.sin(t * 13) * 0.4;
  renderer.render(scene, camera);
}

const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// Nhà đứng giữa camera và nhân vật của mình (phía trước, gần) thì mờ đi để không che
function fadeHouses(p) {
  for (const house of houses) {
    const dx = house.position.x - p.x;
    const dz = house.position.z - p.z;
    const block = dz > -0.5 && dz < 12 && Math.abs(dx) < 3.2;
    if (house.userData.faded === block) continue;
    house.userData.faded = block;
    house.traverse((o) => {
      if (!o.material) return;
      o.material.transparent = block;
      o.material.opacity = block ? 0.25 : 1;
      o.material.depthWrite = !block;
    });
  }
}

function animateWalk(p, moving, t) {
  p.body.position.y = p.alive === false ? 0.3 + Math.sin(t * 2) * 0.12 : moving ? Math.abs(Math.sin(t * 12)) * 0.08 : 0;
  p.body.children.filter((o) => o.name === 'leg').forEach((leg, k) => (leg.rotation.x = moving ? Math.sin(t * 12 + k * Math.PI) * 0.6 : 0));
}

// Bot đi lang thang quanh quảng trường theo quỹ đạo tính từ mã của bot: máy nào cũng như nhau
function botSpot(id, seat, t) {
  const h = hash(id);
  const a = (seat / 8) * Math.PI * 2 + Math.sin(t * 0.07 + h) * 1.4;
  const r = 6 + Math.sin(t * 0.11 + h * 0.3) * 3;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  const ahead = (seat / 8) * Math.PI * 2 + Math.sin((t + 0.3) * 0.07 + h) * 1.4;
  const r2 = 6 + Math.sin((t + 0.3) * 0.11 + h * 0.3) * 3;
  return { x, z, r: Math.atan2(Math.cos(ahead) * r2 - x, Math.sin(ahead) * r2 - z) };
}

function setNight(on) {
  if (night === on) return;
  night = on;
  scene.background = new THREE.Color(on ? 0x0b1030 : 0x9fd8ff);
  scene.fog.color.set(on ? 0x0b1030 : 0x9fd8ff);
  hemi.intensity = on ? 0.18 : 1.1;
  sun.intensity = on ? 0.12 : 1.2;
  sun.color.set(on ? 0x8aa0ff : 0xfff2d6);
  for (const h of houses) h.getObjectByName('window').material.color.set(on ? 0xffd36b : 0x3a4a6a);
  // Ban đêm ai về nhà nấy; trời sáng thì mỗi người đi tiếp từ cửa nhà mình
  for (const [id, p] of people) {
    const home = homeSpot(p.seat);
    if (on) {
      p.target = home;
      if (id === me) Object.assign(p.group.position, { x: home.x, z: home.z }), (p.group.rotation.y = home.r);
    } else if (id === me) {
      p.group.position.set(home.x, 0, home.z);
    }
  }
}

/* ---------- API cho trang game ---------- */

window.Village = {
  // Vào làng của phòng `roomId` với tư cách người chơi `myId` (gọi lại nhiều lần cũng được)
  enter(roomId, myId) {
    if (room === roomId && me === myId) return;
    this.leave();
    room = roomId;
    me = myId;
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      canvas = renderer.domElement;
      canvas.className = 'v-canvas';
      buildWorld();
      clock = new THREE.Clock();
      addEventListener('resize', () => renderer && resize());
    }
    document.body.prepend(canvas);
    if (!stick) buildControls();
    stick.hidden = false;
    document.body.classList.add('in-village');
    night = true;
    setNight(false);
    resize();
    cancelAnimationFrame(frame);
    tick();
    connect();
  },

  // Ra khỏi làng: tắt kết nối, ẩn cảnh (giữ lại để lần sau vào nhanh)
  leave() {
    if (!room) return;
    room = null;
    clearTimeout(wsTimer);
    ws?.close();
    ws = null;
    cancelAnimationFrame(frame);
    canvas?.remove();
    if (stick) stick.hidden = true;
    document.body.classList.remove('in-village');
    for (const p of people.values()) scene.remove(p.group);
    people.clear();
    seen.clear();
  },

  // players: [{ id, name, color, seat, bot, alive, votes, isMe }], night: đang là đêm
  sync({ players, night: isNight }) {
    if (!room) return;
    const ids = new Set(players.map((p) => p.id));
    for (const [id, p] of people) {
      if (!ids.has(id)) {
        scene.remove(p.group);
        people.delete(id);
      }
    }
    players.forEach((p) => {
      let person = people.get(p.id);
      if (!person || person.name !== p.name) {
        if (person) scene.remove(person.group);
        person = makePerson(p);
        const start = seen.get(p.id) || fireSpot(p.seat, players.length);
        person.group.position.set(start.x, 0, start.z);
        person.group.rotation.y = start.r;
        person.target = start;
        people.set(p.id, person);
      }
      person.seat = p.seat;
      person.bot = p.bot;
      if (person.alive !== p.alive) setGhost(person, !p.alive);
      person.alive = p.alive;
      setBadge(person, p.votes || 0);
    });
    setNight(Boolean(isNight));
  },
};
dispatchEvent(new Event('village-ready'));
