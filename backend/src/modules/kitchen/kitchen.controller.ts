import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type KitchenTicket } from '@restor/shared-types';
import { RequirePermissions } from '../../common/decorators';
import { KitchenService } from './kitchen.service';

@ApiTags('kitchen')
@Controller('kitchen')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('tickets')
  @RequirePermissions(Permission.KITCHEN_VIEW)
  @ApiOperation({ summary: 'Open tickets for a branch, optionally one station' })
  tickets(
    @Query('branchId') branchId: string,
    @Query('stationId') stationId?: string,
  ): Promise<KitchenTicket[]> {
    return this.kitchen.tickets(branchId, stationId);
  }

  @Post('tickets/:id/start')
  @RequirePermissions(Permission.KITCHEN_UPDATE_STATUS)
  start(@Param('id') id: string): Promise<KitchenTicket> {
    return this.kitchen.start(id);
  }

  @Post('tickets/:id/ready')
  @RequirePermissions(Permission.KITCHEN_UPDATE_STATUS)
  ready(@Param('id') id: string): Promise<KitchenTicket> {
    return this.kitchen.ready(id);
  }
}
