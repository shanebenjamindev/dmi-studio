import { Fragment } from 'react';

export interface CrumbItem {
  label: string;
  onClick?: () => void;
  title?: string;
}

/** Typographic hierarchy trail: Khách hàng › Nhãn hàng › Dịch vụ › Task › Task con. */
export function Breadcrumb({ items, className = '' }: { items: CrumbItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <nav className={`ui-crumbs${className ? ` ${className}` : ''}`} aria-label="Vị trí hiện tại">
      {items.map((item, idx) => {
        const last = idx === items.length - 1;
        return (
          <Fragment key={`${idx}-${item.label}`}>
            {idx > 0 && <span className="ui-crumb-sep" aria-hidden="true">›</span>}
            {!last && item.onClick ? (
              <button type="button" className="ui-crumb-link" onClick={item.onClick} title={item.title || item.label}>
                {item.label}
              </button>
            ) : (
              <span className={last ? 'ui-crumb-cur' : 'ui-crumb-text'} title={item.title || item.label}>
                {item.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

