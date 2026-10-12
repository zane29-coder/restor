import { z } from 'zod';
import { emailSchema, uuidSchema } from './primitives';

/* -------------------------------------------------------------------------- */
/* Customers (TZ §10)                                                         */
/* -------------------------------------------------------------------------- */

export const customerListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  // Not `z.coerce.boolean()`: that turns the query string "false" into true.
  isBlocked: z
    .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
    .optional(),
  /** See `CustomerSegment` for what each one means. */
  segment: z.enum(['NEW', 'VIP', 'FREQUENT', 'INACTIVE_30D', 'TOP_SPENDER']).optional(),
  sort: z.enum(['recent', 'spent', 'orders']).default('recent'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/**
 * What staff may change about a customer.
 *
 * Note what is absent: the phone number. It identifies the customer, links
 * their order history and is how the Telegram account was matched — editing
 * it would silently graft one person's history onto another.
 */
export const updateCustomerSchema = z.object({
  fullName: z.string().trim().min(2, 'Ism juda qisqa').max(120).nullish(),
  email: emailSchema.nullish(),
  /** `YYYY-MM-DD`; drives birthday campaigns. */
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD koʻrinishida boʻlsin')
    .nullish(),
  language: z.string().trim().max(10).optional(),
  notes: z.string().trim().max(1000).nullish(),
});

export const blockCustomerSchema = z.object({
  /** Recorded on the audit entry — the one thing anyone asks about later. */
  reason: z.string().trim().max(500).optional(),
});

/* -------------------------------------------------------------------------- */
/* Loyalty (TZ §10)                                                           */
/* -------------------------------------------------------------------------- */

export const loyaltyProgramSchema = z
  .object({
    isActive: z.boolean().optional(),
    /** Share of a bill returned as points. */
    cashbackPercent: z.number().int().min(0).max(50).optional(),
    /** What one point is worth in soʻm when spent. */
    pointValue: z.number().int().positive().max(1_000_000).optional(),
    /** The share of a bill points may cover. */
    maxRedeemPercent: z.number().int().min(0).max(100).optional(),
    /** `null` means points never expire. */
    expiryDays: z.number().int().positive().max(3650).nullish(),
    referralBonus: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'Oʻzgartirish uchun kamida bitta maydon kiriting',
  });

export const redeemPointsSchema = z.object({
  customerId: uuidSchema,
  points: z.number().int().positive(),
});

export type CustomerListQueryInput = z.infer<typeof customerListQuerySchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type BlockCustomerInput = z.infer<typeof blockCustomerSchema>;
export type LoyaltyProgramInput = z.infer<typeof loyaltyProgramSchema>;
export type RedeemPointsInput = z.infer<typeof redeemPointsSchema>;
