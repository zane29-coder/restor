import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type Branch, type BranchSummary, type Paginated } from '@restor/shared-types';
import {
  createBranchSchema,
  updateBranchSchema,
  type CreateBranchInput,
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

  @Delete(':id')
  @RequirePermissions(Permission.BRANCHES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.branches.remove(id);
  }
}
