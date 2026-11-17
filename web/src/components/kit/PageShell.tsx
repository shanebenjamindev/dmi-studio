import type { ReactNode } from 'react';
import { Icon } from '../ui';

export interface PageTabItem<T extends string = string> {
  value: T;
  label: string;
  icon?: string;
  count?: number;
}

export interface PageShellProps {
  breadcrumb?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  tabs?: ReactNode;
  toolbar?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Unified full-width page layout modeled after "Tổng task" so all non-Workspace sections share one structure. */
export function PageShell({
  breadcrumb,
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  tabs,
  toolbar,
  summary,
  children,
  className = '',
}: PageShellProps) {
  return (
    <div className={`ui-page${className ? ` ${className}` : ''}`}>
      <header className="ui-page-head">
        <div className="ui-page-head-main">
          {breadcrumb && <div className="ui-page-crumbs">{breadcrumb}</div>}
          <div className="ui-page-title-row">
            <h1 className="ui-page-title">{title}</h1>
            {subtitle && <span className="ui-page-sub">{subtitle}</span>}
          </div>
          {tabs && <div className="ui-page-tabs-row">{tabs}</div>}
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="ui-page-actions">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </header>
      {toolbar && <div className="ui-toolbar">{toolbar}</div>}
      {summary && <div className="ui-summary-strip">{summary}</div>}
      <div className="ui-page-body">{children}</div>
    </div>
  );
}

/** Flat borderless underline tabs shared across full-width pages. */
export function PageTabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: PageTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <nav className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ui-tab${active ? ' active' : ''}`}
            onClick={() => onChange(item.value)}
          >
            {item.icon && <Icon name={item.icon} size={14} />}
            <span>{item.label}</span>
            {item.count !== undefined && <em className="ui-tab-count">{item.count}</em>}
          </button>
        );
      })}
    </nav>
  );
}

