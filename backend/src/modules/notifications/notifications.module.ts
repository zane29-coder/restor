import { Global, Module } from '@nestjs/common';
import { TelegramApiClient } from '../../integrations/telegram/telegram-api.client';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';

/**
 * Central notification service (TZ §38).
 *
 * Global because any module may need to notify — orders today, deliveries and
 * cash shifts next — and threading the import through each one adds noise
 * without adding clarity.
 *
 * `TelegramApiClient` is provided here rather than in the telegram module so
 * the worker can send without depending on tenant configuration code.
 */
@Global()
@Module({
  providers: [TelegramApiClient, NotificationsService, NotificationsWorker],
  exports: [NotificationsService, TelegramApiClient],
})
export class NotificationsModule {}
