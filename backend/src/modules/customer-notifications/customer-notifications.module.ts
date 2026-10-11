import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { CustomerNotificationsService } from './customer-notifications.service';

/**
 * The customer's inbox and the bot messages that mirror it (TZ 48 §16).
 *
 * Its own module so both the storefront (reading the inbox) and marketing
 * (sending a campaign) can depend on it without depending on each other.
 * Delivery itself goes through the global NotificationsModule queue, like
 * every other Telegram message.
 */
@Module({
  imports: [TelegramModule],
  providers: [CustomerNotificationsService],
  exports: [CustomerNotificationsService],
})
export class CustomerNotificationsModule {}
