import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

/**
 * Cash register and shifts (TZ §19).
 *
 * Exported because two other modules write into a shift: payments records a
 * sale, and the courier hand-off records cash arriving in the drawer. Neither
 * may update the totals itself — `CashService.record` is the single writer, so
 * a movement can never land without moving the shift with it.
 */
@Module({
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
