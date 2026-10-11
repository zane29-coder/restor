import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from '@restor/ui';
import { useOverlay } from '../lib/nav';

/**
 * Freezes the page under a sheet without losing its place.
 *
 * `overflow: hidden` alone does not stop an iOS WebView from scrolling the
 * page behind, so the body is pinned at its current offset and put back
 * exactly there on close. Reference-counted for a dialog over a sheet.
 */
let locks = 0;
let savedScrollY = 0;

function lockScroll(): () => void {
  if (locks === 0) {
    savedScrollY = window.scrollY;
    const body = document.body.style;
    body.position = 'fixed';
    body.top = `-${savedScrollY}px`;
    body.left = '0';
    body.right = '0';
  }
  locks += 1;

  return () => {
    locks -= 1;
    if (locks === 0) {
      const body = document.body.style;
      body.position = '';
      body.top = '';
      body.left = '';
      body.right = '';
      window.scrollTo(0, savedScrollY);
    }
  };
}

export function useScrollLock(active: boolean): void {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}

/** How far down (px) a release must be to count as "close". */
const CLOSE_DISTANCE = 110;
/** Or how fast (px/ms) a flick must be. */
const CLOSE_VELOCITY = 0.6;

/**
 * A sheet that rises from the bottom (product details, the profile gate).
 *
 * Tall but not full-screen, with a drag handle and a ✕. Swiping down closes
 * it — from the handle always, and from the content only when the content is
 * already scrolled to the top, so scrolling a long list of options never
 * turns into closing the sheet. "Back" (Telegram's button, Android's gesture,
 * the browser) closes it too, through the navigator.
 */
export function BottomSheet({
  open,
  onClose,
  children,
  footer,
  label,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Accessible name of the dialog. */
  label: string;
  className?: string;
}) {
  useOverlay(open, onClose);
  useScrollLock(open);

  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startTime: number; fromContent: boolean } | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (open) setOffset(0);
  }, [open]);

  if (!open) return null;

  const begin = (clientY: number, fromContent: boolean) => {
    if (fromContent && (bodyRef.current?.scrollTop ?? 0) > 0) return;
    drag.current = { startY: clientY, startTime: Date.now(), fromContent };
  };

  // React's touch listeners are passive, so the content cannot be stopped
  // from scrolling here; `overscroll-behavior: contain` on the body keeps a
  // downward pull at the top from bouncing the page instead.
  const move = (clientY: number) => {
    const state = drag.current;
    if (!state) return;
    const delta = clientY - state.startY;
    if (delta <= 0) {
      // Upward from the content is a scroll, not a drag.
      if (state.fromContent) drag.current = null;
      setOffset(0);
      return;
    }
    if (!dragging) setDragging(true);
    setOffset(delta);
  };

  const end = () => {
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    if (!state) return;
    const elapsed = Math.max(1, Date.now() - state.startTime);
    if (offset > CLOSE_DISTANCE || offset / elapsed > CLOSE_VELOCITY) {
      onClose();
    } else {
      setOffset(0);
    }
  };

  return createPortal(
    <div className="sheet-layer" role="presentation">
      <div className="sheet-backdrop" onClick={onClose} style={{ opacity: Math.max(0, 1 - offset / 400) }} />
      <div
        ref={sheetRef}
        className={`sheet${className ? ` ${className}` : ''}${dragging ? ' sheet--dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
      >
        <div
          className="sheet__grip"
          onTouchStart={(event) => begin(event.touches[0]!.clientY, false)}
          onTouchMove={(event) => move(event.touches[0]!.clientY)}
          onTouchEnd={end}
          onMouseDown={(event) => begin(event.clientY, false)}
          onMouseMove={(event) => event.buttons === 1 && move(event.clientY)}
          onMouseUp={end}
        >
          <span className="sheet__handle" />
        </div>

        <button type="button" className="sheet__close" aria-label="Yopish" onClick={onClose}>
          <IconClose size={20} strokeWidth={2} />
        </button>

        <div
          ref={bodyRef}
          className="sheet__body"
          onTouchStart={(event) => begin(event.touches[0]!.clientY, true)}
          onTouchMove={(event) => move(event.touches[0]!.clientY)}
          onTouchEnd={end}
        >
          {children}
        </div>

        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A small centred question: "Savatni tozalaysizmi?". */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  text?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useOverlay(open, onCancel);
  useScrollLock(open);
  if (!open) return null;

  return createPortal(
    <div className="dialog-layer" role="presentation">
      <div className="sheet-backdrop" onClick={onCancel} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog__title">{title}</h2>
        {text && <p className="dialog__text">{text}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Bekor qilish
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
