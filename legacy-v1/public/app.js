// DMI Studio — editor app
(function () {
  const $ = (s) => document.querySelector(s);
  const R = window.DMIRenderer;
  const music = window.DMIMusic;
  const LS = { project: 'dmi.project', key: 'dmi.apiKey', model: 'dmi.model' };
  const SIZES = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };

  const PRESETS = [
    { bg1: '#0b1020', bg2: '#1d2b64', accent: '#38bdf8', text: '#f1f5f9' },
    { bg1: '#1c120d', bg2: '#4a2c1d', accent: '#f2b880', text: '#fff6ec' },
    { bg1: '#0f0f0f', bg2: '#2a2a2a', accent: '#ff3d71', text: '#ffffff' },
    { bg1: '#f6f1e7', bg2: '#e8dcc6', accent: '#c2410c', text: '#1f1a14' },
    { bg1: '#052e16', bg2: '#14532d', accent: '#a3e635', text: '#f0fdf4' },
    { bg1: '#2e1065', bg2: '#be185d', accent: '#fde047', text: '#ffffff' },
    { bg1: '#0c4a6e', bg2: '#0e7490', accent: '#fcd34d', text: '#f0f9ff' },
    { bg1: '#18181b', bg2: '#3f3f46', accent: '#f97316', text: '#fafafa' },
  ];
  const IDEAS = [
    'Giới thiệu quán cà phê muối ở Huế, ấm áp, kêu gọi ghé thăm cuối tuần',
    'Video TikTok 5 mẹo học tiếng Anh mỗi ngày cho người bận rộn',
    'Ra mắt app quản lý chi tiêu cho sinh viên, phong cách trẻ trung',
    'Chúc mừng sinh nhật công ty 10 năm, cảm ơn khách hàng',
  ];
  const REFINES = ['Ngắn gọn hơn', 'Thêm 1 cảnh số liệu', 'Tông màu ấm hơn', 'Dịch sang tiếng Anh', 'Sôi động hơn'];

  const state = {
    sb: null, aspect: '16:9', sel: 0, time: 0, playing: false,
    undo: [], redo: [], playStart: 0, playOffset: 0, lastSpoken: -1, exporting: false,
  };

  const canvas = $('#stage');
  const ctx = canvas.getContext('2d');

  // ----------------------------------------------------------- helpers
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 6000 : 2500);
  }
  const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const total = () => (state.sb ? R.totalDuration(state.sb) : 0);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function normalize(sb) {
    sb = JSON.parse(JSON.stringify(sb || {}));
    sb.title = sb.title || 'Video mới';
    sb.palette = Object.assign({ bg1: '#0b1020', bg2: '#1d2b64', accent: '#38bdf8', text: '#f1f5f9' }, sb.palette || {});
    sb.font = sb.font || 'sans';
    sb.music = Object.assign({ mood: 'calm', bpm: 96 }, sb.music || {});
    sb.scenes = (sb.scenes || []).map((s) => Object.assign({
      layout: 'title', headline: '', subtext: '', bullets: [], icon: '', caption: '',
      duration: 4, animation: 'fade', background: 'gradient',
    }, s, { duration: Math.min(15, Math.max(1, Number(s.duration) || 4)) }));
    return sb;
  }

  function commit(next, { keepUndo } = {}) {
    if (state.sb && !keepUndo) { state.undo.push(JSON.stringify(state.sb)); if (state.undo.length > 60) state.undo.shift(); state.redo = []; }
    state.sb = normalize(next);
    state.sel = Math.min(state.sel, state.sb.scenes.length - 1);
    save(); renderAll();
  }
  // mutate in place (for typing in inputs) with debounced undo snapshot
  function mutate(fn) {
    if (!mutate._snap) { state.undo.push(JSON.stringify(state.sb)); state.redo = []; }
    clearTimeout(mutate._t); mutate._snap = true; mutate._t = setTimeout(() => (mutate._snap = false), 800);
    fn(state.sb); save(); renderTimeline(); draw();
    if (state.playing) restartMusic();
  }

  function save() {
    try { localStorage.setItem(LS.project, JSON.stringify({ sb: state.sb, aspect: state.aspect })); } catch (e) { /* ignore */ }
  }

  // ----------------------------------------------------------- canvas / drawing
  function setAspect(a) {
    state.aspect = SIZES[a] ? a : '16:9';
    $('#aspect').value = state.aspect;
    const [w, h] = SIZES[state.aspect];
    canvas.width = w * 2 / 3; canvas.height = h * 2 / 3;
    draw();
  }

  function draw() {
    const has = state.sb && state.sb.scenes.length;
    $('#emptyState').hidden = !!has;
    if (!has) return;
    R.renderFrame(ctx, canvas.width, canvas.height, state.sb, state.time, { captions: $('#optCaptions').checked });
    const T = total();
    $('#timeLabel').textContent = `${fmt(state.time)} / ${fmt(T)}`;
    const track = $('#track');
    const x = 8 + (track.clientWidth * state.time) / (T || 1);
    $('#playhead').style.left = x + 'px';
  }

  // ----------------------------------------------------------- playback
  function sceneAt(t) {
    const tl = R.timeline(state.sb); const s = tl.find((x) => t >= x.start && t < x.end); return s ? s.i : tl.length - 1;
  }
  function play() {
    if (!state.sb || !state.sb.scenes.length) return;
    if (state.time >= total() - 0.05) state.time = 0;
    state.playing = true; $('#btnPlay').textContent = '❚❚';
    state.playStart = performance.now(); state.playOffset = state.time; state.lastSpoken = -1;
    restartMusic();
    requestAnimationFrame(tick);
  }
  function pause() {
    state.playing = false; $('#btnPlay').textContent = '▶';
    music.stop(); if (window.speechSynthesis) speechSynthesis.cancel();
  }
  function restartMusic() {
    if (!state.playing) return;
    if ($('#optMusic').checked) music.play(state.sb.music, state.time, total()); else music.stop();
  }
  function tick() {
    if (!state.playing || state.exporting) return;
    state.time = state.playOffset + (performance.now() - state.playStart) / 1000;
    if (state.time >= total()) { state.time = total(); draw(); pause(); return; }
    const i = sceneAt(state.time);
    if (i !== state.sel) { state.sel = i; renderTimeline(); renderInspector(); }
    if ($('#optVoice').checked && i !== state.lastSpoken) { state.lastSpoken = i; speak(state.sb.scenes[i].caption); }
    draw();
    requestAnimationFrame(tick);
  }
  function seek(t) {
    state.time = Math.max(0, Math.min(total(), t));
    const si = sceneAt(state.time);
    if (si !== state.sel) { state.sel = si; renderTimeline(); renderInspector(); }
    if (state.playing) { state.playStart = performance.now(); state.playOffset = state.time; restartMusic(); state.lastSpoken = sceneAt(state.time); }
    draw();
  }
  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const vi = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text);
    u.lang = vi ? 'vi-VN' : 'en-US';
    const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith(vi ? 'vi' : 'en'));
    if (v) u.voice = v;
    u.rate = 1.05; speechSynthesis.speak(u);
  }

  // ----------------------------------------------------------- timeline
  function renderTimeline() {
    const track = $('#track'); track.innerHTML = '';
    if (!state.sb) return;
    const p = state.sb.palette;
    state.sb.scenes.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'clip' + (i === state.sel ? ' sel' : '');
      d.style.flex = `${s.duration} 1 0`;
      d.style.background = `linear-gradient(135deg, ${p.bg1}, ${i % 2 ? p.accent : p.bg2})`;
      d.innerHTML = `<b>${i + 1} · ${s.duration}s</b><span>${esc(s.icon)} ${esc(s.headline)}</span>`;
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        state.sel = i; renderTimeline(); renderInspector();
        seek(R.timeline(state.sb)[i].start + 0.01);
        switchTab('scene');
      });
      track.appendChild(d);
    });
  }
  $('#timeline').addEventListener('pointerdown', (e) => {
    if (!state.sb || e.target.closest('.clip')) return;
    const r = $('#track').getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * total());
  });

  // ----------------------------------------------------------- inspector
  const SEL = {
    layout: [['title', 'Tiêu đề lớn'], ['bullets', 'Danh sách ý'], ['stat', 'Con số nổi bật'], ['quote', 'Trích dẫn'], ['split', 'Chia đôi + biểu tượng'], ['outro', 'Kết + kêu gọi']],
    animation: [['fade', 'Mờ dần'], ['slide-up', 'Trượt lên'], ['zoom', 'Phóng to'], ['typewriter', 'Gõ chữ'], ['pop', 'Bật nảy']],
    background: [['gradient', 'Chuyển màu'], ['blobs', 'Đốm sáng'], ['particles', 'Hạt bay'], ['grid', 'Lưới 3D'], ['waves', 'Sóng'], ['solid', 'Trơn']],
  };
  const opt = (k, v) => SEL[k].map(([a, b]) => `<option value="${a}" ${a === v ? 'selected' : ''}>${b}</option>`).join('');

  function renderInspector() {
    const f = $('#sceneForm');
    if (!state.sb || !state.sb.scenes.length) { f.innerHTML = '<p class="muted small">Chưa có cảnh nào.</p>'; $('#sceneIdx').textContent = '—'; return; }
    const s = state.sb.scenes[state.sel];
    $('#sceneIdx').textContent = `Cảnh ${state.sel + 1} / ${state.sb.scenes.length}`;
    f.innerHTML = `
      <div class="row">
        <label>Bố cục<select data-k="layout">${opt('layout', s.layout)}</select></label>
        <label style="flex:0 0 70px">Icon<input data-k="icon" value="${esc(s.icon)}" maxlength="4" /></label>
      </div>
      <label>Tiêu đề<textarea data-k="headline" rows="2">${esc(s.headline)}</textarea></label>
      ${s.layout === 'bullets' ? `<label>Các ý (mỗi dòng một ý)<textarea data-k="bullets" rows="4">${esc((s.bullets || []).join('\n'))}</textarea></label>` : ''}
      ${s.layout === 'stat' ? `<div class="row"><label>Con số<input data-k="stat_value" value="${esc(s.stat_value)}" /></label><label>Nhãn<input data-k="stat_label" value="${esc(s.stat_label)}" /></label></div>` : ''}
      ${s.layout !== 'bullets' ? `<label>${s.layout === 'quote' ? 'Người nói' : s.layout === 'outro' ? 'Nút kêu gọi' : 'Dòng phụ'}<input data-k="subtext" value="${esc(s.subtext)}" /></label>` : ''}
      <label>Lời thoại / phụ đề<textarea data-k="caption" rows="3">${esc(s.caption)}</textarea></label>
      <div class="row">
        <label>Thời lượng (s)<input data-k="duration" type="number" min="1" max="15" step="0.5" value="${s.duration}" /></label>
        <label>Hiệu ứng<select data-k="animation">${opt('animation', s.animation)}</select></label>
      </div>
      <label>Nền<select data-k="background">${opt('background', s.background)}</select></label>`;
    f.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        mutate((sb) => {
          const sc = sb.scenes[state.sel];
          if (k === 'bullets') sc.bullets = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
          else if (k === 'duration') sc.duration = Math.min(15, Math.max(1, parseFloat(el.value) || 1));
          else sc[k] = el.value;
        });
        if (k === 'layout') renderInspector();
        if (!state.playing && ['animation', 'layout', 'background'].includes(k)) previewScene();
      });
    });
  }
  // replay the selected scene from its start (nice feedback when changing animation)
  function previewScene() {
    const seg = R.timeline(state.sb)[state.sel]; if (!seg) return;
    state.time = seg.start; play();
    clearTimeout(previewScene._t);
    previewScene._t = setTimeout(() => { if (state.playing && state.time >= seg.end - 0.1) pause(); }, (seg.dur) * 1000);
  }

  function renderGlobal() {
    if (!state.sb) return;
    document.querySelectorAll('[data-pal]').forEach((el) => (el.value = toHex6(state.sb.palette[el.dataset.pal])));
    $('#gFont').value = state.sb.font; $('#gMood').value = state.sb.music.mood; $('#gBpm').value = state.sb.music.bpm;
    $('#projTitle').value = state.sb.title;
  }
  function toHex6(c) { c = (c || '#000000').trim(); if (/^#[0-9a-f]{3}$/i.test(c)) c = '#' + c.slice(1).split('').map((x) => x + x).join(''); return /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7) : '#000000'; }

  document.querySelectorAll('[data-pal]').forEach((el) => el.addEventListener('input', () => mutate((sb) => (sb.palette[el.dataset.pal] = el.value))));
  $('#gFont').addEventListener('change', (e) => mutate((sb) => (sb.font = e.target.value)));
  $('#gMood').addEventListener('change', (e) => mutate((sb) => (sb.music.mood = e.target.value)));
  $('#gBpm').addEventListener('change', (e) => mutate((sb) => (sb.music.bpm = Number(e.target.value) || 96)));
  $('#projTitle').addEventListener('input', (e) => state.sb && mutate((sb) => (sb.title = e.target.value)));
  $('#presets').innerHTML = PRESETS.map((p, i) => `<button class="preset" data-i="${i}" style="background:linear-gradient(135deg,${p.bg1} 0 50%,${p.bg2} 50% 75%,${p.accent} 75%)"></button>`).join('');
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('.preset'); if (!b || !state.sb) return;
    mutate((sb) => (sb.palette = { ...PRESETS[b.dataset.i] })); renderGlobal(); renderTimeline();
  });

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $('#tab-scene').hidden = name !== 'scene'; $('#tab-global').hidden = name !== 'global';
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // scene tools
  function sceneOp(fn) { if (!state.sb) return; const sb = JSON.parse(JSON.stringify(state.sb)); fn(sb); commit(sb); }
  $('#scUp').onclick = () => sceneOp((sb) => { const i = state.sel; if (i > 0) { [sb.scenes[i - 1], sb.scenes[i]] = [sb.scenes[i], sb.scenes[i - 1]]; state.sel--; } });
  $('#scDown').onclick = () => sceneOp((sb) => { const i = state.sel; if (i < sb.scenes.length - 1) { [sb.scenes[i + 1], sb.scenes[i]] = [sb.scenes[i], sb.scenes[i + 1]]; state.sel++; } });
  $('#scDup').onclick = () => sceneOp((sb) => { sb.scenes.splice(state.sel + 1, 0, JSON.parse(JSON.stringify(sb.scenes[state.sel]))); state.sel++; });
  $('#scDel').onclick = () => sceneOp((sb) => { if (sb.scenes.length > 1) sb.scenes.splice(state.sel, 1); });
  $('#scAdd').onclick = () => {
    if (!state.sb) state.sb = normalize({ scenes: [] });
    sceneOp((sb) => { sb.scenes.splice(state.sel + 1, 0, { layout: 'title', icon: '✨', headline: 'Cảnh mới', subtext: '', caption: '', duration: 4, animation: 'fade', background: 'gradient' }); state.sel = Math.min(state.sel + 1, sb.scenes.length - 1); });
  };

  function renderAll() { renderTimeline(); renderInspector(); renderGlobal(); draw(); }

  // ----------------------------------------------------------- Claude
  async function api(path, body) {
    const headers = { 'content-type': 'application/json' };
    const key = localStorage.getItem(LS.key); if (key) headers['x-user-key'] = key;
    const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ ...body, model: $('#model').value }) });
    const data = await res.json().catch(() => ({ error: 'Phản hồi không hợp lệ từ server.' }));
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    return data;
  }
  function busy(on, text) { $('#busy').hidden = !on; if (text) $('#busyText').textContent = text; $('#btnGenerate').disabled = on; }

  $('#btnGenerate').onclick = async () => {
    const prompt = $('#prompt').value.trim();
    if (!prompt) { $('#prompt').focus(); return toast('Hãy mô tả video bạn muốn trước.', true); }
    pause(); busy(true, 'Claude đang viết kịch bản…');
    try {
      const { storyboard } = await api('/api/generate', { prompt, seconds: Number($('#seconds').value), aspect: $('#aspect').value, style: $('#style').value });
      state.sel = 0; state.time = 0; commit(storyboard);
      addMsg('ai', `✓ Đã tạo “${state.sb.title}” — ${state.sb.scenes.length} cảnh, ${total().toFixed(0)} giây.`);
      play();
    } catch (e) {
      toast(e.message, true);
      if (/key/i.test(e.message)) $('#dlgSettings').showModal();
    } finally { busy(false); }
  };

  $('#btnDemo').onclick = () => { pause(); state.sel = 0; state.time = 0; commit(window.DMIDemo); addMsg('ai', 'Đã nạp bản mẫu. Bạn có thể chỉnh trực tiếp hoặc thêm API key để Claude tạo video mới.'); play(); };

  function addMsg(who, text) {
    const log = $('#chatLog'); if (log.querySelector('p.muted')) log.innerHTML = '';
    const d = document.createElement('div'); d.className = 'msg ' + who; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  $('#refineForm').onsubmit = async (e) => {
    e.preventDefault();
    const instruction = $('#refineInput').value.trim(); if (!instruction) return;
    if (!state.sb) return toast('Hãy tạo video trước đã.', true);
    addMsg('user', instruction); $('#refineInput').value = '';
    pause(); busy(true, 'Claude đang chỉnh sửa…');
    try {
      const { storyboard } = await api('/api/refine', { storyboard: state.sb, instruction });
      state.time = 0; commit(storyboard); addMsg('ai', `✓ Đã cập nhật (${state.sb.scenes.length} cảnh, ${total().toFixed(0)}s). Ctrl/⌘+Z để hoàn tác.`); play();
    } catch (err) { addMsg('ai err', err.message); } finally { busy(false); }
  };
  $('#ideaChips').innerHTML = IDEAS.map((t) => `<button class="chip">${esc(t)}</button>`).join('');
  $('#ideaChips').onclick = (e) => { const c = e.target.closest('.chip'); if (c) $('#prompt').value = c.textContent; };
  $('#refineChips').innerHTML = REFINES.map((t) => `<button class="chip" type="button">${esc(t)}</button>`).join('');
  $('#refineChips').onclick = (e) => { const c = e.target.closest('.chip'); if (c) { $('#refineInput').value = c.textContent; $('#refineForm').requestSubmit(); } };

  // ----------------------------------------------------------- settings
  $('#btnSettings').onclick = () => $('#dlgSettings').showModal();
  $('#apiKey').value = localStorage.getItem(LS.key) || '';
  $('#apiKey').addEventListener('change', (e) => { const v = e.target.value.trim(); v ? localStorage.setItem(LS.key, v) : localStorage.removeItem(LS.key); });
  $('#model').addEventListener('change', (e) => localStorage.setItem(LS.model, e.target.value));
  fetch('/api/status').then((r) => r.json()).then((s) => {
    $('#serverKeyStatus').textContent = s.serverKey ? '✓ Server đã có API key trong file .env — ô dưới có thể để trống.' : 'Server chưa có API key. Nhập key của bạn bên dưới (hoặc thêm ANTHROPIC_API_KEY vào file .env).';
    const saved = localStorage.getItem(LS.model);
    $('#model').value = saved || s.defaultModel || 'claude-sonnet-5-5';
    if (!$('#model').value) $('#model').selectedIndex = 0;
  }).catch(() => { $('#serverKeyStatus').textContent = 'Không kết nối được server. Hãy chạy “npm start”.'; });

  // ----------------------------------------------------------- project files
  $('#btnNew').onclick = () => { if (state.sb && !confirm('Bắt đầu dự án mới? Dự án hiện tại sẽ bị thay thế.')) return; pause(); state.sb = null; state.undo = []; state.time = 0; save(); $('#chatLog').innerHTML = ''; $('#projTitle').value = ''; renderAll(); $('#prompt').focus(); };
  $('#btnSave').onclick = () => {
    if (!state.sb) return toast('Chưa có gì để lưu.', true);
    const blob = new Blob([JSON.stringify({ sb: state.sb, aspect: state.aspect }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = slug(state.sb.title) + '.dmi.json'; a.click();
  };
  $('#btnOpen').onclick = () => $('#fileOpen').click();
  $('#fileOpen').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); setAspect(d.aspect || '16:9'); state.sel = 0; state.time = 0; commit(d.sb || d); toast('Đã mở dự án.'); }
    catch (err) { toast('File không hợp lệ.', true); }
    e.target.value = '';
  };
  const slug = (s) => (s || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'video';

  // ----------------------------------------------------------- export
  const dlgEx = $('#dlgExport');
  $('#btnExport').onclick = () => {
    if (!state.sb || !state.sb.scenes.length) return toast('Hãy tạo video trước đã.', true);
    if (!window.MediaRecorder || !canvas.captureStream) return toast('Trình duyệt này không hỗ trợ xuất video. Hãy dùng Chrome, Edge hoặc Safari mới.', true);
    pause();
    $('#exportSetup').hidden = false; $('#exportRun').hidden = true; $('#exportDone').hidden = true;
    dlgEx.showModal();
  };
  $('#exCancel').onclick = () => dlgEx.close();
  $('#exClose').onclick = () => dlgEx.close();

  function pickMime() {
    const list = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  }

  $('#exStart').onclick = async () => {
    $('#exportSetup').hidden = true; $('#exportRun').hidden = false;
    const res = Number($('#exRes').value);
    const [bw, bh] = SIZES[state.aspect];
    const scale = res / Math.min(bw, bh);
    const prevW = canvas.width, prevH = canvas.height;
    canvas.width = Math.round(bw * scale); canvas.height = Math.round(bh * scale);
    state.exporting = true;
    try { await document.fonts.ready; } catch (e) { /* ignore */ }

    const vStream = canvas.captureStream(30);
    const ac = music.ensure();
    const tracks = [...vStream.getVideoTracks()];
    if ($('#optMusic').checked && state.sb.music.mood !== 'none') tracks.push(...music.recDest.stream.getAudioTracks());
    const stream = new MediaStream(tracks);
    const mime = pickMime();
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: res >= 1080 ? 10e6 : 5e6 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const T = total();
    const captions = $('#optCaptions').checked;

    const done = new Promise((resolve) => (rec.onstop = resolve));
    R.renderFrame(ctx, canvas.width, canvas.height, state.sb, 0, { captions });
    rec.start(250);
    if ($('#optMusic').checked) music.play(state.sb.music, 0, T);
    const t0 = performance.now();
    void ac;
    await new Promise((resolve) => {
      function frame() {
        const t = (performance.now() - t0) / 1000;
        R.renderFrame(ctx, canvas.width, canvas.height, state.sb, Math.min(t, T), { captions });
        const pct = Math.min(100, (t / T) * 100);
        $('#exBar').style.width = pct + '%'; $('#exText').textContent = `${pct.toFixed(0)}%  ·  ${fmt(Math.min(t, T))} / ${fmt(T)}`;
        if (t >= T + 0.15) return resolve();
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    rec.stop(); await done; music.stop();
    state.exporting = false;
    canvas.width = prevW; canvas.height = prevH; draw();

    const type = (mime || 'video/webm').split(';')[0];
    const blob = new Blob(chunks, { type });
    const url = URL.createObjectURL(blob);
    $('#exVideo').src = url;
    const a = $('#exDownload'); a.href = url; a.download = `${slug(state.sb.title)}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    $('#exportRun').hidden = true; $('#exportDone').hidden = false;
  };

  // ----------------------------------------------------------- controls & keys
  $('#btnPlay').onclick = () => (state.playing ? pause() : play());
  $('#optCaptions').onchange = draw;
  $('#optMusic').onchange = restartMusic;
  $('#optVoice').onchange = (e) => { if (!e.target.checked && window.speechSynthesis) speechSynthesis.cancel(); };
  $('#aspect').onchange = (e) => { setAspect(e.target.value); save(); };

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (e.code === 'Space' && !typing) { e.preventDefault(); state.playing ? pause() : play(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      const from = e.shiftKey ? state.redo : state.undo, to = e.shiftKey ? state.undo : state.redo;
      if (!from.length) return;
      to.push(JSON.stringify(state.sb)); state.sb = normalize(JSON.parse(from.pop()));
      state.sel = Math.min(state.sel, state.sb.scenes.length - 1); save(); renderAll();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement === $('#prompt')) $('#btnGenerate').click();
  });
  window.addEventListener('resize', draw);

  // ----------------------------------------------------------- boot
  try {
    const saved = JSON.parse(localStorage.getItem(LS.project) || 'null');
    if (saved && saved.sb) { state.sb = normalize(saved.sb); setAspect(saved.aspect); }
    else setAspect('16:9');
  } catch (e) { setAspect('16:9'); }
  renderAll();
  if (document.fonts) document.fonts.ready.then(draw);
  window.DMIApp = { state, play, pause, seek, commit };
})();
