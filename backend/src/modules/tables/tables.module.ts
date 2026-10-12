import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { TableGuestController, TablesController } from './tables.controller';
import { TablesService } from './tables.service';

/**
 * Tables and QR service (TZ §20).
 *
 * Two controllers with different threat models, as with couriers and payments:
 *
 *  - `TablesController` — staff. Permission-gated like any admin surface.
 *  - `TableGuestController` — a guest with a phone and no account. Public, and
 *    safe to be: the scanned token is the only credential, and it reaches
 *    exactly one table at one branch.
 */
@Module({
  controllers: [TablesController, TableGuestController],
  providers: [TablesService, ReservationsService],
  exports: [TablesService],
})
export class TablesModule {}
