// Google Drive links pasted into DMI (a customer's folder, a report's videos): the file or folder id they point at, and
// which connected Google account can open it.
import { HttpError } from './http';
import * as G from './google';

/** Folder or file id from any Drive URL shape (…/folders/ID, …/file/d/ID/view, ?id=ID) or a bare id. */
export function driveId(link: string) {
  const s = String(link || '').trim();
  const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/\/d\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : '';
}

export async function locate(id: string) {
  const accounts = await G.accounts();
  if (!accounts.length) throw new HttpError(400, 'Chưa kết nối tài khoản Google Drive nào. Quản trị viên hãy kết nối trong trang Khách hàng.');
  const fields = 'id,name,mimeType,videoMediaMetadata(durationMillis),thumbnailLink,shortcutDetails(targetId,targetMimeType)';
  for (const a of accounts) {
    let file: G.GFile;
    try { file = await G.meta(a.email, id, fields) as G.GFile; }
    catch { continue; } // not visible to this account
    // A link to a shortcut opens what it points at (folder, clip, photo or sheet).
    if (file.mimeType === G.SHORTCUT_MIME && file.shortcutDetails) {
      try { file = { ...await G.meta(a.email, file.shortcutDetails.targetId, fields) as G.GFile, name: file.name }; }
      catch { throw new HttpError(404, 'Lối tắt này trỏ tới file đã bị xoá hoặc chưa được chia sẻ'); }
    }
    return { account: a.email, file };
  }
  throw new HttpError(404, `Không mở được link này bằng tài khoản Google đã kết nối (${accounts.map((a) => a.email).join(', ')}). Hãy chia sẻ link (quyền Người xem) cho một trong các tài khoản đó.`);
}
