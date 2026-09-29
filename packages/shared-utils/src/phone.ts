/**
 * Phone helpers, defaulting to Uzbek numbering (+998, 9 national digits).
 *
 * Phones are the primary login identifier and the customer's natural key, so
 * they are always persisted in E.164 — normalise on the way in, format only
 * for display.
 */

const UZ_COUNTRY_CODE = '998';
const UZ_NATIONAL_LENGTH = 9;

export class PhoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneError';
  }
}

/** Strips every character that is not a digit. */
function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Normalises user input to E.164, e.g. all of
 * `901234567`, `+998 90 123 45 67`, `8 90 123 45 67`, `998901234567`
 * become `+998901234567`.
 *
 * Returns `null` when the input cannot be a valid number, so callers can decide
 * between rejecting and ignoring.
 */
export function normalizePhone(
  input: string,
  countryCode: string = UZ_COUNTRY_CODE,
): string | null {
  if (!input) return null;

  let digits = digitsOnly(input);
  if (!digits) return null;

  if (countryCode === UZ_COUNTRY_CODE) {
    // Local trunk prefix: 8 90 … → 90 …
    if (digits.length === UZ_NATIONAL_LENGTH + 1 && digits.startsWith('8')) {
      digits = digits.slice(1);
    }
    // Bare national number.
    if (digits.length === UZ_NATIONAL_LENGTH) {
      digits = `${UZ_COUNTRY_CODE}${digits}`;
    }
    if (digits.length !== UZ_COUNTRY_CODE.length + UZ_NATIONAL_LENGTH) {
      return null;
    }
    if (!digits.startsWith(UZ_COUNTRY_CODE)) {
      return null;
    }
    return `+${digits}`;
  }

  // Other countries: accept anything of plausible E.164 length.
  if (digits.length < 8 || digits.length > 15) return null;
  if (!digits.startsWith(countryCode)) {
    digits = `${countryCode}${digits}`;
  }
  return `+${digits}`;
}

/** Like {@link normalizePhone} but throws instead of returning `null`. */
export function requirePhone(input: string, countryCode?: string): string {
  const normalised = normalizePhone(input, countryCode);
  if (!normalised) {
    throw new PhoneError(`"${input}" is not a valid phone number`);
  }
  return normalised;
}

export function isValidPhone(input: string, countryCode?: string): boolean {
  return normalizePhone(input, countryCode) !== null;
}

/** Formats E.164 for display: `+998901234567` → `+998 90 123 45 67`. */
export function formatPhone(e164: string): string {
  const digits = digitsOnly(e164);
  if (digits.startsWith(UZ_COUNTRY_CODE) && digits.length === 12) {
    const national = digits.slice(3);
    return `+${UZ_COUNTRY_CODE} ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5, 7)} ${national.slice(7, 9)}`;
  }
  return e164.startsWith('+') ? e164 : `+${digits}`;
}

/**
 * Masks a number for logs and receipts: `+998901234567` → `+998 ** *** ** 67`.
 * Customer phones are personal data and must not appear in full in logs (§59).
 */
export function maskPhone(e164: string): string {
  const digits = digitsOnly(e164);
  if (digits.length < 4) return '***';
  const country = digits.slice(0, digits.length - 9) || '';
  const last2 = digits.slice(-2);
  return `+${country} ** *** ** ${last2}`;
}
