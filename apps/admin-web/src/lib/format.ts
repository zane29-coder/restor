import { formatMoney } from '@restor/shared-utils';

/**
 * Display helpers for the admin screens.
 *
 * Money arrives as integer minor units (UZS has none, so `156000` is
 * 156 000 soʻm) and is only ever formatted here — never computed.
 */

/** `156 000 soʻm`. */
export function som(amount: number): string {
  return `${formatMoney(amount, 'UZS', { withCurrency: false })} soʻm`;
}

/** `156 000` — for cells where the column header already says soʻm. */
export function amount(value: number): string {
  return formatMoney(value, 'UZS', { withCurrency: false });
}

/** `21,4 mln` / `845 ming` — for tight spots like chart labels and rankings. */
export function compactSom(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)} mlrd`;
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)} mln`;
  if (abs >= 10_000) return `${trim(value / 1_000)} ming`;
  return amount(value);
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '').replace('.', ',');
}

/** `1 234`. */
export function count(value: number): string {
  return new Intl.NumberFormat('uz-UZ').format(value).replace(/[  ,\s]/g, ' ');
}

/**
 * `"14.200"` → `"14,2"`, `"100.000"` → `"100"`.
 *
 * Stock quantities arrive as decimal strings (NUMERIC in Postgres) and stay
 * strings: only the trailing fractional zeros are trimmed, never parsed.
 */
export function qty(value: string | null | undefined): string {
  if (!value) return '0';
  const trimmed = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return trimmed.replace('.', ',');
}

/** `14,2%`; `null` renders as an em dash rather than a misleading zero. */
export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits).replace(/\.0+$/, '').replace('.', ',')}%`;
}

/** Two letters for an avatar: "Nargiza Alimova" → "NA". */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `19:42`. */
export function timeOf(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `24.10.2026`. */
export function dateOf(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** `24.10.2026 19:42`. */
export function dateTimeOf(iso: string | Date): string {
  return `${dateOf(iso)} ${timeOf(iso)}`;
}

/** `Bugun 19:42`, `Kecha 18:10`, or the date for anything older. */
export function dayTimeOf(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Bugun ${timeOf(d)}`;
  if (d.toDateString() === yesterday.toDateString()) return `Kecha ${timeOf(d)}`;
  return dateOf(d);
}

/** `6 daq oldin`, `2 soat oldin`, `3 kun oldin`. */
export function ago(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'hozirgina';
  if (minutes < 60) return `${minutes} daq oldin`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  return `${Math.floor(hours / 24)} kun oldin`;
}

/** Whole minutes between two instants, never negative. */
export function minutesBetween(from: string, to: string | Date = new Date()): number {
  const end = typeof to === 'string' ? new Date(to) : to;
  return Math.max(0, Math.round((end.getTime() - new Date(from).getTime()) / 60_000));
}

/** `YYYY-MM-DD` in local time — the shape the reports API takes. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight `days` days ago (0 = today). */
export function daysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}
