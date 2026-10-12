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

/**
 * What Telegram's `sendMessage` accepts as a chat: a numeric id (groups are
 * negative) or a public `@username`.
 */
const telegramChatSchema = z
  .string()
  .trim()
  .regex(/^(-?\d{5,20}|@[A-Za-z0-9_]{5,32})$/, 'Chat ID raqam (masalan -1001234567890) yoki @username boʻlsin');

const categorySchema = z.string().trim().max(60).nullish();
const skuSchema = z.string().trim().max(40).nullish();
const useByDateSchema = z.string().datetime({ offset: true }).nullish();
const batchCodeSchema = z.string().trim().max(40).nullish();

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2, 'Nomi juda qisqa').max(200),
  phone: phoneSchema.nullish(),
  contact: z.string().trim().max(200).nullish(),
  comment: z.string().trim().max(500).nullish(),
  telegramChatId: telegramChatSchema.nullish(),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createStockItemSchema = z.object({
  /** Stock lives at a branch, never pooled across them. */
  branchId: uuidSchema,
  name: z.string().trim().min(2, 'Nomi juda qisqa').max(200),
  unit: z.nativeEnum(StockUnit),
  category: categorySchema,
  sku: skuSchema,
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
  category: categorySchema,
  sku: skuSchema,
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
    /** A RECEIPT's use-by date and batch number; ignored on other types. */
    expiresAt: useByDateSchema,
    batchCode: batchCodeSchema,
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

/* -------------------------------------------------------------------------- */
/* Purchase orders and stock-takes                                            */
/* -------------------------------------------------------------------------- */

/**
 * A purchase order.
 *
 * Note what is absent: prices. The estimate is the server's, from each item's
 * last known cost; what was actually paid is entered on receipt, from the
 * supplier's invoice.
 */
export const createSupplierOrderSchema = z.object({
  branchId: uuidSchema,
  supplierId: uuidSchema,
  lines: z
    .array(z.object({ stockItemId: uuidSchema, quantity: positiveQuantity }))
    .min(1, 'Kamida bitta mahsulot qoʻshing')
    .max(100)
    .refine((lines) => new Set(lines.map((l) => l.stockItemId)).size === lines.length, {
      message: 'Bir mahsulot ikki marta kiritilgan',
    }),
  note: z.string().trim().max(500).nullish(),
  expectedAt: z.string().datetime({ offset: true }).nullish(),
});

/** What actually arrived; lines left out were not delivered. */
export const receiveSupplierOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        stockItemId: uuidSchema,
        quantity: positiveQuantity,
        /** From the supplier's invoice. */
        costPerUnit: moneySchema.optional(),
        expiresAt: useByDateSchema,
        batchCode: batchCodeSchema,
      }),
    )
    .min(1, 'Kamida bitta mahsulot qabul qilinishi kerak')
    .max(100),
});

/**
 * A stock-take: what was counted on the shelf. The server compares it with
 * the books at the moment of saving and writes the differences.
 */
export const stockTakeSchema = z.object({
  branchId: uuidSchema,
  note: z.string().trim().max(500).nullish(),
  lines: z
    .array(
      z.object({
        stockItemId: uuidSchema,
        counted: quantitySchema.refine((v) => v >= 0, { message: 'Sanoq manfiy boʻlmaydi' }),
      }),
    )
    .min(1, 'Kamida bitta mahsulot sanalishi kerak')
    .max(1000)
    .refine((lines) => new Set(lines.map((l) => l.stockItemId)).size === lines.length, {
      message: 'Bir mahsulot ikki marta sanalgan',
    }),
});

export type CreateSupplierOrderInput = z.infer<typeof createSupplierOrderSchema>;
export type ReceiveSupplierOrderInput = z.infer<typeof receiveSupplierOrderSchema>;
export type StockTakeInput = z.infer<typeof stockTakeSchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type CreateStockItemInput = z.infer<typeof createStockItemSchema>;
export type UpdateStockItemInput = z.infer<typeof updateStockItemSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export type SetRecipeInput = z.infer<typeof setRecipeSchema>;
