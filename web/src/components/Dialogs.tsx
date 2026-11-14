import { useEffect, useRef } from 'react';
import { IconButton } from './ui';

export function Sheet({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: any; wide?: boolean; footer?: any }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={'sheet' + (wide ? ' wide' : '')} onClose={onClose} onCancel={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="sheet-in">
          <header className="sheet-h"><h2>{title}</h2><IconButton icon="x" label="Đóng" size={16} className="close" onClick={onClose} /></header>
          <div className="sheet-body">{children}</div>
          {footer && <footer className="sheet-f">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
