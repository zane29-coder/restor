import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CashModule } from '../cash/cash.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { CourierAppController } from './courier-app.controller';
import { CourierAppService } from './courier-app.service';
import { CourierWalletService } from './courier-wallet.service';
import { CouriersController } from './couriers.controller';
import { CouriersService } from './couriers.service';

/**
 * Delivery (TZ §23-§28).
 *
 * Two controllers on purpose, with different threat models:
 *
 *  - `CouriersController` — the dispatcher and finance side. Permission-gated
 *    and branch-scoped like any other admin surface.
 *  - `CourierAppController` — the mobile app. Everything is derived from the
 *    JWT's `courierId`, so it can only ever reach its own data.
 */
@Module({
  // CashModule and PaymentsModule, because a delivery paid in cash is two
  // separate money events: a payment at the door, and cash reaching a drawer
  // when the courier hands it over.
  imports: [AuthModule, OrdersModule, PaymentsModule, CashModule],
  controllers: [CouriersController, CourierAppController],
  providers: [CouriersService, CourierAppService, CourierWalletService],
  exports: [CouriersService, CourierWalletService],
})
export class CouriersModule {}
