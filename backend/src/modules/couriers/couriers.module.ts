import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
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
  imports: [AuthModule, OrdersModule],
  controllers: [CouriersController, CourierAppController],
  providers: [CouriersService, CourierAppService, CourierWalletService],
  exports: [CouriersService, CourierWalletService],
})
export class CouriersModule {}
