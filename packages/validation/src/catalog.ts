import { z } from 'zod';
import { moneySchema, shortTextSchema, longTextSchema, uuidSchema } from './primitives';

export const createCategorySchema = z.object({
  name: shortTextSchema,
  parentId: uuidSchema.nullish(),
  description: longTextSchema.optional(),
  imageUrl: z.string().url().max(2048).nullish(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const updateCategorySchema = createCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const productVariantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Signed: a Small size may be cheaper than the base price. */
  priceDelta: z.number().int().max(Number.MAX_SAFE_INTEGER),
  sku: z.string().trim().max(64).optional(),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const createProductSchema = z
  .object({
    categoryId: uuidSchema,
    name: shortTextSchema,
    description: longTextSchema.optional(),
    imageUrl: z.string().url().max(2048).nullish(),
    price: moneySchema,
    discountPrice: moneySchema.nullish(),
    preparationTime: z.number().int().min(0).max(240).default(10),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    variants: z.array(productVariantSchema).max(20).optional(),
    modifierGroupIds: z.array(uuidSchema).max(20).optional(),
    /** Branches the product is offered at; empty means every branch. */
    branchIds: z.array(uuidSchema).optional(),
  })
  .refine((v) => v.discountPrice == null || v.discountPrice < v.price, {
    message: 'Discount price must be lower than the regular price',
    path: ['discountPrice'],
  })
  .refine(
    (v) => !v.variants || v.variants.filter((variant) => variant.isDefault).length <= 1,
    { message: 'Only one variant may be the default', path: ['variants'] },
  );

export const updateProductSchema = z.object({
  categoryId: uuidSchema.optional(),
  name: shortTextSchema.optional(),
  description: longTextSchema.nullish(),
  imageUrl: z.string().url().max(2048).nullish(),
  price: moneySchema.optional(),
  discountPrice: moneySchema.nullish(),
  preparationTime: z.number().int().min(0).max(240).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  modifierGroupIds: z.array(uuidSchema).max(20).optional(),
});

export const modifierSchema = z.object({
  name: z.string().trim().min(1).max(80),
  price: moneySchema,
  sortOrder: z.number().int().min(0).max(999).default(0),
});

/**
 * Kept separate from the refined schema below so `.partial()` stays available:
 * `.refine()` returns a `ZodEffects`, which has no `.partial()`.
 */
const modifierGroupBase = z.object({
  name: shortTextSchema,
  minSelect: z.number().int().min(0).max(50).default(0),
  maxSelect: z.number().int().min(1).max(50).default(1),
  sortOrder: z.number().int().min(0).max(999).default(0),
  modifiers: z.array(modifierSchema).min(1, 'Add at least one modifier').max(50),
});

export const createModifierGroupSchema = modifierGroupBase
  .refine((v) => v.minSelect <= v.maxSelect, {
    message: 'minSelect cannot exceed maxSelect',
    path: ['minSelect'],
  })
  .refine((v) => v.maxSelect <= v.modifiers.length, {
    message: 'maxSelect cannot exceed the number of modifiers',
    path: ['maxSelect'],
  });

/** Partial edit of a modifier group; cross-field rules re-check on save. */
export const updateModifierGroupSchema = modifierGroupBase.partial();

/** Per-branch availability / stop-list toggle. */
export const updateProductAvailabilitySchema = z.object({
  branchId: uuidSchema,
  isAvailable: z.boolean().optional(),
  isStopListed: z.boolean().optional(),
  priceOverride: moneySchema.nullish(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateModifierGroupInput = z.infer<typeof createModifierGroupSchema>;
export type UpdateModifierGroupInput = z.infer<typeof updateModifierGroupSchema>;
