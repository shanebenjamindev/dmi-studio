// The video editor's tools for Claude (server/mcp.ts adds them on the Mac): read a project's request sheet and footage,
// look at the footage, set up its HyperFrames folder (server/hyperframes.ts) and send the rendered video back. Claude
// Code does the building itself with the HyperFrames CLI in that folder.
import * as G from './google';
import { HttpError } from './http';
import { need, read, seg, str, vn, write, type Tool } from './mcp-kit';

const MAX_LOOKS = 16;
const label = (i: number) => `s${i + 1}`;
const footage = (sources: any[]) => sources.map((s, i) => ({ label: label(i), name: s.name, kind: s.kind, seconds: s.duration ? Math.round(s.duration * 10) / 10 : null, sceneRow: s.row || null }));

export const VIDEO_TOOLS: Tool[] = [
  {
    name: 'list_video_projects', title: 'Dự án video', annotations: read,
    description: 'Các dự án video trong trình dựng DMI (trên máy Mac) bạn được xem: tên, khách hàng, khung hình, sheet yêu cầu, trạng thái.',
    inputSchema: { type: 'object', properties: { query: str('Tên dự án hoặc khách hàng') } },
    run: async (call, a) => {
      const q = String(a.query || '').toLowerCase();
      return (await call('GET', '/api/projects')).filter((p: any) => !q || `${p.title} ${p.customerName || ''} ${p.sheet?.customer || ''}`.toLowerCase().includes(q))
        .map((p: any) => ({ id: p.id, title: p.title, customer: p.customerName || p.sheet?.customer || null, aspect: p.aspect, sheet: p.sheet?.title || null, deadline: p.sheet?.deadline || null, status: p.status || null, updated: vn(p.updatedAt) }));
    },
  },
  {
    name: 'get_video_project', title: 'Chi tiết dự án video', annotations: read,
    description: 'Một dự án video: sheet yêu cầu (khách, khung hình, thời lượng, kịch bản từng cảnh), danh sách footage (nhãn s1, s2…), thư mục HyperFrames và các bản render đã gửi về.',
    inputSchema: { type: 'object', properties: { project_id: str('Id dự án (p_…)') }, required: ['project_id'] },
    run: async (call, a) => {
      const id = seg(a.project_id, 'project_id');
      const [p, hf, renders] = await Promise.all([call('GET', `/api/projects/${id}`), call('GET', `/api/projects/${id}/hyperframes`), call('GET', `/api/projects/${id}/renders`)]);
      const f = p.sheet?.form || {};
      return {
        id: p.id, title: p.title, aspect: p.aspect, customer: p.customer?.name || f.customer || null, status: p.status || null, note: p.note || null,
        sheet: p.sheet ? { title: p.sheet.title, link: p.sheet.link, seconds: f.seconds || null, deadline: f.deadline || null, urgent: !!f.urgent, script: f.script || [], sequence: f.sequence || [], missing: p.sheet.missing || [] } : null,
        footage: footage(p.sources || []),
        hyperframes: { dir: hf.dir, ready: hf.exists, assets: hf.assets, brief: hf.brief },
        renders: renders.map((r: any) => ({ id: r.id, at: vn(r.createdAt), bytes: r.bytes, status: r.status })),
      };
    },
  },
  {
    name: 'view_footage', title: 'Xem footage', annotations: read,
    description: `Ảnh thu nhỏ của footage trong dự án, để chọn clip hợp với từng cảnh. Chọn theo nhãn (s1, s2…); bỏ trống là ${MAX_LOOKS} file đầu.`,
    inputSchema: { type: 'object', properties: { project_id: str('Id dự án'), labels: { type: 'array', items: { type: 'string' }, description: `Nhãn footage, tối đa ${MAX_LOOKS}` } }, required: ['project_id'] },
    run: async (call, a) => {
      // Reading the project checks this person may see it; its footage list is the server's own (signed when it was scanned).
      const p = await call('GET', `/api/projects/${seg(a.project_id, 'project_id')}`), all: any[] = p.sources || [];
      const want = Array.isArray(a.labels) && a.labels.length ? new Set(a.labels.map((x: any) => String(x).toLowerCase())) : null;
      const picked = all.map((s, i) => ({ s, i })).filter(({ i }) => !want || want.has(label(i))).slice(0, MAX_LOOKS);
      if (!picked.length) throw new HttpError(404, 'Không có footage nào khớp');
      const content: any[] = [];
      for (const { s, i } of picked) {
        content.push({ type: 'text', text: `${label(i)} · ${s.kind === 'video' ? `video${s.duration ? ` ${Math.round(s.duration * 10) / 10}s` : ''}` : 'ảnh'} · ${s.name}` });
        try { const t = await G.thumbBuffer(s.account, s.id); content.push({ type: 'image', data: t.body.toString('base64'), mimeType: t.type }); }
        catch { content.push({ type: 'text', text: '(chưa có ảnh thu nhỏ)' }); }
      }
      return { content };
    },
  },
  {
    name: 'prepare_hyperframes', title: 'Chuẩn bị thư mục HyperFrames', annotations: write,
    description: 'Tạo thư mục HyperFrames của dự án trên máy Mac (dự án trắng của HyperFrames nếu chưa có), tải footage từ Drive vào assets/ (theo nhãn s1, s2…; bỏ trống là tất cả, tối đa 40) và ghi BRIEF.md từ sheet yêu cầu. Chạy lại để tải thêm; file đã có không tải lại. Sau đó dựng video trong thư mục đó bằng HyperFrames CLI.',
    inputSchema: { type: 'object', properties: { project_id: str('Id dự án'), labels: { type: 'array', items: { type: 'string' }, description: 'Nhãn footage cần tải' } }, required: ['project_id'] },
    run: async (call, a) => {
      const r = await call('POST', `/api/projects/${seg(a.project_id, 'project_id')}/hyperframes/prepare`, { sources: Array.isArray(a.labels) ? a.labels : undefined });
      return { dir: r.dir, brief: `${r.dir}/BRIEF.md`, downloaded: r.downloaded, failed: r.failed, assets: r.assets, next: 'Đọc BRIEF.md, dựng trong thư mục này theo skill hyperframes, kiểm tra bằng `npx hyperframes check`, mở preview cho người dùng xem; render khi họ duyệt rồi gọi publish_render.' };
    },
  },
  {
    name: 'publish_render', title: 'Gửi bản render về dự án', annotations: write,
    description: 'Đưa file video đã render (mp4/mov/webm, nằm trong thư mục HyperFrames của dự án) vào danh sách bản render của dự án trong DMI.',
    inputSchema: { type: 'object', properties: { project_id: str('Id dự án'), file: str('Đường dẫn file, tương đối với thư mục dự án (ví dụ out.mp4) hoặc tuyệt đối') }, required: ['project_id', 'file'] },
    run: async (call, a) => {
      const r = await call('POST', `/api/projects/${seg(a.project_id, 'project_id')}/hyperframes/publish`, { file: need(a.file, 'file') });
      return { renderId: r.id, megabytes: Math.round(r.bytes / 1e5) / 10, published: true };
    },
  },
];
