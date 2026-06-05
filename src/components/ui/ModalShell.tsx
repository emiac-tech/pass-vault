import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalShell({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const card = cardRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog on open.
    const focusables = card?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables && focusables.length ? focusables[0] : card)?.focus();

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !card) return;
      // Trap Tab focus inside the dialog.
      const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      // Restore focus to the trigger when the dialog closes.
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className={`modal-card ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={cardRef}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
