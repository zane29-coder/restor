import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type CashRegister,
  type CashShift,
  type CashShiftStatus,
  type CashTransaction,
  type Paginated,
  type ShiftSummary,
} from '@restor/shared-types';
import {
  cashTransactionSchema,
  closeShiftSchema,
  createCashRegisterSchema,
  openShiftSchema,
  type CashTransactionInput,
  type CloseShiftInput,
  type CreateCashRegisterInput,
  type OpenShiftInput,
} from '@restor/validation';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CashService } from './cash.service';

/** Cash register and shifts (TZ §19). */
@ApiTags('cash')
@Controller('cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  /* ------------------------------ Registers ------------------------- */

  @Get('registers')
  @RequireAnyPermission(Permission.PAYMENTS_VIEW, Permission.CASHBOX_OPEN_SHIFT)
  listRegisters(@Query('branchId') branchId?: string): Promise<CashRegister[]> {
    return this.cash.listRegisters(branchId);
  }

  @Post('registers')
  @RequirePermissions(Permission.BRANCHES_UPDATE)
  createRegister(
    @Body(zodBody(createCashRegisterSchema)) body: CreateCashRegisterInput,
  ): Promise<CashRegister> {
    return this.cash.createRegister(body);
  }

  /* -------------------------------- Shifts -------------------------- */

  @Post('shifts/open')
  @RequirePermissions(Permission.CASHBOX_OPEN_SHIFT)
  @ApiOperation({ summary: 'Open a shift and count the float into the drawer' })
  openShift(@Body(zodBody(openShiftSchema)) body: OpenShiftInput): Promise<CashShift> {
    return this.cash.openShift(body);
  }

  /**
   * The shift a cashier is working in.
   *
   * Listed before `shifts/:id` so "current" is never read as an id.
   */
  @Get('shifts/current')
  @RequireAnyPermission(Permission.CASHBOX_OPEN_SHIFT, Permission.PAYMENTS_VIEW)
  currentShift(@Query('branchId') branchId: string): Promise<CashShift | null> {
    return this.cash.currentShift(branchId);
  }

  @Get('shifts')
  @RequirePermissions(Permission.CASHBOX_VIEW_ALL_SHIFTS)
  listShifts(
    @Query()
    query: { page?: number; limit?: number; branchId?: string; status?: CashShiftStatus },
  ): Promise<Paginated<CashShift>> {
    return this.cash.listShifts(query);
  }

  @Get('shifts/:id')
  @RequireAnyPermission(Permission.CASHBOX_VIEW_ALL_SHIFTS, Permission.PAYMENTS_VIEW)
  getShift(@Param('id') id: string): Promise<CashShift> {
    return this.cash.getShift(id);
  }

  /**
   * X-report: the shift's figures without closing it.
   *
   * Summed from the movements rather than read off the running totals, so it
   * doubles as a check that the two agree.
   */
  @Get('shifts/:id/summary')
  @RequireAnyPermission(Permission.CASHBOX_CLOSE_SHIFT, Permission.PAYMENTS_VIEW)
  @ApiOperation({ summary: 'X-report — figures so far, shift stays open' })
  summary(@Param('id') id: string): Promise<ShiftSummary> {
    return this.cash.summary(id);
  }

  @Post('shifts/:id/close')
  @RequirePermissions(Permission.CASHBOX_CLOSE_SHIFT)
  @ApiOperation({ summary: 'Z-report — close against a physical count' })
  closeShift(
    @Param('id') id: string,
    @Body(zodBody(closeShiftSchema)) body: CloseShiftInput,
  ): Promise<CashShift> {
    return this.cash.closeShift(id, body);
  }

  /* ---------------------------- Transactions ------------------------ */

  @Get('shifts/:id/transactions')
  @RequireAnyPermission(Permission.CASHBOX_VIEW_ALL_SHIFTS, Permission.PAYMENTS_VIEW)
  listTransactions(
    @Param('id') id: string,
    @Query() query: { page?: number; limit?: number },
  ): Promise<Paginated<CashTransaction>> {
    return this.cash.listTransactions(id, query);
  }

  @Post('shifts/:id/transactions')
  @RequirePermissions(Permission.PAYMENTS_RECEIVE)
  @ApiOperation({ summary: 'Manual cash in or out of the drawer' })
  addTransaction(
    @Param('id') id: string,
    @Body(zodBody(cashTransactionSchema)) body: CashTransactionInput,
  ): Promise<CashTransaction> {
    return this.cash.addTransaction({ shiftId: id, ...body });
  }
}
