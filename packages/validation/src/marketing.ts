import { z } from 'zod';
import { PromoCodeType, PromotionType } from '@restor/shared-types';
import { moneySchema, timeSchema, uuidSchema } from './primitives';

/* -------------------------------------------------------------------------- */
/* Promotions (TZ §10)                                                        */
/* -------------------------------------------------------------------------- */

const promotionTypeSchema = z.nativeEnum(PromotionType);
const promoCodeTypeSchema = z.nativeEnum(PromoCodeType);

/** ISO weekdays, 1 = Monday. Empty means every day. */
const daysOfWeekSchema = z.array(z.number().int().min(1).max(7)).max(7).default([]);

const percentSchema = z
  .number()
  .int()
  .min(1, 'Foiz kamida 1 boʻlishi kerak')
  .max(100, 'Foiz 100 dan oshmaydi');

/**
 * `value` means different things per type, which is the one thing about this
 * model that is easy to get wrong: a percentage of 50 000 would give away the
 * shop, and a fixed discount of 20 would give away nothing.
 */
const promotionBase = z.object({
  name: z.string().trim().min(2, 'Nomi juda qisqa').max(255),
  description: z.string().trim().max(1000).nullish(),
  type: promotionTypeSchema,
  value: z.number().int().min(0).max(100_000_000).default(0),
  /** Caps a percentage discount. Meaningless for a fixed one. */
  maxDiscount: moneySchema.positive().nullish(),
  minOrderAmount: moneySchema.positive().nullish(),
  config: z.record(z.unknown()).default({}),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish(),
  /** Happy-hour window in the branch timezone. */
  timeFrom: timeSchema.nullish(),
  timeTo: timeSchema.nullish(),
  daysOfWeek: daysOfWeekSchema,
  /** Empty arrays mean "everywhere / everything". */
  branchIds: z.array(uuidSchema).max(100).default([]),
  productIds: z.array(uuidSchema).max(500).default([]),
  categoryIds: z.array(uuidSchema).max(100).default([]),
  /** Higher runs first; the first exclusive match stops the rest. */
  priority: z.number().int().min(0).max(1000).default(0),
  isExclusive: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

/**
 * Rules that hold for a whole promotion and for a patch of one.
 *
 * Written against optional fields so the same three checks serve both: on a
 * create everything is present, on an update only what the caller sent is
 * examined. A check that cannot be evaluated passes rather than failing — the
 * service re-runs them against the merged row, where every field is known.
 */
type PromotionShape = {
  type?: PromotionType;
  value?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
};

function withPromotionRules<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return schema
    .superRefine((raw, ctx) => {
      const v = raw as PromotionShape;

      // 50 here means "50%". Without this a manager typing 50 000 creates a
      // promotion that discounts every order to nothing.
      if (
        v.type === PromotionType.PERCENTAGE_DISCOUNT &&
        v.value !== undefined &&
        (v.value < 1 || v.value > 100)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Foizli chegirma uchun qiymat 1–100 oraligʻida boʻlishi kerak',
          path: ['value'],
        });
      }

      if (
        v.type === PromotionType.FIXED_DISCOUNT &&
        v.value !== undefined &&
        v.value <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Belgilangan chegirma noldan katta boʻlishi kerak',
          path: ['value'],
        });
      }

      if (v.startsAt && v.endsAt && new Date(v.startsAt) >= new Date(v.endsAt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Tugash sanasi boshlanishdan keyin boʻlishi kerak',
          path: ['endsAt'],
        });
      }

      // Half a window is not a window: an open-ended one would run all day,
      // which is the opposite of a happy hour.
      const hasFrom = v.timeFrom != null;
      const hasTo = v.timeTo != null;
      if (hasFrom !== hasTo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Vaqt oraligʻining ikkala chekkasini ham kiriting',
          path: ['timeTo'],
        });
      }
    }) as z.ZodEffects<T>;
}

export const createPromotionSchema = withPromotionRules(promotionBase);
export const updatePromotionSchema = withPromotionRules(promotionBase.partial());

export const promotionListQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/* -------------------------------------------------------------------------- */
/* Promo codes (TZ §10)                                                       */
/* -------------------------------------------------------------------------- */

export const createPromoCodeSchema = z
  .object({
    /**
     * Upper-cased and trimmed before storage, because a customer typing
     * "welcome10" means the same code as "WELCOME10" and being told otherwise
     * feels like a bug.
     */
    code: z
      .string()
      .trim()
      .min(3, 'Kod juda qisqa')
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, 'Kodda faqat harf, raqam, - va _ boʻlishi mumkin')
      .transform((value) => value.toUpperCase()),
    type: promoCodeTypeSchema,
    /** Percent for PERCENTAGE, minor units for FIXED, ignored for FREE_DELIVERY. */
    discount: z.number().int().min(0).max(100_000_000).default(0),
    minOrderAmount: moneySchema.positive().nullish(),
    maxDiscount: moneySchema.positive().nullish(),
    /** `null` is unlimited. */
    usageLimit: z.number().int().positive().max(1_000_000).nullish(),
    userLimit: z.number().int().positive().max(1000).nullish(),
    startsAt: z.string().datetime({ offset: true }).nullish(),
    endsAt: z.string().datetime({ offset: true }).nullish(),
    branchIds: z.array(uuidSchema).max(100).default([]),
    isActive: z.boolean().default(true),
    /** Listed on the customer's "Promo-kodlar" screen. */
    isPublic: z.boolean().default(false),
    description: z.string().trim().max(500).nullish(),
  })
  .refine(
    (v) => v.type !== PromoCodeType.PERCENTAGE || (v.discount >= 1 && v.discount <= 100),
    { message: 'Foizli kod uchun qiymat 1–100 oraligʻida boʻlishi kerak', path: ['discount'] },
  )
  .refine((v) => v.type !== PromoCodeType.FIXED || v.discount > 0, {
    message: 'Belgilangan chegirma noldan katta boʻlishi kerak',
    path: ['discount'],
  })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'Tugash sanasi boshlanishdan keyin boʻlishi kerak',
    path: ['endsAt'],
  });

export const updatePromoCodeSchema = z.object({
  // Deliberately NOT the code itself: customers already have it, and renaming
  // a live code silently breaks every link and poster carrying the old one.
  type: promoCodeTypeSchema.optional(),
  discount: z.number().int().min(0).max(100_000_000).optional(),
  minOrderAmount: moneySchema.positive().nullish(),
  maxDiscount: moneySchema.positive().nullish(),
  usageLimit: z.number().int().positive().max(1_000_000).nullish(),
  userLimit: z.number().int().positive().max(1000).nullish(),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish(),
  branchIds: z.array(uuidSchema).max(100).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  description: z.string().trim().max(500).nullish(),
});

export const promoCodeListQuerySchema = z.object({
  isActive: z.coerce.boolean().optional(),
  search: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
export type PromotionListQueryInput = z.infer<typeof promotionListQuerySchema>;
export type CreatePromoCodeInput = z.infer<typeof createPromoCodeSchema>;
export type UpdatePromoCodeInput = z.infer<typeof updatePromoCodeSchema>;
export type PromoCodeListQueryInput = z.infer<typeof promoCodeListQuerySchema>;
