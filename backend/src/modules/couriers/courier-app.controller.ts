import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type CashHandover,
  type CourierJob,
  type CourierProfile,
  type CourierStatus,
  type CourierTransaction,
  type CourierWallet,
  type Paginated,
} from '@restor/shared-types';
import {
  completeDeliverySchema,
  courierStatusUpdateSchema,
  declareHandoverSchema,
  failDeliverySchema,
  reportLocationSchema,
  updateCourierProfileSchema,
  type CompleteDeliveryInput,
  type DeclareHandoverInput,
  type ReportLocationInput,
  type UpdateCourierProfileInput,
} from '@restor/validation';
import { Ctx, RequirePermissions } from '../../common/decorators';
import { AppException } from '../../common/errors/app-exception';
import type { RequestContext } from '../../common/context/request-context';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CourierAppService } from './courier-app.service';
import { CourierWalletService } from './courier-wallet.service';

/**
 * The courier mobile app's surface (TZ §23-§26).
 *
 * Every route resolves the courier from the JWT. Note that no path or body in
 * this controller accepts a `courierId` — that is the design, not an
 * oversight: it is what makes it impossible for the app to reach another
 * courier's jobs, wallet or cash.
 */
@ApiTags('courier-app')
@Controller('courier')
export class CourierAppController {
  constructor(
    private readonly app: CourierAppService,
    private readonly wallet: CourierWalletService,
  ) {}

  /* ------------------------------ Profile --------------------------- */

  @Get('me')
  @RequirePermissions(Permission.DELIVERIES_VIEW_OWN)
  @ApiOperation({ summary: 'My profile and what I have done today' })
  myProfile(): Promise<CourierProfile> {
    return this.app.myProfile();
  }

  /**
   * Only the contact phone is editable here.
   *
   * Name, branch and vehicle are the dispatcher's to set, and the login phone
   * is untouchable from this route — see `Courier.contactPhone`.
   */
  @Patch('me')
  @RequirePermissions(Permission.DELIVERIES_UPDATE_OWN)
  @ApiOperation({ summary: 'Change the number customers call me on' })
  updateMyProfile(
    @Body(zodBody(updateCourierProfileSchema)) body: UpdateCourierProfileInput,
  ): Promise<CourierProfile> {
    return this.app.updateMyProfile(body);
  }

  /* -------------------------------- Jobs ---------------------------- */

  @Get('jobs')
  @RequirePermissions(Permission.DELIVERIES_VIEW_OWN)
  @ApiOperation({ summary: 'Deliveries assigned to me that are not finished' })
  myJobs(): Promise<CourierJob[]> {
    return this.app.myJobs();
  }

  @Get('jobs/:id')
  @RequirePermissions(Permission.DELIVERIES_VIEW_OWN)
  myJob(@Param('id') deliveryId: string): Promise<CourierJob> {
    return this.app.myJob(deliveryId);
  }

  @Post('jobs/:id/accept')
  @RequirePermissions(Permission.DELIVERIES_UPDATE_OWN)
  @ApiOperation({ summary: 'ASSIGNED → ACCEPTED' })
  accept(@Param('id') deliveryId: string): Promise<CourierJob> {
    return this.app.accept(deliveryId);
  }

  @Post('jobs/:id/start')
  @RequirePermissions(Permission.DELIVERIES_UPDATE_OWN)
  @ApiOperation({ summary: 'ACCEPTED → PICKED_UP; the order goes ON_DELIVERY' })
  start(@Param('id') deliveryId: string): Promise<CourierJob> {
    return this.app.start(deliveryId);
  }

  /**
   * Completes the delivery and credits any cash collected.
   *
   * Idempotent: a retry on a dropped connection finds the delivery already
   * DELIVERED and returns it without crediting the wallet twice.
   */
  @Post('jobs/:id/complete')
  @RequirePermissions(Permission.DELIVERIES_UPDATE_OWN)
  @ApiOperation({ summary: 'PICKED_UP → DELIVERED, crediting collected cash' })
  complete(
    @Param('id') deliveryId: string,
    @Body(zodBody(completeDeliverySchema)) body: CompleteDeliveryInput,
  ): Promise<CourierJob> {
    return this.app.complete(deliveryId, body);
  }

  @Post('jobs/:id/fail')
  @RequirePermissions(Permission.DELIVERIES_UPDATE_OWN)
  fail(
    @Param('id') deliveryId: string,
    @Body(zodBody(failDeliverySchema)) body: { reason: string },
  ): Promise<CourierJob> {
    return this.app.fail(deliveryId, body.reason);
  }

  @Post('status')
  @RequirePermissions(Permission.DELIVERIES_UPDATE_OWN)
  @ApiOperation({ summary: 'Go online / offline / on break' })
  setStatus(
    @Body(zodBody(courierStatusUpdateSchema)) body: { status: CourierStatus },
  ): Promise<{ status: CourierStatus }> {
    return this.app.setStatus(body.status);
  }

  /**
   * GPS ping (TZ §25).
   *
   * 204 and no body: this is called every twenty seconds on mobile data, and
   * there is nothing useful to send back.
   */
  @Post('location')
  @RequirePermissions(Permission.DELIVERIES_UPDATE_OWN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Report position while on shift' })
  reportLocation(
    @Body(zodBody(reportLocationSchema)) body: ReportLocationInput,
  ): Promise<void> {
    return this.app.reportLocation(body);
  }

  /* ------------------------------ Wallet ---------------------------- */

  @Get('wallet')
  @RequirePermissions(Permission.COURIER_WALLET_VIEW)
  @ApiOperation({ summary: 'My wallet — what I am holding and what I earned' })
  myWallet(@Ctx() ctx: RequestContext): Promise<CourierWallet> {
    return this.wallet.getWallet(requireCourierId(ctx));
  }

  @Get('wallet/transactions')
  @RequirePermissions(Permission.COURIER_WALLET_VIEW)
  myTransactions(@Ctx() ctx: RequestContext): Promise<Paginated<CourierTransaction>> {
    return this.wallet.listTransactions(requireCourierId(ctx), { limit: 50 });
  }

  /**
   * Declares cash handed to a cashier.
   *
   * Deliberately does NOT move the balance — a cashier has to confirm receipt
   * first (TZ §28).
   */
  @Post('handovers')
  @RequirePermissions(Permission.COURIER_WALLET_VIEW)
  @ApiOperation({ summary: 'Declare a cash hand-off, pending cashier confirmation' })
  declareHandover(
    @Ctx() ctx: RequestContext,
    @Body(zodBody(declareHandoverSchema)) body: DeclareHandoverInput,
  ): Promise<CashHandover> {
    return this.wallet.declare({
      courierId: requireCourierId(ctx),
      branchId: body.branchId,
      amount: body.amount,
      comment: body.comment,
    });
  }

  /**
   * My own hand-offs, newest first.
   *
   * The app needs this to show a declared amount as still awaiting the
   * cashier: until it is confirmed the cash is in limbo, and a courier who
   * cannot see that would declare it twice.
   */
  @Get('handovers')
  @RequirePermissions(Permission.COURIER_WALLET_VIEW)
  @ApiOperation({ summary: 'My cash hand-offs and their confirmation state' })
  myHandovers(@Ctx() ctx: RequestContext): Promise<Paginated<CashHandover>> {
    return this.wallet.listHandovers({ courierId: requireCourierId(ctx), limit: 20 });
  }
}

/** The courier id from the token; a staff account without one gets 403. */
function requireCourierId(ctx: RequestContext): string {
  if (!ctx.courierId) {
    throw AppException.forbidden('Bu hisob kuryerga biriktirilmagan');
  }
  return ctx.courierId;
}
