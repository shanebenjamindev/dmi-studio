import { useState, type ReactNode } from 'react';
import { Icon } from '../ui';

export interface TreeServiceNode {
  id: string;
  name: string;
  openTasks: number;
}

export interface TreeBrandNode {
  id: string;
  name: string;
  openTasks: number;
  services: TreeServiceNode[];
}

export interface TreeCustomerNode {
  id: string;
  name: string;
  openTasks: number;
  brands: TreeBrandNode[];
}

export interface SidebarTreeProps {
  customers: TreeCustomerNode[];
  selectedServiceId?: string | null;
  selectedBrandId?: string | null;
  selectedCustomerId?: string | null;
  onSelectService?: (serviceId: string, brandId: string, customerId: string) => void;
  onSelectBrand?: (brandId: string, customerId: string) => void;
  onSelectCustomer?: (customerId: string) => void;
  header?: ReactNode;
  storageKey?: string;
}

/** Clean 3-level sidebar tree: Khách hàng ▸ Nhãn hàng ▸ Dịch vụ with grey open-task counts. */
export function SidebarTree({
  customers,
  selectedServiceId,
  selectedBrandId,
  selectedCustomerId,
  onSelectService,
  onSelectBrand,
  onSelectCustomer,
  header,
  storageKey = 'dms.treeOpen',
}: SidebarTreeProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch {
      return {};
    }
  });

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const q = query.trim().toLocaleLowerCase('vi');
  const filteredCustomers = customers
    .map((c) => {
      if (!q) return c;
      const cMatch = c.name.toLocaleLowerCase('vi').includes(q);
      const brands = c.brands
        .map((b) => {
          const bMatch = cMatch || b.name.toLocaleLowerCase('vi').includes(q);
          const services = b.services.filter((s) => bMatch || s.name.toLocaleLowerCase('vi').includes(q));
          return bMatch || services.length > 0 ? { ...b, services } : null;
        })
        .filter(Boolean) as TreeBrandNode[];
      return cMatch || brands.length > 0 ? { ...c, brands } : null;
    })
    .filter(Boolean) as TreeCustomerNode[];

  return (
    <div className="ui-tree" aria-label="Cây khách hàng, nhãn hàng và dịch vụ">
      {header}
      <label className="ui-tree-search">
        <Icon name="search" size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm khách, nhãn hàng, dịch vụ…"
          aria-label="Tìm trong cây điều hướng"
        />
      </label>
      <div className="ui-tree-list">
        {!filteredCustomers.length ? (
          <p className="ui-tree-empty">Không có mục phù hợp</p>
        ) : (
          filteredCustomers.map((c) => {
            const cActive = selectedCustomerId === c.id && !selectedBrandId && !selectedServiceId;
            const cContains = selectedCustomerId === c.id;
            const cOpen = q ? true : expanded[`c:${c.id}`] ?? cContains;
            return (
              <div key={c.id} className="ui-tree-node">
                <div className={`ui-tree-row${cActive ? ' is-active' : ''}`}>
                  <button
                    type="button"
                    className={`ui-tree-chev${cOpen ? ' open' : ''}`}
                    onClick={() => toggle(`c:${c.id}`)}
                    aria-label={cOpen ? `Thu gọn ${c.name}` : `Mở ${c.name}`}
                    aria-expanded={cOpen}
                  >
                    <Icon name="right" size={12} />
                  </button>
                  <button
                    type="button"
                    className="ui-tree-label"
                    onClick={() => (onSelectCustomer ? onSelectCustomer(c.id) : toggle(`c:${c.id}`))}
                    title={c.name}
                  >
                    <span>{c.name}</span>
                    {c.openTasks > 0 && <em className="ui-tree-count">{c.openTasks}</em>}
                  </button>
                </div>

                {cOpen && c.brands.length > 0 && (
                  <div className="ui-tree-children">
                    {c.brands.map((b) => {
                      const bActive = selectedBrandId === b.id && !selectedServiceId;
                      const bContains = selectedBrandId === b.id || b.services.some((s) => s.id === selectedServiceId);
                      const bOpen = q ? true : expanded[`b:${b.id}`] ?? bContains;
                      return (
                        <div key={b.id} className="ui-tree-node">
                          <div className={`ui-tree-row ui-tree-brand${bActive ? ' is-active' : ''}`}>
                            <button
                              type="button"
                              className={`ui-tree-chev${bOpen ? ' open' : ''}`}
                              onClick={() => toggle(`b:${b.id}`)}
                              aria-label={bOpen ? `Thu gọn ${b.name}` : `Mở ${b.name}`}
                              aria-expanded={bOpen}
                            >
                              <Icon name="right" size={12} />
                            </button>
                            <button
                              type="button"
                              className="ui-tree-label"
                              onClick={() => (onSelectBrand ? onSelectBrand(b.id, c.id) : toggle(`b:${b.id}`))}
                              title={b.name}
                            >
                              <span>{b.name}</span>
                              {b.openTasks > 0 && <em className="ui-tree-count">{b.openTasks}</em>}
                            </button>
                          </div>

                          {bOpen && b.services.length > 0 && (
                            <div className="ui-tree-children">
                              {b.services.map((s) => {
                                const sActive = selectedServiceId === s.id;
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    className={`ui-tree-row ui-tree-svc${sActive ? ' is-active' : ''}`}
                                    onClick={() => onSelectService?.(s.id, b.id, c.id)}
                                    title={s.name}
                                  >
                                    <span className="ui-tree-dot" aria-hidden="true" />
                                    <span className="ui-tree-svc-name">{s.name}</span>
                                    {s.openTasks > 0 && <em className="ui-tree-count">{s.openTasks}</em>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

