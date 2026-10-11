import type { ReactNode } from 'react';
import { IconAlert, IconArrowLeft, IconMinus, IconPlus } from '@restor/ui';
import { useNav } from '../lib/nav';

/** `− 2 +` — the quantity control used on cards, in sheets and in the cart. */
export function QtyStepper({
  value,
  onDecrement,
  onIncrement,
  size = 'md',
  tone = 'muted',
  min = 0,
  incrementDisabled,
  label,
}: {
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  size?: 'sm' | 'md' | 'lg';
  /** `floating` is the white pill that sits on a product photo. */
  tone?: 'muted' | 'floating';
  min?: number;
  incrementDisabled?: boolean;
  /** What is being counted, for screen readers. */
  label?: string;
}) {
  return (
    <div className={`stepper stepper--${size} stepper--${tone}`} role="group" aria-label={label}>
      <button
        type="button"
        className="stepper__btn"
        aria-label="Kamaytirish"
        disabled={value <= min}
        onClick={(event) => {
          event.stopPropagation();
          onDecrement();
        }}
      >
        <IconMinus size={size === 'sm' ? 16 : 18} strokeWidth={2.25} />
      </button>
      <span className="stepper__value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="stepper__btn"
        aria-label="Koʻpaytirish"
        disabled={incrementDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onIncrement();
        }}
      >
        <IconPlus size={size === 'sm' ? 16 : 18} strokeWidth={2.25} />
      </button>
    </div>
  );
}

/** A screen's sticky header: back arrow, title, and optional actions. */
export function ScreenHeader({
  title,
  subtitle,
  actions,
  onBack,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Defaults to the navigator's back. */
  onBack?: () => void;
}) {
  const nav = useNav();
  return (
    <header className="screen-header">
      <button
        type="button"
        className="icon-btn"
        aria-label="Orqaga"
        onClick={onBack ?? (() => nav.back())}
      >
        <IconArrowLeft size={22} strokeWidth={2} />
      </button>
      <div className="screen-header__titles">
        <h1 className="screen-header__title">{title}</h1>
        {subtitle && <p className="screen-header__subtitle">{subtitle}</p>}
      </div>
      <div className="screen-header__actions">{actions}</div>
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <p className="empty__title">{title}</p>
      {text && <p className="empty__text">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <div className="empty__icon empty__icon--error">
        <IconAlert size={28} />
      </div>
      <p className="empty__title">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn--secondary" onClick={onRetry}>
          Qayta urinish
        </button>
      )}
    </div>
  );
}

/** Grey placeholder blocks while something loads. */
export function Skeleton({ height = 16, width = '100%', radius = 8 }: {
  height?: number | string;
  width?: number | string;
  radius?: number;
}) {
  return <span className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="list-skeleton" aria-label="Yuklanmoqda">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="list-skeleton__row">
          <Skeleton height={44} width={44} radius={12} />
          <div style={{ flex: 1, display: 'grid', gap: 8 }}>
            <Skeleton height={14} width="60%" />
            <Skeleton height={12} width="35%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A labelled toggle switch row. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
  badge,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  badge?: string;
}) {
  return (
    <label className={`switch-row${disabled ? ' switch-row--disabled' : ''}`}>
      <span className="switch-row__text">
        <span className="switch-row__label">
          {label}
          {badge && <span className="badge-soft">{badge}</span>}
        </span>
        {hint && <span className="switch-row__hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="switch"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
