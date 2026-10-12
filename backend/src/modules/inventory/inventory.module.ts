import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ProcurementService } from './procurement.service';

/**
 * Inventory (TZ §29-§31).
 *
 * Listens for order completion rather than being called from the order path.
 * A kitchen that cannot finish a sale because the inventory module is unhappy
 * is a worse outcome than a stock figure that needs a stock-take, so every
 * deduction failure is logged and swallowed.
 *
 * Imports Telegram for one thing: posting purchase orders to a supplier's
 * chat through the restaurant's own bot.
 */
@Module({
  imports: [TelegramModule],
  controllers: [InventoryController],
  providers: [InventoryService, ProcurementService],
  exports: [InventoryService],
})
export class InventoryModule {}
