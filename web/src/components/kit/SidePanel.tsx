import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  header?: ReactNode;
  actions?: ReactNode;
  mode?: 'popup' | 'panel';
  width?: number;
  children: ReactNode;
}

/** Unified detail container supporting centered popup overlay (default for Task Details) and right-hand slide panel. */
export function SidePanel({
  open,
  onClose,
  title = 'Chi tiết',
  header,
  actions,
  mode = 'popup',
  width,
  children,
}: SidePanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog.qc-dialog[open], dialog.ask-modal[open], dialog.tf-modal[open], .bk-pop, .task-editor-back')) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={`ui-overlay ui-overlay-${mode}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`ui-panel ui-panel-${mode}`}
        style={width && mode === 'panel' ? { width: `min(${width}px, 100vw)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {(header || actions) && (
          <header className="ui-panel-head">
            <div className="ui-panel-title">{header || <h2>{title}</h2>}</div>
            <div className="ui-panel-actions">
              {actions}
              <button type="button" className="ui-icon-close" onClick={onClose} aria-label="Đóng" title="Đóng (Esc)">
                <Icon name="x" size={16} />
              </button>
            </div>
          </header>
        )}
        <div className="ui-panel-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

