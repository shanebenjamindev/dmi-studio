// What the Claude connector's tools share (server/mcp.ts, server/video-mcp.ts): the tool shape, the API call made as the
// connected person, and how dates and ids are read and shown.
import { HttpError } from './http';

/** An API request made as the person who connected Claude (their rights, their audit trail). */
export type Call = (method: string, path: string, data?: any) => Promise<any>;
export interface Tool { name: string; title: string; description: string; inputSchema: any; annotations: any; run: (call: Call, a: any) => Promise<any> }
export const read = { readOnlyHint: true, openWorldHint: false }, write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const VN = 7 * 3600e3;
/** A time as Vietnam reads it: 2026-11-14 17:00. */
export const vn = (ms: number | null | undefined) => ms ? new Date(ms + VN).toISOString().slice(0, 16).replace('T', ' ') : null;
/** A date Claude gives: ISO 8601; a bare date is the end of that day in Vietnam; '' or null clears it. */
export function when(v: any, field: string) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v), ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:00+07:00`) : Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + '+07:00');
  if (!Number.isFinite(ms)) throw new HttpError(400, `${field} không phải ngày hợp lệ (dùng YYYY-MM-DD hoặc ISO 8601)`);
  return ms;
}
export const need = (v: any, what: string) => { const s = String(v ?? '').trim(); if (!s) throw new HttpError(400, `Thiếu ${what}`); return s; };
export const seg = (v: any, what: string) => encodeURIComponent(need(v, what));
export const brief = (t: any) => ({
  id: t.id, title: t.title, stage: t.stage, status: t.status, state: t.state, due: vn(t.dueAt), start: vn(t.startAt), done: vn(t.doneAt),
  service: t.project?.name || null, serviceId: t.project?.id || null, assignees: (t.assignees || []).map((a: any) => a.name), labels: t.labels || [],
  createdBy: t.createdBy?.name || null, parent: t.parent?.title || null, updated: vn(t.updatedAt),
});
export const str = (description: string) => ({ type: 'string', description });
