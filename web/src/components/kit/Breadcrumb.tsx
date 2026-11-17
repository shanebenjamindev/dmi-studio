import { Fragment, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui';

export interface CrumbItem {
  label: string;
  onClick?: () => void;
  title?: string;
}

/**
 * Google Drive-style typographic hierarchy trail:
 * - <= 2 items: First › Current
 * - >= 3 items: First › [⋯] › Current (clicking ⋯ opens dropdown of intermediate folders/levels)
 */
export function Breadcrumb({ items, className = '' }: { items: CrumbItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!items.length) return null;

  const renderCrumb = (item: CrumbItem, last: boolean) =>
    !last && item.onClick ? (
      <button type="button" className="ui-crumb-link" onClick={item.onClick} title={item.title || item.label}>
        {item.label}
      </button>
    ) : (
      <span className={last ? 'ui-crumb-cur' : 'ui-crumb-text'} title={item.title || item.label}>
        {item.label}
      </span>
    );

  if (items.length <= 2) {
    return (
      <nav className={`ui-crumbs${className ? ` ${className}` : ''}`} aria-label="Vị trí hiện tại">
        {items.map((item, idx) => {
          const last = idx === items.length - 1;
          return (
            <Fragment key={`${idx}-${item.label}`}>
              {idx > 0 && <span className="ui-crumb-sep" aria-hidden="true">›</span>}
              {renderCrumb(item, last)}
            </Fragment>
          );
        })}
      </nav>
    );
  }

  const first = items[0];
  const middle = items.slice(1, -1);
  const current = items[items.length - 1];

  return (
    <nav className={`ui-crumbs${className ? ` ${className}` : ''}`} aria-label="Vị trí hiện tại">
      {renderCrumb(first, false)}
      <span className="ui-crumb-sep" aria-hidden="true">›</span>
      <span className="ui-crumb-more-wrap" ref={moreRef}>
        <button
          type="button"
          className={`ui-crumb-more${open ? ' is-open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Xem các thư mục trung gian"
          title={middle.map((m) => m.label).join(' › ')}
          onClick={() => setOpen((v) => !v)}
        >
          ⋯
        </button>
        {open && (
          <div className="ui-crumb-menu" role="menu" aria-label="Thư mục trung gian">
            {middle.map((item, idx) => (
              <button
                key={`${idx}-${item.label}`}
                type="button"
                role="menuitem"
                className="ui-crumb-menu-item"
                disabled={!item.onClick}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                title={item.title || item.label}
              >
                <Icon name="folder" size={14} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </span>
      <span className="ui-crumb-sep" aria-hidden="true">›</span>
      {renderCrumb(current, true)}
    </nav>
  );
}
