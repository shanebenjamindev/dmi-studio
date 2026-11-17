// Tabs on Khách hàng besides Nhãn hàng/Dịch vụ, Drive, Reports: tasks across its brand_services and record history.
import { json, type Router } from './http';
import { currentUser } from './auth';
import { brandServiceLevels } from './project-access';
import { historyOf } from './audit';
import { taskRows } from './admin/work';

export function registerCustomerTabs(api: Router) {
  api.get('/api/customers/:id/tasks', async (req, res) => {
    const user = (await currentUser(req))!;
    const visible = await brandServiceLevels(user.id);
    const brandId = String(req.query.get('brand') || req.query.get('brandId') || '').trim();
    const bsId = String(req.query.get('brandService') || req.query.get('brandServiceId') || '').trim();
    const svcId = String(req.query.get('service') || req.query.get('catalogServiceId') || '').trim();
    const rows = (await taskRows()).filter(
      (t) =>
        t.customer?.id === req.params.id &&
        t.brandService &&
        visible.has(t.brandService.id) &&
        (!brandId || t.brand?.id === brandId) &&
        (!bsId || t.brandService.id === bsId) &&
        (!svcId || t.brandService.catalogServiceId === svcId)
    );
    json(
      res,
      200,
      rows.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)).map(({ people, cardMembers, ...t }) => t)
    );
  });

  // Overview across all accessible customers.
  api.get('/api/customer-flow', async (req, res) => {
    const user = (await currentUser(req))!;
    const visible = await brandServiceLevels(user.id);
    const rows = (await taskRows()).filter((t) => t.customer && t.brandService && visible.has(t.brandService.id));
    json(
      res,
      200,
      rows.map((t) => ({
        id: t.id,
        title: t.title,
        stage: t.stage,
        state: t.state,
        dueAt: t.dueAt,
        revision: t.revision,
        submittedAt: t.submittedAt,
        createdAt: t.createdAt,
        doneAt: t.doneAt,
        customer: t.customer,
        brand: t.brand,
        brandService: t.brandService,
        assignees: t.assignees.map((a) => ({ id: a.id, name: a.name })),
      }))
    );
  });

  api.get('/api/customers/:id/history', async (req, res) => {
    json(
      res,
      200,
      (await historyOf('customer', req.params.id, 100)).map((h) => ({
        action: h.action,
        by: h.user_name,
        before: h.old_data ? JSON.parse(h.old_data) : null,
        after: h.new_data ? JSON.parse(h.new_data) : null,
        at: h.created_at,
      }))
    );
  });
}
