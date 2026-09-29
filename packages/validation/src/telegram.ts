import { z } from 'zod';
import { telegramEventSchema } from './enums';
import { uuidSchema } from './primitives';

/** Supergroup ids are negative and long, e.g. `-1001234567890`. */
export const telegramChatIdSchema = z
  .string()
  .trim()
  .regex(/^-?\d{5,20}$/, 'Chat ID must be a numeric Telegram identifier');

/** Forum topic id (`message_thread_id`); `null` targets the General topic. */
export const telegramTopicIdSchema = z.number().int().positive().nullable();

export const telegramConfigSchema = z.object({
  branchId: uuidSchema.nullish(),
  /**
   * Write-only. Stored encrypted and never returned by the API — a leaked bot
   * token lets anyone impersonate the restaurant's bot.
   */
  botToken: z
    .string()
    .trim()
    .regex(/^\d{6,12}:[A-Za-z0-9_-]{30,}$/, 'That does not look like a bot token')
    .optional(),
  botUsername: z.string().trim().max(64).optional(),
  defaultChatId: telegramChatIdSchema.nullish(),
  isActive: z.boolean().default(true),
});

export const telegramRouteSchema = z.object({
  event: telegramEventSchema,
  chatId: telegramChatIdSchema,
  topicId: telegramTopicIdSchema.default(null),
  branchId: uuidSchema.nullish(),
  isActive: z.boolean().default(true),
});

/** Bulk editor for the "Telegram settings" screen. */
export const telegramRoutesSchema = z.object({
  routes: z.array(telegramRouteSchema).max(50),
});

export type TelegramConfigInput = z.infer<typeof telegramConfigSchema>;
export type TelegramRouteInput = z.infer<typeof telegramRouteSchema>;
