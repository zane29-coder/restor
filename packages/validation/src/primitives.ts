/**
 * Reusable field-level schemas.
 *
 * Defining these once means the backend pipe and the client form agree on what
 * "a valid phone" or "a valid price" is, down to the error message.
 */

import { z } from 'zod';
import { normalizePhone } from '@restor/shared-utils';

export const uuidSchema = z.string().uuid('Must be a valid UUID');

/** Accepts any local format and stores E.164 (TZ: phone is the login key). */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone is required')
  .transform((value, ctx) => {
    const normalised = normalizePhone(value);
    if (!normalised) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid phone number' });
      return z.NEVER;
    }
    return normalised;
  });

export const emailSchema = z.string().trim().toLowerCase().email('Invalid email address');

/**
 * Password policy. Deliberately length-first rather than a symbol-class maze:
 * 10+ characters with a letter and a digit is stronger in practice and far
 * less likely to be written on a sticky note next to the POS.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-zA-Z]/.test(v), 'Password must contain a letter')
  .refine((v) => /\d/.test(v), 'Password must contain a digit');

/** Money: integer minor units, never a float (see @restor/shared-utils/money). */
export const moneySchema = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .int('Amount must be an integer in minor units')
  .nonnegative('Amount must not be negative')
  .max(Number.MAX_SAFE_INTEGER, 'Amount is too large');

export const positiveMoneySchema = moneySchema.positive('Amount must be greater than zero');

export const percentSchema = z.number().min(0).max(100);

export const quantitySchema = z.number().int().positive().max(999);

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

/** `HH:mm`, 24-hour. */
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:mm format');

/** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
export const weekdaySchema = z.number().int().min(1).max(7);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, digits and hyphens');

/** Hex colour for white-label branding. */
export const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Colour must be a hex value like #FF6B00');

/** IANA timezone, validated against the runtime's own tz database. */
export const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const shortTextSchema = z.string().trim().min(1).max(255);
export const longTextSchema = z.string().trim().max(2000);

/** Pagination query, tolerant of string values coming from a query string. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().trim().max(64).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(255).optional(),
});

export type PaginationInput = z.input<typeof paginationSchema>;
export type PaginationOutput = z.output<typeof paginationSchema>;
