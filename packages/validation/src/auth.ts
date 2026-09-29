import { z } from 'zod';
import { emailSchema, passwordSchema, phoneSchema, slugSchema, uuidSchema } from './primitives';

/**
 * Staff login (TZ §52).
 *
 * `login` accepts a phone or an email; the backend decides which by shape, so
 * a single field serves both without a radio button in the UI.
 */
export const loginSchema = z.object({
  login: z.string().trim().min(3, 'Enter your phone or email').max(255),
  password: z.string().min(1, 'Password is required').max(128),
  tenantSlug: slugSchema.optional(),
  deviceId: z.string().trim().max(128).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(16, 'Invalid refresh token'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });

/**
 * Telegram Mini App sign-in (TZ §48).
 *
 * Only the raw `initData` string is accepted — never a pre-parsed user object.
 * The backend verifies its HMAC before trusting any field inside it, so a
 * client cannot claim to be another Telegram user.
 */
export const telegramAuthSchema = z.object({
  initData: z.string().min(1, 'initData is required').max(4096),
  tenantSlug: slugSchema,
});

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2, 'Name is too short').max(120),
  phone: phoneSchema,
  email: emailSchema.optional(),
  password: passwordSchema,
  roleIds: z.array(uuidSchema).min(1, 'Assign at least one role'),
  branchIds: z.array(uuidSchema).default([]),
  position: z.string().trim().max(80).optional(),
  employeeCode: z.string().trim().max(32).optional(),
  isActive: z.boolean().default(true),
});

export const updateUserSchema = createUserSchema
  .partial()
  .omit({ password: true })
  .extend({
    /** Only set when an admin is resetting someone else's password. */
    password: passwordSchema.optional(),
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type TelegramAuthInput = z.infer<typeof telegramAuthSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
