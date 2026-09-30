import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/**
 * Customers and loyalty (TZ §10).
 *
 * The service listens for order completion rather than being called from the
 * order path, so an order never waits on loyalty and never fails because of
 * it. Points are a courtesy; the sale is not.
 */
@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
