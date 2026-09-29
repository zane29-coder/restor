import { Module } from '@nestjs/common';
import { OrderNumberService } from './order-number.service';
import { OrderPricingService } from './order-pricing.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrderPricingService, OrderNumberService],
  exports: [OrdersService, OrderPricingService, OrderNumberService],
})
export class OrdersModule {}
