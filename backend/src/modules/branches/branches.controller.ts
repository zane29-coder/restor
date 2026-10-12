import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type Branch,
  type BranchSummary,
  type DeliveryZone,
  type Paginated,
} from '@restor/shared-types';
import {
  createBranchSchema,
  saveDeliveryZonesSchema,
  updateBranchSchema,
  type CreateBranchInput,
  type SaveDeliveryZonesInput,
  type UpdateBranchInput,
} from '@restor/validation';
import { Public, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { BranchesService } from './branches.service';

@ApiTags('branches')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions(Permission.BRANCHES_VIEW)
  @ApiOperation({ summary: 'List branches of the caller’s restaurant' })
  list(
    @Query() query: { page?: number; limit?: number; isActive?: boolean; search?: string },
  ): Promise<Paginated<Branch>> {
    return this.branches.list(query);
  }

  /**
   * Public branch picker for the storefront and Mini App.
   *
   * Still tenant-scoped: the tenant comes from the storefront's own token or
   * slug, so this never leaks another restaurant's branches.
   */
  @Public()
  @Get('summary')
  @ApiOperation({ summary: 'Branch picker list, optionally sorted by distance' })
  summaries(
    @Query() query: { latitude?: string; longitude?: string },
  ): Promise<BranchSummary[]> {
    return this.branches.summaries({
      latitude: query.latitude !== undefined ? Number(query.latitude) : undefined,
      longitude: query.longitude !== undefined ? Number(query.longitude) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(Permission.BRANCHES_VIEW)
  get(@Param('id') id: string): Promise<Branch> {
    return this.branches.get(id);
  }

  @Post()
  @RequirePermissions(Permission.BRANCHES_CREATE)
  @ApiOperation({ summary: 'Create a branch (subject to the plan’s branch limit)' })
  create(@Body(zodBody(createBranchSchema)) body: CreateBranchInput): Promise<Branch> {
    return this.branches.create(body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.BRANCHES_UPDATE)
  update(
    @Param('id') id: string,
    @Body(zodBody(updateBranchSchema)) body: UpdateBranchInput,
  ): Promise<Branch> {
    return this.branches.update(id, body);
  }

  @Get(':id/zones')
  @RequirePermissions(Permission.BRANCHES_VIEW)
  @ApiOperation({ summary: 'Drawn delivery zones of a branch, in precedence order' })
  zones(@Param('id') id: string): Promise<DeliveryZone[]> {
    return this.branches.zones(id);
  }

  /** Replaces the branch's zones wholesale — the map editor saves them all. */
  @Put(':id/zones')
  @RequirePermissions(Permission.BRANCHES_UPDATE)
  @ApiOperation({ summary: 'Save the full set of delivery zones for a branch' })
  saveZones(
    @Param('id') id: string,
    @Body(zodBody(saveDeliveryZonesSchema)) body: SaveDeliveryZonesInput,
  ): Promise<DeliveryZone[]> {
    return this.branches.saveZones(id, body.zones);
  }

  @Delete(':id')
  @RequirePermissions(Permission.BRANCHES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.branches.remove(id);
  }
}
