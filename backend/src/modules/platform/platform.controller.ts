import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  Paginated,
  Plan,
  PlatformStats,
  Subscription,
  SubscriptionUsage,
  Tenant,
  TenantStatus,
} from '@restor/shared-types';
import {
  assignSubscriptionSchema,
  blockTenantSchema,
  createPlanSchema,
  createTenantSchema,
  updateTenantSchema,
  type AssignSubscriptionInput,
  type CreatePlanInput,
  type CreateTenantInput,
  type UpdateTenantInput,
} from '@restor/validation';
import { SuperAdminOnly } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SubscriptionLimitsService } from '../subscriptions/subscription-limits.service';
import { TenantsService } from './tenants.service';

/**
 * Super-admin surface (TZ §6).
 *
 * `@SuperAdminOnly()` sits on the CLASS, so every route — present and future —
 * is gated by default. Forgetting the decorator on a new method cannot open a
 * cross-tenant hole.
 */
@ApiTags('platform')
@SuperAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly limits: SubscriptionLimitsService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide dashboard figures' })
  stats(): Promise<PlatformStats> {
    return this.tenants.stats();
  }

  @Get('tenants')
  @ApiOperation({ summary: 'List every restaurant on the platform' })
  listTenants(
    @Query() query: { page?: number; limit?: number; status?: TenantStatus; search?: string },
  ): Promise<Paginated<Tenant>> {
    return this.tenants.list(query);
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string): Promise<Tenant> {
    return this.tenants.get(id);
  }

  @Post('tenants')
  @ApiOperation({ summary: 'Create a restaurant together with its owner account' })
  createTenant(@Body(zodBody(createTenantSchema)) body: CreateTenantInput): Promise<Tenant> {
    return this.tenants.create(body);
  }

  @Patch('tenants/:id')
  updateTenant(
    @Param('id') id: string,
    @Body(zodBody(updateTenantSchema)) body: UpdateTenantInput,
  ): Promise<Tenant> {
    return this.tenants.update(id, body);
  }

  @Post('tenants/:id/block')
  @ApiOperation({ summary: 'Block a restaurant and end every session it holds' })
  blockTenant(
    @Param('id') id: string,
    @Body(zodBody(blockTenantSchema)) body: { reason: string },
  ): Promise<Tenant> {
    return this.tenants.block(id, body.reason);
  }

  @Post('tenants/:id/activate')
  activateTenant(@Param('id') id: string): Promise<Tenant> {
    return this.tenants.activate(id);
  }

  @Get('tenants/:id/usage')
  @ApiOperation({ summary: 'Current usage against the plan’s limits' })
  usage(@Param('id') id: string): Promise<SubscriptionUsage> {
    return this.limits.usage(id);
  }

  @Post('tenants/:id/subscription')
  @ApiOperation({ summary: 'Assign or renew a subscription' })
  assignSubscription(
    @Param('id') id: string,
    @Body(zodBody(assignSubscriptionSchema)) body: AssignSubscriptionInput,
  ): Promise<Subscription> {
    return this.tenants.assignSubscription(id, body);
  }

  @Get('plans')
  listPlans(): Promise<Plan[]> {
    return this.tenants.listPlans();
  }

  @Post('plans')
  createPlan(@Body(zodBody(createPlanSchema)) body: CreatePlanInput): Promise<Plan> {
    return this.tenants.createPlan(body);
  }
}
