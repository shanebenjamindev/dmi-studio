// Demo data for the user guide: a made-up company on a scratch server (never the real one). Run it once against a
// fresh server started with scratch DATA_DIR and DRIVE_DIR:  node scripts/guide/seed.mjs http://127.0.0.1:5394
// Every name, email and phone number below is invented. All accounts use the password in PASSWORD.
export const PASSWORD = 'demo-12345';
export const PEOPLE = {
  an: { name: 'Nguyễn Văn An', email: 'an@demo.dmi' },
  lan: { name: 'Trần Thị Lan', email: 'lan@demo.dmi', dept: 'Media Execute', level: 'admin' },
  minh: { name: 'Lê Văn Minh', email: 'minh@demo.dmi', dept: 'Account / Sale', level: 'normal' },
  ha: { name: 'Phạm Thu Hà', email: 'ha@demo.dmi', dept: 'Content / Script', level: 'normal' },
  huy: { name: 'Đỗ Quang Huy', email: 'huy@demo.dmi', dept: 'Ads / Performance', level: 'normal' },
  mai: { name: 'Vũ Ngọc Mai', email: 'mai@demo.dmi', dept: 'Account / Sale', level: 'observer' },
};

const base = process.argv[2] || 'http://127.0.0.1:5394';
const DAY = 864e5, today = new Date(); today.setHours(17, 0, 0, 0);
const at = (days, hour = 17) => { const d = new Date(today.getTime() + days * DAY); d.setHours(hour, 0, 0, 0); return d.getTime(); };

async function call(cookie, method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data)}`);
  return { data, cookie: (r.headers.get('set-cookie') || '').match(/dms_sid=[^;]+/)?.[0] };
}
const login = async (email) => (await call(null, 'POST', '/api/auth/login', { email, password: PASSWORD })).cookie;

export async function seed() {
  for (let i = 0; i < 100; i++) { try { await fetch(base + '/api/health'); break; } catch { await new Promise((ok) => setTimeout(ok, 300)); } }
  const boss = (await call(null, 'POST', '/api/auth/setup', { name: PEOPLE.an.name, email: PEOPLE.an.email, password: PASSWORD })).cookie;
  const A = (m, p, b) => call(boss, m, p, b).then((r) => r.data);
  await A('GET', '/api/boards'); // makes the departments and their boards
  const depts = await A('GET', '/api/roles');
  const ids = { an: (await A('GET', '/api/auth/me')).user.id };
  for (const [key, p] of Object.entries(PEOPLE).filter(([k]) => k !== 'an')) {
    const dept = depts.find((d) => d.name === p.dept);
    const pos = (dept.positions || []).find((x) => x.level === p.level) || (await A('POST', `/api/roles/${dept.id}/positions`, { name: p.level === 'observer' ? 'Cộng tác viên (chỉ xem)' : p.level === 'admin' ? 'Trưởng phòng' : 'Nhân viên', level: p.level }));
    ids[key] = (await A('POST', '/api/users', { name: p.name, email: p.email, password: PASSWORD, role: 'member', teamRole: dept.id, deptRole: pos.id })).id;
  }

  // Customers, at different stages of their own workflow.
  const sources = await A('GET', '/api/customers/sources');
  const src = (n) => sources.find((s) => s.name === n)?.id || null;
  const CUSTOMERS = [
    ['Rửa xe Ánh Dương', 'Chị Hồng', '0901 234 567', 'lienhe@anhduong.example', 'active', 'Facebook Ads', 'minh'],
    ['Auto Spa Sài Gòn', 'Anh Tuấn', '0912 345 678', 'tuan@autospasg.example', 'active', 'Giới thiệu', 'minh'],
    ['Garage Minh Phát', 'Anh Phát', '0938 111 222', 'phat@minhphat.example', 'caring', 'Website', 'minh'],
    ['Detailing Hà Nội Pro', 'Chị Thảo', '0987 654 321', 'thao@hnpro.example', 'caring', 'Google Ads', 'an'],
    ['Phủ Ceramic 365', 'Anh Khoa', '0909 365 365', 'khoa@ceramic365.example', 'lead', 'Facebook Ads', 'minh'],
    ['AutoCare Đà Nẵng', 'Anh Long', '0905 777 888', 'long@autocaredn.example', 'lead', 'Sự kiện', 'an'],
    ['Xe Sạch Express', 'Chị Vy', '0977 222 333', 'vy@xesach.example', 'paused', 'Khách cũ', 'minh'],
    ['Dán Phim Cách Nhiệt Việt', 'Anh Nam', '0966 444 555', 'nam@phimviet.example', 'lead', 'Website', 'an'],
  ];
  const cust = {};
  for (const [name, contact, phone, email, status, source, owner] of CUSTOMERS) {
    cust[name] = (await A('POST', '/api/customers', { name, contact, phone, email, status, sourceId: src(source), managerId: ids[owner], databaseOnly: true })).id;
  }

  // Projects of customers, and their tasks with real-looking dates: late, due today, coming, done.
  const proj = {};
  for (const [c, name] of [['Rửa xe Ánh Dương', 'Chiến dịch Tết 2027'], ['Auto Spa Sài Gòn', 'Quảng cáo Meta tháng 11'], ['Garage Minh Phát', 'Website mới'], ['Detailing Hà Nội Pro', 'Video giới thiệu dịch vụ'], ['Xe Sạch Express', 'Chăm sóc fanpage']]) {
    proj[name] = (await A('POST', `/api/customers/${cust[c]}/projects`, { name })).id;
  }
  const TASKS = [
    ['Chiến dịch Tết 2027', 'Lên kịch bản video Tết', 'ha', -3, 'Đang thực hiện'],
    ['Chiến dịch Tết 2027', 'Quay video tại tiệm', 'lan', 0, 'Chưa thực hiện'],
    ['Chiến dịch Tết 2027', 'Dựng video 30 giây', 'lan', 2, 'Chưa thực hiện'],
    ['Chiến dịch Tết 2027', 'Thiết kế banner khuyến mãi', 'lan', 4, 'Chưa thực hiện'],
    ['Chiến dịch Tết 2027', 'Gửi khách duyệt ý tưởng', 'minh', -6, 'Hoàn thành'],
    ['Quảng cáo Meta tháng 11', 'Thiết lập chiến dịch Meta Ads', 'huy', -2, 'Hoàn thành'],
    ['Quảng cáo Meta tháng 11', 'Tối ưu nhóm quảng cáo tuần 2', 'huy', 0, 'Đang thực hiện'],
    ['Quảng cáo Meta tháng 11', 'Báo cáo hiệu quả giữa tháng', 'huy', 3, 'Chưa thực hiện'],
    ['Quảng cáo Meta tháng 11', 'Viết nội dung 5 mẫu quảng cáo', 'ha', -1, 'Đang đánh giá'],
    ['Website mới', 'Thu thập hình ảnh garage', 'minh', -4, 'Hoàn thành'],
    ['Website mới', 'Viết nội dung trang Dịch vụ', 'ha', 1, 'Đang thực hiện'],
    ['Website mới', 'Dựng giao diện trang chủ', 'lan', 6, 'Chưa thực hiện'],
    ['Website mới', 'Gửi bản nháp cho khách', 'minh', 8, 'Chưa thực hiện'],
    ['Video giới thiệu dịch vụ', 'Viết kịch bản 60 giây', 'ha', 5, 'Chưa thực hiện'],
    ['Video giới thiệu dịch vụ', 'Chọn nhạc nền và giọng đọc', 'lan', 7, 'Chưa thực hiện'],
    ['Chăm sóc fanpage', 'Đăng 3 bài tuần này', 'ha', -5, 'Tạm dừng'],
  ];
  const tasks = {};
  for (const [p, title, who, days, status] of TASKS) {
    tasks[title] = (await A('POST', '/api/tasks', { title, projectId: proj[p], assigneeUserIds: [ids[who]], startAt: at(days - 3, 9), dueAt: at(days), status,
      description: `<p>${title} cho dự án <b>${p}</b>. Xem tài liệu trong thư mục khách hàng trước khi bắt đầu.</p>` })).id;
  }
  // A follower, a subtask and a task given to the admin too.
  await A('PUT', `/api/tasks/${tasks['Dựng video 30 giây']}`, { followerUserIds: [ids.minh] });
  await A('POST', '/api/tasks', { title: 'Cắt bản 15 giây cho Reels', parentId: tasks['Dựng video 30 giây'], projectId: proj['Chiến dịch Tết 2027'], assigneeUserIds: [ids.lan], dueAt: at(3) });
  await A('POST', '/api/tasks', { title: 'Duyệt kế hoạch tháng 12', assigneeUserIds: [ids.an], dueAt: at(1, 10) });
  await A('POST', '/api/tasks', { title: 'Họp giao ban đầu tuần', assigneeUserIds: [ids.an, ids.lan, ids.minh], dueAt: at(0, 9) });

  // A board of the company's own, as a team would set one up.
  const board = await A('POST', '/api/boards', { name: 'Kế hoạch Marketing tháng 11', bg: 'ocean', roleId: null });
  for (const k of ['lan', 'minh', 'ha', 'huy']) await A('PUT', `/api/boards/${board.id}/members/${ids[k]}`, { level: 'normal' });
  await A('PUT', `/api/boards/${board.id}/members/${ids.mai}`, { level: 'observer' });
  const full = await A('GET', `/api/boards/${board.id}`);
  const [todo, doing, done] = full.lists;
  await A('PUT', `/api/lists/${doing.id}`, { color: 'yellow' });
  await A('PUT', `/api/lists/${done.id}`, { color: 'green' });
  const labels = full.labels;
  const CARDS = [
    [todo, 'Lịch đăng bài tuần 3', 'ha', 2, 'Chiến dịch Tết 2027'],
    [todo, 'Chuẩn bị quà tặng khách hàng thân thiết', 'minh', 6, null],
    [doing, 'Chụp ảnh sản phẩm Ceramic', 'lan', 1, 'Chiến dịch Tết 2027'],
    [doing, 'Kiểm tra ngân sách quảng cáo', 'huy', 0, 'Quảng cáo Meta tháng 11'],
    [done, 'Gửi báo giá gói chăm sóc xe', 'minh', -2, null],
  ];
  const cards = {};
  for (const [list, title, who, days, project] of CARDS) {
    const c = await A('POST', `/api/lists/${list.id}/cards`, { title, syncTask: true, kind: 'task', projectId: project ? proj[project] : null });
    cards[title] = c.id;
    await A('PUT', `/api/cards/${c.id}`, { dueAt: at(days), startAt: at(days - 2, 9) });
    await A('PUT', `/api/cards/${c.id}/members`, { userId: ids[who], on: true });
    if (labels[0]) await A('PUT', `/api/cards/${c.id}/labels`, { labelId: labels[(title.length) % labels.length].id, on: true });
  }
  const shoot = cards['Chụp ảnh sản phẩm Ceramic'];
  await A('PUT', `/api/cards/${shoot}`, { description: '<p>Chụp 12 ảnh: trước và sau khi phủ ceramic, góc nghiêng 45°, ánh sáng tự nhiên.</p>', cover: 'sky' });
  const list = (await A('POST', `/api/cards/${shoot}/checklists`, { title: 'Chuẩn bị' }));
  const checklistId = list.id || (await A('GET', `/api/cards/${shoot}`)).checklists?.[0]?.id;
  for (const [text, ok] of [['Đặt lịch với khách', true], ['Mượn đèn và chân máy', true], ['Danh sách góc chụp', false]]) {
    const item = await A('POST', `/api/checklists/${checklistId}/items`, { text });
    if (ok && item?.id) await A('PUT', `/api/items/${item.id}`, { done: true });
  }
  const lanC = await login(PEOPLE.lan.email);
  await call(lanC, 'POST', `/api/cards/${shoot}/comments`, { text: 'Mình đã hẹn khách 9h sáng thứ Năm, mọi người lưu ý nhé.' });
  await A('POST', `/api/cards/${shoot}/comments`, { text: 'Ok Lan, nhớ chụp thêm vài ảnh nội thất xe.' });

  // A project put on hold, notes, and a few unread notifications for the admin.
  await A('PUT', `/api/task-projects/${proj['Chăm sóc fanpage']}`, { hold: 'paused' });
  const note = (await A('POST', '/api/quick-notes', { color: 'yellow' })).id;
  await A('PUT', `/api/quick-notes/${note}`, { body: '<p><b>Việc cần nhớ tuần này</b></p><ul data-check=""><li data-checked="">Gọi lại anh Phát về website</li><li>Duyệt video Tết trước thứ Sáu</li><li>Hẹn họp với Detailing Hà Nội Pro</li></ul>', open: false });
  const minhC = await login(PEOPLE.minh.email);
  await call(minhC, 'POST', '/api/tasks', { title: 'Gọi lại anh Khoa về gói phủ ceramic', assigneeUserIds: [ids.an], dueAt: at(1, 15) });
  await call(minhC, 'POST', `/api/cards/${cards['Chuẩn bị quà tặng khách hàng thân thiết']}/comments`, { text: 'Anh An xem giúp em danh sách quà nhé.' });
  return { ids, cust, proj, tasks, board: board.id, cards };
}

if (import.meta.url === `file://${process.argv[1]}`) seed().then((r) => console.log(JSON.stringify({ board: r.board, users: Object.keys(r.ids).length, customers: Object.keys(r.cust).length, tasks: Object.keys(r.tasks).length }))).catch((e) => { console.error(e.message); process.exit(1); });
