import type { ReactNode } from 'react';
import { Icon } from '../ui';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

/** Flat minimal empty state without colored circle containers or gradients. */
export function EmptyState({ icon = 'inbox', title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty" role="status">
      <Icon name={icon} size={24} className="ui-empty-ico" />
      <h3 className="ui-empty-title">{title}</h3>
      {description && <p className="ui-empty-desc">{description}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

