import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type OnlinePaymentProvider,
  type StorefrontCheckoutOptions,
  type StorefrontInfo,
  type StorefrontSettings,
} from '@restor/shared-types';
import type { UpdateStorefrontSettingsInput } from '@restor/validation';
import { getContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SuboService } from '../payments/subo.service';
import { availablePaymentOptions } from './storefront.math';

/** What a restaurant gets before it has saved anything. */
const DEFAULTS = {
  cashEnabled: true,
  onlineProviders: [] as string[],
  cutleryEnabled: true,
  leaveAtDoorEnabled: false,
};

/**
 * Per-restaurant storefront checkout settings (TZ 48 §22, §25).
 *
 * Nothing is switched on by default except cash: a restaurant enables each
 * online provider deliberately, and even then it is offered only while the
 * Subo key the platform attached is active.
 */
@Injectable()
export class StorefrontSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subo: SuboService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<StorefrontSettings> {
    const [row, onlineAvailable] = await Promise.all([
      this.prisma.db.storefrontSettings.findFirst(),
      this.subo.isAvailable(),
    ]);
    const settings = row ?? DEFAULTS;

    return {
      cashEnabled: settings.cashEnabled,
      onlineProviders: settings.onlineProviders as OnlinePaymentProvider[],
      cutleryEnabled: settings.cutleryEnabled,
      leaveAtDoorEnabled: settings.leaveAtDoorEnabled,
      onlineAvailable,
    };
  }

  async update(input: UpdateStorefrontSettingsInput): Promise<StorefrontSettings> {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');

    const before = await this.get();
    const next = {
      cashEnabled: input.cashEnabled ?? before.cashEnabled,
      onlineProviders: input.onlineProviders ?? before.onlineProviders,
      cutleryEnabled: input.cutleryEnabled ?? before.cutleryEnabled,
      leaveAtDoorEnabled: input.leaveAtDoorEnabled ?? before.leaveAtDoorEnabled,
    };

    // A storefront with no way to pay cannot take an order at all, which
    // would look to customers like a broken app rather than a setting.
    if (!next.cashEnabled && next.onlineProviders.length === 0) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Kamida bitta toʻlov usuli yoqilgan boʻlishi kerak',
        422,
        { cashEnabled: ['Kamida bitta toʻlov usuli kerak'] },
      );
    }

    await this.prisma.db.storefrontSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...next },
      update: next,
    });

    const { onlineAvailable: _ignored, ...previous } = before;
    await this.audit.recordChange(
      'STOREFRONT_SETTINGS_UPDATED',
      'StorefrontSettings',
      tenantId,
      previous,
      next,
    );

    return this.get();
  }

  /** What the checkout offers right now. */
  async checkoutOptions(): Promise<StorefrontCheckoutOptions> {
    const settings = await this.get();
    return {
      paymentOptions: availablePaymentOptions(settings, settings.onlineAvailable),
      cutleryEnabled: settings.cutleryEnabled,
      leaveAtDoorEnabled: settings.leaveAtDoorEnabled,
    };
  }

  /** Public: the restaurant as its storefront presents it. */
  async publicInfo(): Promise<StorefrontInfo> {
    const [tenant, bot, checkout] = await Promise.all([
      this.prisma.db.tenant.findFirst({
        where: { deletedAt: null },
        select: {
          name: true,
          companyName: true,
          slug: true,
          logoUrl: true,
          primaryColor: true,
          phone: true,
        },
      }),
      this.prisma.db.telegramConfig.findFirst({
        where: { branchId: null, isActive: true },
        select: { botUsername: true },
      }),
      this.checkoutOptions(),
    ]);

    if (!tenant) throw AppException.notFound('Restaurant', ErrorCode.TENANT_NOT_FOUND);

    return {
      restaurant: {
        name: tenant.companyName || tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        phone: tenant.phone,
        botUsername: bot?.botUsername ?? null,
      },
      checkout,
    };
  }
}
