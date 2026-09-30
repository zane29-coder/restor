import { Module } from '@nestjs/common';
import { SuboApiClient } from '../../integrations/subo/subo-api.client';
import { CashModule } from '../cash/cash.module';
import { PaymentsController, SuboWebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SuboService } from './subo.service';

/**
 * Payments (TZ §17, §35, §36).
 *
 * Two controllers with different threat models, as with couriers:
 *
 *  - `PaymentsController` — the till and admin surface, permission-gated.
 *  - `SuboWebhookController` — a public route Subo posts to. It is safe to
 *    leave unauthenticated only because nothing is believed from the request
 *    body: the handler reads the real status back from Subo's API.
 *
 * `PaymentsService` is exported so couriers can record cash taken at the door
 * as a proper payment row instead of quietly incrementing an order's total.
 */
@Module({
  imports: [CashModule],
  controllers: [PaymentsController, SuboWebhookController],
  providers: [PaymentsService, SuboService, SuboApiClient],
  exports: [PaymentsService, SuboService],
})
export class PaymentsModule {}
