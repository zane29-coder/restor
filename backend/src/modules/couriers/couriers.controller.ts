import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HandoverStatus,
  Permission,
  type CashHandover,
  type Courier,
  type CourierTransaction,
  type CourierWallet,
  type Order,
  type Paginated,
} from '@restor/shared-types';
import {
  assignDeliverySchema,
  confirmHandoverSchema,
  courierListQuerySchema,
  createCourierSchema,
  updateCourierSchema,
  type AssignDeliveryInput,
  type ConfirmHandoverInput,
  type CourierListQueryInput,
  type CreateCourierInput,
  type UpdateCourierInput,
} from '@restor/validation';
import { RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CourierWalletService } from './courier-wallet.service';
import { CouriersService } from './couriers.service';

/** Dispatcher and finance side of delivery (TZ §23-§28). */
@ApiTags('couriers')
@Controller()
export class CouriersController {
  constructor(
    private readonly couriers: CouriersService,
    private readonly wallet: CourierWalletService,
  ) {}

  /* ---------------------------- Couriers ---------------------------- */

  @Get('couriers')
  @RequirePermissions(Permission.COURIERS_VIEW)
  @ApiOperation({ summary: 'List couriers with their wallet and current load' })
  list(
    @Query(zodBody(courierListQuerySchema)) query: CourierListQueryInput,
  ): Promise<Paginated<Courier>> {
    return this.couriers.list(query);
  }

  /**
   * Declared before `couriers/:id` so the literal path is not swallowed by the
   * parameter route.
   */
  @Get('couriers/live')
  @RequirePermissions(Permission.COURIERS_TRACK)
  @ApiOperation({ summary: 'Live positions for the dispatcher map' })
  live(@Query('branchId') branchId?: string): Promise<Courier[]> {
    return this.couriers.liveLocations(branchId);
  }

  @Get('couriers/:id')
  @RequirePermissions(Permission.COURIERS_VIEW)
  get(@Param('id') id: string): Promise<Courier> {
    return this.couriers.get(id);
  }

  @Post('couriers')
  @RequirePermissions(Permission.COURIERS_CREATE)
  @ApiOperation({ summary: 'Create a courier together with their login and wallet' })
  create(@Body(zodBody(createCourierSchema)) body: CreateCourierInput): Promise<Courier> {
    return this.couriers.create(body);
  }

  @Patch('couriers/:id')
  @RequirePermissions(Permission.COURIERS_UPDATE)
  update(
    @Param('id') id: string,
    @Body(zodBody(updateCourierSchema)) body: UpdateCourierInput,
  ): Promise<Courier> {
    return this.couriers.update(id, body);
  }

  /* --------------------------- Assignment --------------------------- */

  @Post('orders/:id/courier')
  @RequirePermissions(Permission.ORDERS_ASSIGN_COURIER)
  @ApiOperation({ summary: 'Assign a courier to a delivery order' })
  assign(
    @Param('id') orderId: string,
    @Body(zodBody(assignDeliverySchema)) body: AssignDeliveryInput,
  ): Promise<Order> {
    return this.couriers.assignToOrder(orderId, body);
  }

  @Get('orders/:id/courier-suggestions')
  @RequirePermissions(Permission.ORDERS_ASSIGN_COURIER)
  @ApiOperation({ summary: 'Couriers ranked by current load, then distance' })
  suggestions(@Param('id') orderId: string): Promise<Array<Courier & { distanceM?: number }>> {
    return this.couriers.suggestForOrder(orderId);
  }

  /* ----------------------------- Wallet ----------------------------- */

  @Get('couriers/:id/wallet')
  @RequirePermissions(Permission.COURIER_WALLET_VIEW)
  getWallet(@Param('id') id: string): Promise<CourierWallet> {
    return this.wallet.getWallet(id);
  }

  @Get('couriers/:id/wallet/transactions')
  @RequirePermissions(Permission.COURIER_WALLET_VIEW)
  transactions(
    @Param('id') id: string,
    @Query() query: { page?: number; limit?: number },
  ): Promise<Paginated<CourierTransaction>> {
    return this.wallet.listTransactions(id, query);
  }

  /* --------------------------- Handovers ---------------------------- */

  @Get('handovers')
  @RequirePermissions(Permission.COURIER_WALLET_VIEW)
  @ApiOperation({ summary: 'Cash hand-offs, pending ones first in the UI' })
  listHandovers(
    @Query()
    query: { page?: number; limit?: number; branchId?: string; courierId?: string; status?: HandoverStatus },
  ): Promise<Paginated<CashHandover>> {
    return this.wallet.listHandovers(query);
  }

  /**
   * The cashier's half of the two-sided confirmation (TZ §28).
   *
   * Until this runs, declared cash has not moved the courier's balance — it is
   * a claim, not a transfer.
   */
  @Post('handovers/:id/confirm')
  @RequirePermissions(Permission.COURIER_WALLET_SETTLE)
  @ApiOperation({ summary: 'Confirm receipt of cash from a courier' })
  confirmHandover(
    @Param('id') id: string,
    @Body(zodBody(confirmHandoverSchema)) body: ConfirmHandoverInput,
  ): Promise<CashHandover> {
    return this.wallet.confirm(id, body);
  }
}
