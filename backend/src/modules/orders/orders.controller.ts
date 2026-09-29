import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type Order,
  type OrderPricePreview,
  type OrderStatusHistoryEntry,
  type Paginated,
} from '@restor/shared-types';
import {
  createOrderSchema,
  orderListQuerySchema,
  previewOrderSchema,
  updateOrderStatusSchema,
  type CreateOrderInput,
  type OrderListQueryInput,
  type UpdateOrderStatusInput,
} from '@restor/validation';
import { Public, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions(Permission.ORDERS_VIEW)
  @ApiOperation({ summary: 'List orders, scoped to the caller’s branches' })
  list(
    @Query(zodBody(orderListQuerySchema)) query: OrderListQueryInput,
  ): Promise<Paginated<Order>> {
    return this.orders.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.ORDERS_VIEW)
  get(@Param('id') id: string): Promise<Order> {
    return this.orders.get(id);
  }

  @Get(':id/timeline')
  @RequirePermissions(Permission.ORDERS_VIEW)
  @ApiOperation({ summary: 'Full status history of the order' })
  timeline(@Param('id') id: string): Promise<OrderStatusHistoryEntry[]> {
    return this.orders.timeline(id);
  }

  /**
   * Prices a cart without creating anything.
   *
   * Public because the storefront shows a running total before the customer
   * signs in; everything it returns is computed from menu data they can
   * already see.
   */
  @Public()
  @Post('preview')
  @ApiOperation({ summary: 'Price a cart server-side before confirming' })
  preview(
    @Body(zodBody(previewOrderSchema)) body: CreateOrderInput,
  ): Promise<OrderPricePreview> {
    return this.orders.preview(body);
  }

  /**
   * Places an order.
   *
   * Public so a guest can order from the storefront or Mini App without a
   * staff account; a staff token additionally needs `orders.create`, which the
   * permissions guard enforces when one is present.
   */
  @Public()
  @RequirePermissions(Permission.ORDERS_CREATE)
  @Post()
  @ApiOperation({ summary: 'Create an order (idempotent on clientUuid)' })
  create(@Body(zodBody(createOrderSchema)) body: CreateOrderInput): Promise<Order> {
    return this.orders.create(body);
  }

  @Patch(':id/status')
  @RequirePermissions(Permission.ORDERS_CHANGE_STATUS)
  @ApiOperation({ summary: 'Advance the order along its allowed transitions' })
  updateStatus(
    @Param('id') id: string,
    @Body(zodBody(updateOrderStatusSchema)) body: UpdateOrderStatusInput,
  ): Promise<Order> {
    return this.orders.updateStatus(id, body);
  }
}
