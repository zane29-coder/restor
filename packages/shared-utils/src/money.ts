/**
 * Money helpers.
 *
 * Every amount in RESTOR is an INTEGER in the currency's minor unit. UZS has no
 * subunit in practice, so 156 000 UZS is stored as `156000`; USD would be
 * stored in cents. Floats never touch a price: rounding drift on a 2 000-order
 * day is a real accounting problem, and Prisma `Decimal` round-trips are
 * avoided by keeping the whole pipeline integral.
 */

import type { Currency } from '@restor/shared-types';

/** Decimal places each currency's minor unit represents. */
const CURRENCY_FRACTION_DIGITS: Record<Currency, number> = {
  UZS: 0,
  USD: 2,
};

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Throws unless `value` is a safe, non-negative integer. */
export function assertAmount(value: number, field = 'amount'): number {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${field} must be an integer in minor units, got ${value}`);
  }
  if (value < 0) {
    throw new MoneyError(`${field} must not be negative, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${field} exceeds the safe integer range`);
  }
  return value;
}

/** Adds amounts, rejecting any non-integer input. */
export function addMoney(...amounts: number[]): number {
  return amounts.reduce<number>((sum, amount) => sum + assertAmount(amount), 0);
}

/** Subtracts `b` from `a`, clamping at zero so a total can never go negative. */
export function subtractMoney(a: number, b: number): number {
  assertAmount(a, 'minuend');
  assertAmount(b, 'subtrahend');
  return Math.max(0, a - b);
}

/** Multiplies an amount by a whole quantity. */
export function multiplyMoney(amount: number, quantity: number): number {
  assertAmount(amount);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`quantity must be a non-negative integer, got ${quantity}`);
  }
  return amount * quantity;
}

/**
 * Applies a percentage discount, rounding half-up to the minor unit.
 *
 * Half-up (not banker's rounding) matches what cashiers and customers expect
 * from a printed receipt.
 */
export function applyPercentage(amount: number, percent: number): number {
  assertAmount(amount);
  if (percent < 0 || percent > 100) {
    throw new MoneyError(`percent must be between 0 and 100, got ${percent}`);
  }
  return Math.round((amount * percent) / 100);
}

/**
 * Percentage discount with an optional cap, e.g. "20% off, max 30 000 UZS".
 * Never returns more than `amount` itself.
 */
export function calculateDiscount(
  amount: number,
  percent: number,
  maxDiscount?: number | null,
): number {
  const raw = applyPercentage(amount, percent);
  const capped = maxDiscount == null ? raw : Math.min(raw, assertAmount(maxDiscount));
  return Math.min(capped, amount);
}

/**
 * Splits `amount` into `parts` shares that sum exactly back to `amount`.
 * The remainder is spread one minor unit at a time across the first shares,
 * so `splitMoney(100, 3)` is `[34, 33, 33]`, never `[33, 33, 33]`.
 */
export function splitMoney(amount: number, parts: number): number[] {
  assertAmount(amount);
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`parts must be a positive integer, got ${parts}`);
  }
  const base = Math.floor(amount / parts);
  const remainder = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Formats an amount for display, e.g. `156000` → `156 000 UZS`.
 * Uses a narrow no-break space as the group separator, matching local receipts.
 */
export function formatMoney(
  amount: number,
  currency: Currency = 'UZS',
  options: { withCurrency?: boolean; locale?: string } = {},
): string {
  const { withCurrency = true, locale = 'uz-UZ' } = options;
  const digits = CURRENCY_FRACTION_DIGITS[currency] ?? 0;
  const value = digits === 0 ? amount : amount / 10 ** digits;

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: true,
  })
    .format(value)
    // Normalise whatever separator the runtime's ICU data picks.
    .replace(/[  ,\s]/g, ' ');

  return withCurrency ? `${formatted} ${currency}` : formatted;
}

/**
 * Parses user input like `"156 000"`, `"156,000 UZS"` or `"1 234.56"` back into
 * minor units.
 *
 * The hard part is that `,` and `.` are ambiguous: in `"156,000"` the comma
 * groups thousands, in `"12,50"` it is a decimal point. The rule applied here
 * is that a separator only counts as decimal when the currency HAS a subunit
 * and the digits after it fit in that subunit. For UZS (no subunit) every
 * separator is therefore grouping — so `"156,000"` is 156 000, not 156.
 */
export function parseMoney(input: string, currency: Currency = 'UZS'): number {
  const digits = CURRENCY_FRACTION_DIGITS[currency] ?? 0;

  // Drop currency letters and whitespace, keep digits, separators and sign.
  const cleaned = input.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(cleaned)) {
    throw new MoneyError(`Cannot parse "${input}" as an amount`);
  }

  const isNegative = cleaned.startsWith('-');
  const body = cleaned.replace(/-/g, '');

  let normalised: string;
  if (digits === 0) {
    normalised = body.replace(/[.,]/g, '');
  } else {
    const lastSeparator = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));
    const fractionLength = lastSeparator === -1 ? 0 : body.length - lastSeparator - 1;
    const isDecimalPoint =
      lastSeparator !== -1 && fractionLength > 0 && fractionLength <= digits;

    normalised = isDecimalPoint
      ? `${body.slice(0, lastSeparator).replace(/[.,]/g, '')}.${body.slice(lastSeparator + 1)}`
      : body.replace(/[.,]/g, '');
  }

  const value = Number.parseFloat(normalised);
  if (Number.isNaN(value)) {
    throw new MoneyError(`Cannot parse "${input}" as an amount`);
  }

  const minor = Math.round(value * 10 ** digits);
  return isNegative ? -minor : minor;
}

/** Change to hand back, or 0 when the tendered amount does not cover the bill. */
export function calculateChange(tendered: number, total: number): number {
  assertAmount(tendered, 'tendered');
  assertAmount(total, 'total');
  return Math.max(0, tendered - total);
}
