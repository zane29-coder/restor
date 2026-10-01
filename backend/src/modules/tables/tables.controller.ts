import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type RestaurantTable,
  type WaiterCall,
  type WaiterCallStatus,
} from '@restor/shared-types';
import {
  createTableSchema,
  updateTableSchema,
  waiterCallSchema,
  type CreateTableInput,
  type UpdateTableInput,
  type WaiterCallInput,
} from '@restor/validation';
import { Public, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { TablesService, type TableSession } from './tables.service';

/** Tables and the waiter-call queue (TZ §20). */
@ApiTags('tables')
@Controller()
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  /* ------------------------------- Tables --------------------------- */

  @Get('tables')
  @RequirePermissions(Permission.TABLES_VIEW)
  list(@Query('branchId') branchId?: string): Promise<RestaurantTable[]> {
    return this.tables.list(branchId);
  }

  @Post('tables')
  @RequirePermissions(Permission.TABLES_MANAGE)
  @ApiOperation({ summary: 'Create a table and issue its QR token' })
  create(@Body(zodBody(createTableSchema)) body: CreateTableInput): Promise<RestaurantTable> {
    return this.tables.create(body);
  }

  @Patch('tables/:id')
  @RequirePermissions(Permission.TABLES_MANAGE)
  update(
    @Param('id') id: string,
    @Body(zodBody(updateTableSchema)) body: UpdateTableInput,
  ): Promise<RestaurantTable> {
    return this.tables.update(id, body);
  }

  /**
   * Issues a new QR token, invalidating every printed code for this table.
   *
   * Its own endpoint rather than part of an edit: a photographed code posted
   * online lets anyone open orders on that table, and the remedy has to be
   * one deliberate action.
   */
  @Post('tables/:id/rotate-qr')
  @RequirePermissions(Permission.TABLES_MANAGE)
  @ApiOperation({ summary: 'Re-issue the QR token; old printed codes stop working' })
  rotateQr(@Param('id') id: string): Promise<RestaurantTable> {
    return this.tables.rotateQr(id);
  }

  @Delete('tables/:id')
  @RequirePermissions(Permission.TABLES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.tables.remove(id);
  }

  /* --------------------------- Waiter calls ------------------------- */

  @Get('waiter-calls')
  @RequirePermissions(Permission.WAITER_CALLS_HANDLE)
  @ApiOperation({ summary: 'Open calls, oldest first — the queue a waiter works' })
  listCalls(
    @Query() query: { branchId?: string; status?: WaiterCallStatus },
  ): Promise<WaiterCall[]> {
    return this.tables.listCalls(query);
  }

  @Post('waiter-calls/:id/acknowledge')
  @RequirePermissions(Permission.WAITER_CALLS_HANDLE)
  acknowledge(@Param('id') id: string): Promise<WaiterCall> {
    return this.tables.acknowledge(id);
  }

  @Post('waiter-calls/:id/resolve')
  @RequirePermissions(Permission.WAITER_CALLS_HANDLE)
  resolve(@Param('id') id: string): Promise<WaiterCall> {
    return this.tables.resolve(id);
  }
}

/**
 * The guest's side of a QR table (TZ §20).
 *
 * Public on purpose. A guest who must register before seeing the menu orders
 * at the counter instead, so the scanned token is the only credential asked
 * for — and it grants exactly one thing: this table, at this branch. It
 * reaches no other table, no other order, and nothing belonging to the
 * restaurant.
 */
@ApiTags('tables')
@Controller('t')
export class TableGuestController {
  constructor(private readonly tables: TablesService) {}

  @Get(':token')
  @Public()
  @ApiOperation({ summary: 'Resolve a scanned QR code to a table and branch' })
  session(@Param('token') token: string): Promise<TableSession> {
    return this.tables.resolveQr(token);
  }

  /**
   * Calls a waiter.
   *
   * Repeat taps collapse into the open call rather than queueing duplicates:
   * three rows for one impatient guest is noise that teaches a waiter to stop
   * looking at the screen.
   */
  @Post(':token/call')
  @Public()
  @ApiOperation({ summary: 'Call a waiter; repeat taps collapse into one call' })
  call(
    @Param('token') token: string,
    @Body(zodBody(waiterCallSchema)) body: WaiterCallInput,
  ): Promise<WaiterCall> {
    return this.tables.call(token, body.type);
  }
}
