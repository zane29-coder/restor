import { z } from 'zod';
import { cashTransactionTypeSchema } from './enums';
import { moneySchema, uuidSchema } from './primitives';

/* -------------------------------------------------------------------------- */
/* Cash register & shifts (TZ §19)                                            */
/* -------------------------------------------------------------------------- */

export const createCashRegisterSchema = z.object({
  branchId: uuidSchema,
  name: z.string().trim().min(2, 'Kassa nomi juda qisqa').max(80),
  /** Stable terminal id, used to enforce the plan's POS-terminal limit. */
  deviceId: z.string().trim().max(128).nullish(),
});

export const openShiftSchema = z.object({
  branchId: uuidSchema,
  /**
   * Optional: with one register per branch — the normal case — the server
   * resolves it. A cashier should never be blocked at opening time by a setup
   * row nobody created.
   */
  cashRegisterId: uuidSchema.optional(),
  /** The float counted into the drawer. Zero is valid. */
  openingCash: moneySchema.default(0),
});

export const closeShiftSchema = z.object({
  /**
   * What the cashier physically counted.
   *
   * Zero is allowed and meaningful — an empty drawer is a real state, and
   * rejecting it would push cashiers into typing a fake number.
   */
  actualCash: moneySchema,
  comment: z.string().trim().max(500).optional(),
});

/**
 * A manual drawer movement.
 *
 * Only the two manual types: SALE, REFUND, COURIER_HANDOVER, OPENING_FLOAT and
 * WITHDRAWAL are written by the flows that cause them, and letting a client
 * post them directly would let anyone invent takings.
 */
export const cashTransactionSchema = z.object({
  type: cashTransactionTypeSchema.refine(
    (type) => type === 'CASH_IN' || type === 'CASH_OUT',
    { message: 'Faqat CASH_IN yoki CASH_OUT qoʻlda kiritiladi' },
  ),
  amount: moneySchema.positive('Summa noldan katta boʻlishi kerak'),
  comment: z.string().trim().max(500).optional(),
});

export type CreateCashRegisterInput = z.infer<typeof createCashRegisterSchema>;
export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
export type CashTransactionInput = z.infer<typeof cashTransactionSchema>;
