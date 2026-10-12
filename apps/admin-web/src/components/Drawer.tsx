import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from '@restor/ui';

/**
 * Side panel for a record's details or settings.
 *
 * These used to render as a card after the list, so on a long table clicking
 * a row appeared to do nothing — the panel opened off-screen below it. A
 * drawer opens where the user is looking and keeps the list behind it.
 */
export function Drawer({
  title,
  onClose,
  children,
  width,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** `wide` for forms with two columns; `full` for a map editor. */
  width?: 'wide' | 'full';
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Move focus into the panel, lock the page behind it, and put both back on close.
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, []);

  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className={`drawer${width === 'wide' ? ' drawer--wide' : width === 'full' ? ' drawer--full' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="drawer__header">
          <h2 id={titleId} className="drawer__title">
            {title}
          </h2>
          <button type="button" className="icon-btn" aria-label="Yopish" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </header>
        <div className="drawer__body">{children}</div>
        {footer && <footer className="drawer__foot">{footer}</footer>}
      </aside>
    </>,
    document.body,
  );
}
