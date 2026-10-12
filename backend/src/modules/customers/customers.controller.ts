import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type Customer,
  type CustomerSummary,
  type LoyaltyProgram,
  type LoyaltyTransaction,
  type Paginated,
} from '@restor/shared-types';
import {
  blockCustomerSchema,
  customerListQuerySchema,
  loyaltyProgramSchema,
  updateCustomerSchema,
  type BlockCustomerInput,
  type CustomerListQueryInput,
  type LoyaltyProgramInput,
  type UpdateCustomerInput,
} from '@restor/validation';
import { RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CustomersService, type CustomerDetail } from './customers.service';

/** Customers and loyalty (TZ §10). */
@ApiTags('customers')
@Controller()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /* ----------------------------- Customers -------------------------- */

  @Get('customers')
  @RequirePermissions(Permission.CUSTOMERS_VIEW)
  @ApiOperation({ summary: 'Search by phone, name or Telegram handle' })
  list(
    @Query(zodBody(customerListQuerySchema)) query: CustomerListQueryInput,
  ): Promise<Paginated<Customer>> {
    return this.customers.list(query);
  }

  /** Declared before `customers/:id`, or "summary" would be read as an id. */
  @Get('customers/summary')
  @RequirePermissions(Permission.CUSTOMERS_VIEW)
  @ApiOperation({ summary: 'Base size, returning share, LTV, points owed, segment sizes' })
  summary(): Promise<CustomerSummary> {
    return this.customers.summary();
  }

  @Get('customers/:id')
  @RequirePermissions(Permission.CUSTOMERS_VIEW)
  get(@Param('id') id: string): Promise<CustomerDetail> {
    return this.customers.get(id);
  }

  /** Order history — what a manager checks before a goodwill call. */
  @Get('customers/:id/orders')
  @RequirePermissions(Permission.CUSTOMERS_VIEW)
  orders(@Param('id') id: string, @Query() query: { page?: number; limit?: number }) {
    return this.customers.orders(id, query);
  }

  @Patch('customers/:id')
  @RequirePermissions(Permission.CUSTOMERS_UPDATE)
  update(
    @Param('id') id: string,
    @Body(zodBody(updateCustomerSchema)) body: UpdateCustomerInput,
  ): Promise<CustomerDetail> {
    return this.customers.update(id, body);
  }

  /**
   * Blocking keeps the history and the points — it stops them ordering.
   *
   * Erasing the record would also erase why they were blocked, which is the
   * one thing anyone asks about later.
   */
  @Post('customers/:id/block')
  @RequirePermissions(Permission.CUSTOMERS_UPDATE)
  block(
    @Param('id') id: string,
    @Body(zodBody(blockCustomerSchema)) body: BlockCustomerInput,
  ): Promise<CustomerDetail> {
    return this.customers.setBlocked(id, true, body.reason);
  }

  @Post('customers/:id/unblock')
  @RequirePermissions(Permission.CUSTOMERS_UPDATE)
  unblock(@Param('id') id: string): Promise<CustomerDetail> {
    return this.customers.setBlocked(id, false);
  }

  /* ------------------------------ Loyalty --------------------------- */

  @Get('loyalty/program')
  @RequirePermissions(Permission.LOYALTY_VIEW)
  @ApiOperation({ summary: 'Cashback settings; defaults to off when unset' })
  getProgram(): Promise<LoyaltyProgram> {
    return this.customers.getProgram();
  }

  @Patch('loyalty/program')
  @RequirePermissions(Permission.LOYALTY_MANAGE)
  updateProgram(
    @Body(zodBody(loyaltyProgramSchema)) body: LoyaltyProgramInput,
  ): Promise<LoyaltyProgram> {
    return this.customers.updateProgram(body);
  }

  @Get('customers/:id/loyalty')
  @RequirePermissions(Permission.LOYALTY_VIEW)
  account(@Param('id') id: string) {
    return this.customers.getAccount(id);
  }

  @Get('customers/:id/loyalty/transactions')
  @RequirePermissions(Permission.LOYALTY_VIEW)
  transactions(
    @Param('id') id: string,
    @Query() query: { page?: number; limit?: number },
  ): Promise<Paginated<LoyaltyTransaction>> {
    return this.customers.listTransactions(id, query);
  }

  /** What this customer could pay with points on a bill of `total`. */
  @Get('customers/:id/loyalty/quote')
  @RequirePermissions(Permission.LOYALTY_VIEW)
  quote(@Param('id') id: string, @Query('total') total: string) {
    return this.customers.quoteRedemption(id, Number(total) || 0);
  }
}
