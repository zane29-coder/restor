import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

/**
 * Promotions and promo codes (TZ §10).
 *
 * The pricing engine reads these rows directly rather than through this
 * service, which is why order pricing worked long before this module existed.
 * Nothing here is on the hot path of taking an order.
 */
@Module({
  controllers: [MarketingController],
  providers: [MarketingService],
  exports: [MarketingService],
})
export class MarketingModule {}
