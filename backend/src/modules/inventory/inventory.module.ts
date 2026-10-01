import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * Inventory (TZ §29-§31).
 *
 * Listens for order completion rather than being called from the order path.
 * A kitchen that cannot finish a sale because the inventory module is unhappy
 * is a worse outcome than a stock figure that needs a stock-take, so every
 * deduction failure is logged and swallowed.
 */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
