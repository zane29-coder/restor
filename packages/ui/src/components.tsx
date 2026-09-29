import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { colors, orderStatusColors, radii, spacing, touchTargetPx } from './tokens';
import { cn } from './utils';

/**
 * Only genuinely shared primitives live here.
 *
 * Anything that differs between the admin panel and the POS — tables, layouts,
 * navigation — stays in its own app. A "shared" component bent to serve both a
 * mouse-driven dashboard and a gloved-hand touchscreen ends up serving
 * neither (TZ §71).
 */

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'touch';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
}

const buttonVariantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: colors.primary, color: colors.textInverse, border: 'none' },
  secondary: {
    background: colors.surface,
    color: colors.text,
    border: `1px solid ${colors.borderStrong}`,
  },
  ghost: { background: 'transparent', color: colors.text, border: 'none' },
  danger: { background: colors.danger, color: colors.textInverse, border: 'none' },
};

const buttonSizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: `${spacing.xs}px ${spacing.sm}px`, fontSize: 13, minHeight: 32 },
  md: { padding: `${spacing.sm}px ${spacing.md}px`, fontSize: 14, minHeight: 40 },
  lg: { padding: `${spacing.sm}px ${spacing.lg}px`, fontSize: 16, minHeight: 48 },
  /** For POS and KDS: a target you can hit reliably without looking. */
  touch: {
    padding: `${spacing.md}px ${spacing.lg}px`,
    fontSize: 18,
    minHeight: touchTargetPx,
    fontWeight: 600,
  },
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  leftIcon,
  disabled,
  children,
  className,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || isLoading;

  return (
    <button
      type="button"
      {...rest}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      className={cn('restor-button', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        borderRadius: radii.md,
        fontWeight: 500,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        width: fullWidth ? '100%' : undefined,
        transition: 'opacity 120ms ease, transform 120ms ease',
        ...buttonVariantStyles[variant],
        ...buttonSizeStyles[size],
        ...style,
      }}
    >
      {isLoading ? <Spinner size={16} /> : leftIcon}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Validation message; also sets `aria-invalid` for assistive tech. */
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className, style, ...rest }: InputProps) {
  const inputId = id ?? rest.name ?? undefined;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn('restor-field', className)} style={{ display: 'grid', gap: spacing.xs }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
          {label}
        </label>
      )}
      <input
        {...rest}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        style={{
          padding: `${spacing.sm}px ${spacing.md}px`,
          borderRadius: radii.md,
          border: `1px solid ${error ? colors.danger : colors.border}`,
          fontSize: 14,
          color: colors.text,
          background: colors.surface,
          outlineColor: colors.primary,
          ...style,
        }}
      />
      {error ? (
        <span id={`${inputId}-error`} style={{ fontSize: 12, color: colors.danger }}>
          {error}
        </span>
      ) : hint ? (
        <span id={`${inputId}-hint`} style={{ fontSize: 12, color: colors.textMuted }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

export interface BadgeProps {
  children: ReactNode;
  bg?: string;
  fg?: string;
  className?: string;
}

export function Badge({ children, bg = colors.surfaceAlt, fg = colors.text, className }: BadgeProps) {
  return (
    <span
      className={cn('restor-badge', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: `2px ${spacing.sm}px`,
        borderRadius: radii.full,
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** Order status pill using the shared status palette. */
export function OrderStatusBadge({ status }: { status: string }) {
  const tone = orderStatusColors[status] ?? { bg: colors.surfaceAlt, fg: colors.text, label: status };
  return (
    <Badge bg={tone.bg} fg={tone.fg}>
      {tone.label}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* Card, Spinner, EmptyState                                                  */
/* -------------------------------------------------------------------------- */

export interface CardProps {
  children: ReactNode;
  padding?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Card({ children, padding = spacing.md, className, style }: CardProps) {
  return (
    <div
      className={cn('restor-card', className)}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.lg,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Spinner({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="status"
      aria-label="Loading"
      style={{ animation: 'restor-spin 0.8s linear infinite' }}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeOpacity={0.25} strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Keyframes the spinner needs; inject once per app. */
export const spinnerKeyframes = '@keyframes restor-spin { to { transform: rotate(360deg); } }';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ textAlign: 'center', padding: spacing['2xl'], color: colors.textMuted }}>
      <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: colors.text }}>{title}</p>
      {description && <p style={{ margin: `${spacing.sm}px 0 0`, fontSize: 14 }}>{description}</p>}
      {action && <div style={{ marginTop: spacing.md }}>{action}</div>}
    </div>
  );
}
