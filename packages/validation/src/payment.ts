import { z } from 'zod';
import { uuidSchema } from './primitives';

/* -------------------------------------------------------------------------- */
/* Online payments — Subo (TZ §9, §35, §36)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Subo aggregates these three behind one checkout. Omitting the provider lets
 * the customer choose on Subo's page, which is usually what you want — card
 * saving only works with Atmos, so naming it forces that path.
 */
export const suboProviderSchema = z.enum(['ATMOS', 'CLICK', 'PAYME']);

export const startCheckoutSchema = z.object({
  orderId: uuidSchema,
  provider: suboProviderSchema.optional(),
  /** Where Subo sends the customer back after paying. */
  returnUrl: z.string().url().max(2048).optional(),
});

/**
 * The tenant's Subo credentials.
 *
 * `apiKey` is optional so the toggle can be flipped without re-typing a key
 * the UI never displayed — Subo shows it once at creation, and it is stored
 * encrypted and never returned.
 */
export const suboConfigSchema = z
  .object({
    apiKey: z
      .string()
      .trim()
      .min(16, 'Kalit juda qisqa')
      .max(200)
      // `sk_test_` is sandbox, `sk_` is live. The server derives the mode from
      // the prefix rather than asking separately, which removes a way to point
      // a production restaurant at the sandbox by mistake.
      .regex(/^sk_/, 'Subo kaliti "sk_" bilan boshlanishi kerak')
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.apiKey !== undefined || v.isActive !== undefined, {
    message: 'Oʻzgartirish uchun kalit yoki holat kiriting',
  });

export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>;
export type SuboConfigInput = z.infer<typeof suboConfigSchema>;
export type SuboProviderInput = z.infer<typeof suboProviderSchema>;
