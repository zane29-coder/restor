/**
 * Design tokens.
 *
 * Exported as plain data rather than CSS so the same values drive Tailwind
 * configs, inline styles and the React Native courier app. Each web app turns
 * them into CSS custom properties at boot — and a white-label tenant overrides
 * `primary` at runtime without a rebuild (TZ §49).
 */

export const colors = {
  /** Overridden per tenant by `TenantBranding.primaryColor`. */
  primary: '#FF6B00',
  primaryDark: '#D95A00',
  primaryLight: '#FFF1E6',
  secondary: '#1F2937',

  success: '#16A34A',
  successLight: '#DCFCE7',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  danger: '#DC2626',
  dangerLight: '#FEE2E2',
  info: '#2563EB',
  infoLight: '#DBEAFE',

  text: '#111827',
  textMuted: '#6B7280',
  textInverse: '#FFFFFF',

  background: '#F9FAFB',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F4F6',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
} as const;

/** Colour per order status — one definition for every screen that shows one. */
export const orderStatusColors: Record<string, { bg: string; fg: string; label: string }> = {
  NEW: { bg: '#DBEAFE', fg: '#1E40AF', label: 'New' },
  ACCEPTED: { bg: '#E0E7FF', fg: '#3730A3', label: 'Accepted' },
  PREPARING: { bg: '#FEF3C7', fg: '#92400E', label: 'Preparing' },
  READY: { bg: '#DCFCE7', fg: '#166534', label: 'Ready' },
  WAITING_COURIER: { bg: '#FFEDD5', fg: '#9A3412', label: 'Waiting courier' },
  COURIER_ASSIGNED: { bg: '#FFE4E6', fg: '#9F1239', label: 'Courier assigned' },
  ON_DELIVERY: { bg: '#CFFAFE', fg: '#155E75', label: 'On delivery' },
  DELIVERED: { bg: '#DCFCE7', fg: '#14532D', label: 'Delivered' },
  CANCELLED: { bg: '#FEE2E2', fg: '#991B1B', label: 'Cancelled' },
  REFUNDED: { bg: '#F3E8FF', fg: '#6B21A8', label: 'Refunded' },
};

/**
 * KDS urgency bands (TZ §21): green under 10 min, amber to 20, red beyond.
 * Colours are chosen to stay distinguishable for red-green colour blindness —
 * the card also carries the elapsed time in text, never colour alone.
 */
export const kdsUrgencyColors = {
  normal: { bg: '#DCFCE7', border: '#16A34A', fg: '#14532D' },
  warning: { bg: '#FEF3C7', border: '#F59E0B', fg: '#78350F' },
  critical: { bg: '#FEE2E2', border: '#DC2626', fg: '#7F1D1D' },
} as const;

export type KdsUrgency = keyof typeof kdsUrgencyColors;

/** Picks the urgency band for a ticket's age. */
export function kdsUrgencyFor(elapsedSeconds: number): KdsUrgency {
  const minutes = elapsedSeconds / 60;
  if (minutes < 10) return 'normal';
  if (minutes < 20) return 'warning';
  return 'critical';
}

/** 4px base scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const fontSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  /** POS and KDS read from a metre away; they use the display sizes. */
  display: 48,
} as const;

/**
 * Minimum hit target for the POS and KDS. 56px, above the 44px accessibility
 * floor, because these are used at speed with gloved or wet hands (TZ §17).
 */
export const touchTargetPx = 56;

export const shadows = {
  sm: '0 1px 2px rgba(17, 24, 39, 0.06)',
  md: '0 4px 12px rgba(17, 24, 39, 0.08)',
  lg: '0 12px 32px rgba(17, 24, 39, 0.12)',
} as const;

export const zIndex = {
  dropdown: 1000,
  sticky: 1100,
  modal: 1300,
  toast: 1400,
} as const;

/** Emits the tokens as CSS custom properties for an app's `:root`. */
export function cssVariables(overrides: Partial<typeof colors> = {}): string {
  const merged = { ...colors, ...overrides };
  const lines = Object.entries(merged).map(
    ([key, value]) => `  --restor-${kebab(key)}: ${value};`,
  );
  return `:root {\n${lines.join('\n')}\n}`;
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}
