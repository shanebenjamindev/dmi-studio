// Tìm kiếm toàn bộ: one search across colleagues, tasks, customers, projects and the account's own quick notes, each
// limited to what that person may open by the same rules as its page: projects they belong to (and the customers those
// belong to), private boards they are on, customers they own, manage or were added to. A task's description is
// searched and quoted; its result (it can hold logins) never is. Boards and cards: /api/boards-search.
import { all } from './db';
import { json, type Router } from './http';
import { currentUser } from './auth';
import { customerLevels } from './customer-access';
import { projectLevels } from './project-access';
import { taskRows } from './admin/work';
import { matcher } from './admin/common';
import { richToText } from '../shared/rich';

const TYPES = ['members', 'tasks', 'customers', 'projects', 'notes'] as const;
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const plain = (html: string) => html.replace(/<\/?(br|p|div|li|h[12]|ul|ol)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** Some words around the first match (the text's own spelling), for showing why it was found. */
function around(text: string, words: string[]) {
  const flat = text.replace(/\s+/g, ' ').trim(), f = fold(flat);
  const at = Math.min(...words.map((w) => f.indexOf(w)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return '';
  const start = Math.max(0, at - 60), end = Math.min(flat.length, at + 140);
  return `${start ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export function registerSearch(api: Router) {
  api.get('/api/search', async (req, res) => {
    const user = (await currentUser(req))!, q = String(req.query.get('q') || '').trim().slice(0, 100);
    const words = fold(q).split(/[\s,;:()"'“”|#[\]\-/\\]+/).filter(Boolean);
    const only = TYPES.find((t) => t === req.query.get('type')), limit = only ? 50 : 5;
    const out: Record<string, { items: any[]; total: number }> = {};
    if (!words.length) return json(res, 200, out);
    const hit = matcher(q);
    const take = <T,>(rows: T[]) => ({ items: rows.slice(0, limit), total: rows.length });
    const want = (t: (typeof TYPES)[number]) => !only || only === t;
    // What this person may open, looked up once for every kind of result (each look is several reads).
    let customerAccess: ReturnType<typeof customerLevels> | undefined, projectAccess: ReturnType<typeof projectLevels> | undefined;
    const myCustomers = () => customerAccess ||= customerLevels(user.id);
    const myProjects = () => projectAccess ||= myCustomers().then((c) => projectLevels(user.id, c));

    if (want('members')) {
      const rows = (await all<any>(`SELECT u.id, u.name, u.email, u.phone, u.avatar_at, d.name dept, p.name position FROM users u LEFT JOIN team_roles d ON d.id = u.team_role
        LEFT JOIN dept_roles p ON p.id = u.dept_role AND p.team_role_id = u.team_role WHERE u.disabled = 0 ORDER BY u.name`)).filter((u) => hit(u.name, u.email, u.phone, u.dept, u.position));
      out.members = take(rows.map((u) => ({ id: u.id, name: u.name, email: u.email, department: u.dept || null, position: u.position || null, avatarAt: u.avatar_at || null })));
    }
    if (want('tasks')) {
      const [projects, customers] = await Promise.all([myProjects(), myCustomers()]);
      // A task on a private board's card opens only for the board's people, or the task's own.
      const closed = new Set((await all<any>(`SELECT l.task_id FROM task_board_links l JOIN board_cards c ON c.id = l.card_id JOIN boards b ON b.id = c.board_id
        WHERE (b.created_by IS NULL OR b.created_by <> ?) AND NOT EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = ?)`, user.id, user.id)).map((r) => r.task_id));
      const seen = (t: Awaited<ReturnType<typeof taskRows>>[number]) => {
        const own = t.people.includes(user.id);
        if (closed.has(t.id) && !own) return false;
        return t.project ? projects.has(t.project.id) && (!t.customer || customers.has(t.customer.id)) : own;
      };
      const visible = (await taskRows()).filter(seen);
      const desc = new Map((await all<any>("SELECT id, description FROM tasks WHERE description IS NOT NULL AND description <> ''")).map((r) => [r.id, richToText(String(r.description))]));
      const rows = visible.filter((t) => hit(t.id, t.title, t.project?.name, t.customer?.name, t.campaign?.name, t.labels.join(' '), t.externalId, t.status, t.assignees.map((a) => a.name).join(' '), desc.get(t.id)))
        .sort((a, b) => Number(hit(b.title)) - Number(hit(a.title)) || b.updatedAt - a.updatedAt);
      out.tasks = take(rows.map((t) => ({ id: t.id, title: t.title, status: t.status, state: t.state, category: t.category, project: t.project, assignees: t.assignees.map((a) => a.name), startAt: t.startAt, dueAt: t.dueAt,
        snippet: hit(t.title, t.project?.name) ? '' : around(desc.get(t.id) || '', words) })));
    }
    if (want('customers')) {
      const levels = await myCustomers();
      const rows = (await all<any>('SELECT id, name, code, contact, phone, email, notes FROM customers WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE')).filter((c) => levels.has(c.id) && hit(c.id, c.name, c.code, c.contact, c.phone, c.email, c.notes));
      out.customers = take(rows.map((c) => ({ id: c.id, name: c.name, contact: c.contact || '', phone: c.phone || '', email: c.email || '' })));
    }
    if (want('projects')) {
      const levels = await myProjects();
      const rows = (await all<any>('SELECT p.id, p.name, c.name customer, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.stub = 0) tasks FROM task_projects p LEFT JOIN customers c ON c.id = p.customer_id ORDER BY p.name'))
        .filter((p) => levels.has(p.id) && hit(p.name, p.customer));
      out.projects = take(rows.map((p) => ({ id: p.id, name: p.name, customer: p.customer || null, tasks: Number(p.tasks) })));
    }
    if (want('notes')) {
      const rows = (await all<any>('SELECT id, body, color, updated_at FROM quick_notes WHERE user_id = ? ORDER BY updated_at DESC', user.id)).map((n) => ({ n, text: plain(n.body) })).filter((x) => hit(x.text));
      out.notes = take(rows.map(({ n, text }) => ({ id: n.id, title: text.split('\n').map((l) => l.trim()).find(Boolean) || 'Ghi chú', snippet: around(text, words), color: n.color, updatedAt: n.updated_at })));
    }
    json(res, 200, out);
  });
}
