import { z } from 'zod';
import { uuidSchema } from './primitives';

/* -------------------------------------------------------------------------- */
/* Reports (TZ §7, §37)                                                       */
/* -------------------------------------------------------------------------- */

/** How a timeline is bucketed. */
export const granularitySchema = z.enum(['hour', 'day', 'week', 'month']);

/**
 * A reporting window.
 *
 * Dates are plain `YYYY-MM-DD`, not timestamps: a report covers days as a
 * human means them, and the server resolves the boundaries in the branch's
 * own timezone. Accepting an instant here would invite a client to compute
 * midnight itself and get it wrong for a branch in another zone.
 */
export const reportQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD koʻrinishida boʻlsin')
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD koʻrinishida boʻlsin')
    .optional(),
  granularity: granularitySchema.default('day'),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
export type Granularity = z.infer<typeof granularitySchema>;
