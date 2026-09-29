import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramNotifierService } from './telegram-notifier.service';
import { TelegramService } from './telegram.service';

/**
 * Telegram configuration, routing and notification (TZ §14, §15).
 *
 * `TelegramApiClient` and `NotificationsService` come from the global
 * NotificationsModule — the worker needs the client without needing this
 * module's tenant-configuration code.
 */
@Module({
  controllers: [TelegramController],
  providers: [TelegramService, TelegramNotifierService],
  exports: [TelegramService],
})
export class TelegramModule {}
