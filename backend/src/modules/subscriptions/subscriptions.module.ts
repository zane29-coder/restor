import { Module } from '@nestjs/common';
import { SubscriptionLimitsService } from './subscription-limits.service';

@Module({
  providers: [SubscriptionLimitsService],
  exports: [SubscriptionLimitsService],
})
export class SubscriptionsModule {}
