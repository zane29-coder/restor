import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramController } from './telegram.controller';
import { TelegramNotifierService } from './telegram-notifier.service';
import { TelegramService } from './telegram.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';

/**
 * Telegram configuration, routing, notification and the bot itself
 * (TZ §14, §15).
 *
 * Both directions live here:
 *   - outbound — `TelegramNotifierService` turns domain events into messages
 *     in a staff group;
 *   - inbound — `TelegramWebhookController` receives updates and
 *     `TelegramBotService` answers them.
 *
 * `TelegramWebhookService` sits between the two: it owns the webhook URL and
 * its secret, so registration and verification cannot drift apart.
 *
 * `TelegramApiClient` and `NotificationsService` come from the global
 * NotificationsModule — the worker needs the client without needing this
 * module's tenant-configuration code.
 */
@Module({
  controllers: [TelegramController, TelegramWebhookController],
  providers: [
    TelegramService,
    TelegramNotifierService,
    TelegramWebhookService,
    TelegramBotService,
  ],
  exports: [TelegramService],
})
export class TelegramModule {}
