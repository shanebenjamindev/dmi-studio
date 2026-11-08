// The tabs of one customer on the Customers page beyond its projects, Drive and reports: its tasks (those of its projects
// the person may open, as on the project pages) and the history of changes to its record. Access is the customer's own
// (auth.ts guard: its owner, members and the head of the owner's department).
import { json, type Router } from './http';
import { currentUser } from './auth';
import { projectLevels } from './project-access';
import { historyOf } from './audit';
import { taskRows } from './admin/work';

export function registerCustomerTabs(api: Router) {
  api.get('/api/customers/:id/tasks', async (req, res) => {
    const user = (await currentUser(req))!, visible = await projectLevels(user.id);
    const rows = (await taskRows()).filter((t) => t.customer?.id === req.params.id && t.project && visible.has(t.project.id));
    json(res, 200, rows.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)).map(({ people, cardMembers, ...t }) => t));
  });

  api.get('/api/customers/:id/history', async (req, res) => {
    json(res, 200, (await historyOf('customer', req.params.id, 100)).map((h) => ({ action: h.action, by: h.user_name, before: h.old_data ? JSON.parse(h.old_data) : null, after: h.new_data ? JSON.parse(h.new_data) : null, at: h.created_at })));
  });
}
