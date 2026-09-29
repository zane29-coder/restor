import { z } from 'zod';
import { currencySchema, tenantStatusSchema } from './enums';
import {
  colorSchema,
  emailSchema,
  passwordSchema,
  phoneSchema,
  slugSchema,
  timezoneSchema,
  uuidSchema,
} from './primitives';

export const brandingSchema = z.object({
  logoUrl: z.string().url().max(2048).nullish(),
  faviconUrl: z.string().url().max(2048).nullish(),
  primaryColor: colorSchema.default('#FF6B00'),
  secondaryColor: colorSchema.default('#1F2937'),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(255)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Enter a bare domain, without https://')
    .nullish(),
  companyName: z.string().trim().max(120).nullish(),
});

/**
 * Creating a tenant also provisions its first owner in one transaction —
 * a company without an owner account cannot be logged into, so the two are
 * never separate steps (TZ §6).
 */
export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema.optional(),
  legalName: z.string().trim().max(200).optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  currency: currencySchema.default('UZS'),
  timezone: timezoneSchema.default('Asia/Tashkent'),
  locale: z.string().trim().max(10).default('uz'),
  branding: brandingSchema.partial().optional(),
  planId: uuidSchema.optional(),
  owner: z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: phoneSchema,
    email: emailSchema.optional(),
    password: passwordSchema,
  }),
});

export const updateTenantSchema = createTenantSchema
  .omit({ owner: true, slug: true, planId: true })
  .partial()
  .extend({
    status: tenantStatusSchema.optional(),
  });

export const blockTenantSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason — it is written to the audit log').max(500),
});

export const planLimitsSchema = z.object({
  maxBranches: z.number().int().positive().nullable().default(null),
  maxEmployees: z.number().int().positive().nullable().default(null),
  maxPosTerminals: z.number().int().positive().nullable().default(null),
  maxBots: z.number().int().positive().nullable().default(null),
  maxStorageMb: z.number().int().positive().nullable().default(null),
});

export const createPlanSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(32),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  price: z.number().int().nonnegative(),
  currency: currencySchema.default('UZS'),
  periodDays: z.number().int().positive().max(3650).default(30),
  limits: planLimitsSchema,
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const assignSubscriptionSchema = z.object({
  planId: uuidSchema,
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  /** Overrides the plan's limits for this tenant only. */
  limits: planLimitsSchema.partial().optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type AssignSubscriptionInput = z.infer<typeof assignSubscriptionSchema>;
