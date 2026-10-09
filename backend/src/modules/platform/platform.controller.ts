import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  Paginated,
  Plan,
  PlatformStats,
  Subscription,
  SubscriptionUsage,
  TelegramConfig,
  Tenant,
  TenantStatus,
} from '@restor/shared-types';
import {
  assignSubscriptionSchema,
  blockTenantSchema,
  createPlanSchema,
  createTenantSchema,
  suboConfigSchema,
  telegramConfigSchema,
  updateTenantSchema,
  type AssignSubscriptionInput,
  type CreatePlanInput,
  type CreateTenantInput,
  type SuboConfigInput,
  type TelegramConfigInput,
  type UpdateTenantInput,
} from '@restor/validation';
import { runAsTenant } from '../../common/context/request-context';
import { SuperAdminOnly } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SuboService, type SuboConfigView } from '../payments/subo.service';
import { SubscriptionLimitsService } from '../subscriptions/subscription-limits.service';
import { TelegramService } from '../telegram/telegram.service';
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
    private readonly telegram: TelegramService,
    private readonly subo: SuboService,
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

  /* --------------------------- Integrations --------------------------- */

  /*
   * The platform wires a restaurant's Telegram bot and payment provider up for
   * it (TZ §6, §15). Both services are tenant-scoped by design, and a platform
   * token names no tenant — so these routes enter the restaurant's scope
   * explicitly with `runAsTenant`. Loading the tenant first means a wrong id
   * is a 404 rather than a config row written against nothing.
   */

  @Put('tenants/:id/telegram')
  @ApiOperation({ summary: 'Attach a restaurant’s bot token (verified, encrypted)' })
  async saveTenantTelegram(
    @Param('id') id: string,
    @Body(zodBody(telegramConfigSchema)) body: TelegramConfigInput,
  ): Promise<TelegramConfig> {
    await this.tenants.get(id);
    return runAsTenant(id, () => this.telegram.saveConfig(body));
  }

  @Get('tenants/:id/payment-provider')
  @ApiOperation({ summary: 'Whether Subo is configured — never returns the key' })
  async tenantPaymentProvider(@Param('id') id: string): Promise<SuboConfigView> {
    await this.tenants.get(id);
    return runAsTenant(id, () => this.subo.getConfig());
  }

  @Put('tenants/:id/payment-provider')
  @ApiOperation({ summary: 'Attach a restaurant’s Subo API key (encrypted)' })
  async saveTenantPaymentProvider(
    @Param('id') id: string,
    @Body(zodBody(suboConfigSchema)) body: SuboConfigInput,
  ): Promise<SuboConfigView> {
    await this.tenants.get(id);
    return runAsTenant(id, () => this.subo.saveConfig(body));
  }
}
