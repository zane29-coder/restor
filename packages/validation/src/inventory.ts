import { z } from 'zod';
import { StockMovementType, StockUnit } from '@restor/shared-types';
import { moneySchema, phoneSchema, uuidSchema } from './primitives';

/* -------------------------------------------------------------------------- */
/* Inventory (TZ §29-§31)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A stock quantity.
 *
 * Three decimal places, matching the column. Accepts a number or a numeric
 * string so a client can send what it read back without converting — these
 * are NUMERIC in Postgres and arrive as strings.
 */
const quantitySchema = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const parsed = typeof value === 'number' ? value : Number(value.replace(',', '.').trim());
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Miqdor son boʻlishi kerak' });
      return z.NEVER;
    }
    return Math.round(parsed * 1000) / 1000;
  });

const positiveQuantity = quantitySchema.refine((value) => value > 0, {
  message: 'Miqdor noldan katta boʻlishi kerak',
});

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2, 'Nomi juda qisqa').max(200),
  phone: phoneSchema.nullish(),
  contact: z.string().trim().max(200).nullish(),
  comment: z.string().trim().max(500).nullish(),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createStockItemSchema = z.object({
  /** Stock lives at a branch, never pooled across them. */
  branchId: uuidSchema,
  name: z.string().trim().min(2, 'Nomi juda qisqa').max(200),
  unit: z.nativeEnum(StockUnit),
  /** Opening balance; recorded as an ADJUSTMENT so the ledger explains it. */
  quantity: quantitySchema.optional(),
  /** Reorder threshold. `null` means never flagged as low. */
  minQuantity: quantitySchema.nullish(),
  costPerUnit: moneySchema.optional(),
});

/**
 * Note what is absent: `quantity`.
 *
 * A level moves only through a movement, so there is no path that changes a
 * figure without leaving a row explaining why. Correcting one is an ADJUSTMENT
 * with a reason — which is the honest way to record that the shelf disagreed
 * with the books.
 */
export const updateStockItemSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  unit: z.nativeEnum(StockUnit).optional(),
  minQuantity: quantitySchema.nullish(),
  costPerUnit: moneySchema.optional(),
  isActive: z.boolean().optional(),
});

/**
 * A manual movement.
 *
 * CONSUMPTION is deliberately not accepted: it is written automatically when
 * an order completes, and letting a client post one by hand would let anyone
 * make stock disappear with no sale behind it.
 */
export const stockMovementSchema = z
  .object({
    stockItemId: uuidSchema,
    type: z.nativeEnum(StockMovementType).refine(
      (type) => type !== StockMovementType.CONSUMPTION,
      { message: 'Sarflash avtomatik yoziladi' },
    ),
    /** A magnitude for directional types; signed for an ADJUSTMENT. */
    quantity: quantitySchema,
    /** Purchase cost of one unit; only meaningful on a RECEIPT. */
    costPerUnit: moneySchema.optional(),
    supplierId: uuidSchema.optional(),
    comment: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => v.type === StockMovementType.ADJUSTMENT || v.quantity !== 0,
    { message: 'Miqdor noldan farq qilishi kerak', path: ['quantity'] },
  )
  .refine(
    (v) => v.type !== StockMovementType.ADJUSTMENT || v.comment !== undefined,
    {
      // An unexplained correction is the one movement nobody can audit later.
      message: 'Tuzatish uchun sabab yozilishi kerak',
      path: ['comment'],
    },
  );

export const setRecipeSchema = z.object({
  ingredients: z
    .array(
      z.object({
        stockItemId: uuidSchema,
        /** Per ONE unit of the product, in the stock item's own unit. */
        quantity: positiveQuantity,
      }),
    )
    .max(50)
    .refine(
      (lines) => new Set(lines.map((line) => line.stockItemId)).size === lines.length,
      { message: 'Bir ombor mahsuloti ikki marta kiritilgan' },
    ),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type CreateStockItemInput = z.infer<typeof createStockItemSchema>;
export type UpdateStockItemInput = z.infer<typeof updateStockItemSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export type SetRecipeInput = z.infer<typeof setRecipeSchema>;
