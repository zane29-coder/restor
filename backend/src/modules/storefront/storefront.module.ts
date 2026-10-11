import { Module } from '@nestjs/common';
import { NominatimClient } from '../../integrations/geocoding/nominatim.client';
import { CustomerNotificationsModule } from '../customer-notifications/customer-notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { CheckoutService } from './checkout.service';
import { CustomerProfileService } from './customer-profile.service';
import { FavoritesService } from './favorites.service';
import { MeController } from './me.controller';
import { MyOrdersService } from './my-orders.service';
import { StorefrontSettingsService } from './storefront-settings.service';
import { StorefrontController } from './storefront.controller';

/**
 * The customer side of the storefront (TZ 48): the Mini App's account,
 * address book, favourites, history, inbox and checkout, plus the
 * restaurant's storefront settings.
 *
 * Checkout goes through `OrdersService` — the one order path every client
 * uses — and online payment through `SuboService`; nothing here prices or
 * charges on its own.
 */
@Module({
  imports: [OrdersModule, PaymentsModule, CustomerNotificationsModule],
  controllers: [StorefrontController, MeController],
  providers: [
    StorefrontSettingsService,
    CustomerProfileService,
    FavoritesService,
    MyOrdersService,
    CheckoutService,
    NominatimClient,
  ],
  exports: [StorefrontSettingsService],
})
export class StorefrontModule {}
