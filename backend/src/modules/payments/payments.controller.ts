import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type Payment } from '@restor/shared-types';
import {
  createPaymentSchema,
  mixedPaymentSchema,
  refundSchema,
  startCheckoutSchema,
  suboConfigSchema,
  type CreatePaymentInput,
  type MixedPaymentInput,
  type RefundInput,
  type StartCheckoutInput,
  type SuboConfigInput,
} from '@restor/validation';
import { Public, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { PaymentsService } from './payments.service';
import { SuboService, type SuboCheckout, type SuboConfigView } from './subo.service';

/** Taking money for an order (TZ §17, §35, §36). */
@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly subo: SuboService,
  ) {}

  @Post()
  @RequirePermissions(Permission.PAYMENTS_RECEIVE)
  @ApiOperation({ summary: 'Settle an order with one tender' })
  take(@Body(zodBody(createPaymentSchema)) body: CreatePaymentInput): Promise<Payment> {
    return this.payments.take(body);
  }

  @Post('mixed')
  @RequirePermissions(Permission.PAYMENTS_RECEIVE)
  @ApiOperation({ summary: 'Settle an order with several tenders at once' })
  takeMixed(@Body(zodBody(mixedPaymentSchema)) body: MixedPaymentInput): Promise<Payment[]> {
    return this.payments.takeMixed(body);
  }

  @Post('refund')
  @RequirePermissions(Permission.PAYMENTS_REFUND)
  @ApiOperation({ summary: 'Refund against an order; a reason is required' })
  refund(@Body(zodBody(refundSchema)) body: RefundInput): Promise<Payment> {
    return this.payments.refund(body);
  }

  @Get('order/:orderId')
  @RequirePermissions(Permission.PAYMENTS_VIEW)
  listForOrder(@Param('orderId') orderId: string): Promise<Payment[]> {
    return this.payments.listForOrder(orderId);
  }

  /* ------------------------- Online (Subo) -------------------------- */

  @Get('subo/config')
  @RequirePermissions(Permission.SETTINGS_VIEW)
  @ApiOperation({ summary: 'Whether Subo is configured — never returns the key' })
  suboConfig(): Promise<SuboConfigView> {
    return this.subo.getConfig();
  }

  /**
   * Platform-only (TZ §6): the super admin opens the merchant account and
   * attaches the key, so a restaurant's own admin cannot swap it for one that
   * points payments elsewhere. They reach this through
   * `PUT platform/tenants/:id/payment-provider`, which runs it in the
   * restaurant's scope; this route stays for a platform admin acting with a
   * tenant already in context.
   */
  @Post('subo/config')
  @RequirePermissions(Permission.PAYMENT_PROVIDERS_MANAGE)
  @ApiOperation({ summary: 'Store this restaurant’s Subo API key (encrypted)' })
  saveSuboConfig(
    @Body(zodBody(suboConfigSchema)) body: SuboConfigInput,
  ): Promise<SuboConfigView> {
    return this.subo.saveConfig(body);
  }

  /**
   * Starts an online payment and returns the hosted checkout link.
   *
   * Resumes a live session rather than creating a second one, so a customer who
   * closed the tab cannot end up with two open charges for one order.
   */
  @Post('subo/checkout')
  @RequirePermissions(Permission.PAYMENTS_RECEIVE)
  @ApiOperation({ summary: 'Create or resume a Subo checkout for an order' })
  startCheckout(
    @Body(zodBody(startCheckoutSchema)) body: StartCheckoutInput,
  ): Promise<SuboCheckout> {
    return this.subo.startCheckout(body);
  }

  @Get('subo/order/:orderId')
  @RequirePermissions(Permission.PAYMENTS_VIEW)
  listCheckouts(@Param('orderId') orderId: string): Promise<Payment[]> {
    return this.subo.listCheckouts(orderId);
  }
}

/**
 * Subo's callback (TZ §36).
 *
 * Its own controller because it is the one route here with no authentication:
 * Subo has no token of ours. That is safe only because nothing is believed from
 * the body — see {@link SuboService.handleCallback}. It is used to decide which
 * payment to ask Subo about, and the answer comes from their API.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class SuboWebhookController {
  constructor(private readonly subo: SuboService) {}

  @Post('subo')
  @Public()
  // 200 with an empty body, always. Subo retries five times on a non-200, and
  // retrying an event we could not place would never start succeeding.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Subo payment callback — verified by read-back' })
  async callback(@Body() body: Record<string, unknown>): Promise<{ received: true }> {
    await this.subo.handleCallback(body);
    return { received: true };
  }
}
