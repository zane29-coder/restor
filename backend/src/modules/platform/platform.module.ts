import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PlatformController } from './platform.controller';
import { TenantsService } from './tenants.service';

/**
 * `TelegramModule` and `PaymentsModule` are imported for their configuration
 * services: the platform attaches each restaurant's bot and payment key on its
 * behalf (TZ §6), and those services own the encryption and token-verification
 * that must not be duplicated here.
 */
@Module({
  imports: [AuthModule, SubscriptionsModule, TelegramModule, PaymentsModule],
  controllers: [PlatformController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class PlatformModule {}
