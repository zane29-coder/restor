import { z } from 'zod';
import { WaiterCallType } from '@restor/shared-types';
import { uuidSchema } from './primitives';

/* -------------------------------------------------------------------------- */
/* Tables and QR service (TZ §20)                                             */
/* -------------------------------------------------------------------------- */

/**
 * A table number.
 *
 * Free text rather than an integer: real floor plans have "12a", "VIP-2" and
 * "Terrassa 3", and forcing them into numbers makes staff invent a mapping
 * they then have to remember.
 */
const tableNumberSchema = z
  .string()
  .trim()
  .min(1, 'Stol raqamini kiriting')
  .max(20);

export const createTableSchema = z.object({
  branchId: uuidSchema,
  number: tableNumberSchema,
  name: z.string().trim().max(80).nullish(),
  seats: z.number().int().positive().max(100).nullish(),
  /** A floor area: terrace, second floor, VIP. Groups the list for staff. */
  zone: z.string().trim().max(80).nullish(),
});

export const updateTableSchema = z.object({
  number: tableNumberSchema.optional(),
  name: z.string().trim().max(80).nullish(),
  seats: z.number().int().positive().max(100).nullish(),
  zone: z.string().trim().max(80).nullish(),
  isActive: z.boolean().optional(),
});

/**
 * What a guest is asking for.
 *
 * Note what the guest does NOT send: which table they are at. That comes from
 * the scanned QR token in the path, so a guest cannot call a waiter to someone
 * else's table or ring the bell for the whole floor.
 */
export const waiterCallSchema = z.object({
  type: z.nativeEnum(WaiterCallType).default(WaiterCallType.CALL_WAITER),
});

export type CreateTableInput = z.infer<typeof createTableSchema>;
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
export type WaiterCallInput = z.infer<typeof waiterCallSchema>;
