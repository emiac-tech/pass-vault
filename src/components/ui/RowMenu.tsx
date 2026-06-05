import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Floating menu that renders into document.body so it can never be clipped by
// an ancestor with overflow:hidden (e.g. .table-card, .panel-card). Flips
// upward automatically when there isn't enough room below the trigger.
export function RowMenu({
  anchor, onClose, children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; openUp: boolean } | null>(null);

  useLayoutEffect(() => {
    function place() {
      const rect = anchor.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight ?? 260;
      const menuWidth = menuRef.current?.offsetWidth ?? 200;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < menuHeight + 16;
      const top = openUp ? Math.max(8, rect.top - menuHeight - 6) : rect.bottom + 6;
      const left = Math.min(
        window.innerWidth - menuWidth - 12,
        Math.max(8, rect.right - menuWidth),
      );
      setPosition({ top, left, openUp });
    }
    place();
    const handle = () => place();
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    return () => {
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
    };
  }, [anchor]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!menuRef.current) return;
      const target = event.target as Node;
      if (menuRef.current.contains(target) || anchor.contains(target)) return;
      onClose();
    }
    function onEsc(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="row-menu floating"
      style={{
        position: 'fixed',
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? 'visible' : 'hidden',
      }}
      onClick={onClose}
    >
      {children}
    </div>,
    document.body,
  );
}
