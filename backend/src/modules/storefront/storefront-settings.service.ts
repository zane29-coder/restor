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
  accentColor: null as string | null,
  bannerUrl: null as string | null,
  bannerTitle: null as string | null,
  bannerText: null as string | null,
  requireMapPin: false,
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
    const [row, onlineAvailable, tenant] = await Promise.all([
      this.prisma.db.storefrontSettings.findFirst(),
      this.subo.isAvailable(),
      this.prisma.db.tenant.findFirst({ where: { deletedAt: null }, select: { primaryColor: true } }),
    ]);
    const settings = row ?? DEFAULTS;

    return {
      cashEnabled: settings.cashEnabled,
      onlineProviders: settings.onlineProviders as OnlinePaymentProvider[],
      cutleryEnabled: settings.cutleryEnabled,
      leaveAtDoorEnabled: settings.leaveAtDoorEnabled,
      accentColor: settings.accentColor,
      brandColor: tenant?.primaryColor ?? '#FF6B00',
      bannerUrl: settings.bannerUrl,
      bannerTitle: settings.bannerTitle,
      bannerText: settings.bannerText,
      requireMapPin: settings.requireMapPin,
      onlineAvailable,
    };
  }

  async update(input: UpdateStorefrontSettingsInput): Promise<StorefrontSettings> {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');

    const before = await this.get();
    // `undefined` keeps a field; `null` clears an optional one.
    const keep = <T>(value: T | undefined, current: T) => (value === undefined ? current : value);
    const next = {
      cashEnabled: input.cashEnabled ?? before.cashEnabled,
      onlineProviders: input.onlineProviders ?? before.onlineProviders,
      cutleryEnabled: input.cutleryEnabled ?? before.cutleryEnabled,
      leaveAtDoorEnabled: input.leaveAtDoorEnabled ?? before.leaveAtDoorEnabled,
      accentColor: keep(input.accentColor, before.accentColor)?.toUpperCase() ?? null,
      bannerUrl: keep(input.bannerUrl, before.bannerUrl) || null,
      bannerTitle: keep(input.bannerTitle, before.bannerTitle) || null,
      bannerText: keep(input.bannerText, before.bannerText) || null,
      requireMapPin: input.requireMapPin ?? before.requireMapPin,
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

    const { onlineAvailable: _ignored, brandColor: _brand, ...previous } = before;
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
      requireMapPin: settings.requireMapPin,
    };
  }

  /** Public: the restaurant as its storefront presents it. */
  async publicInfo(): Promise<StorefrontInfo> {
    const [tenant, bot, checkout, appearance] = await Promise.all([
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
      this.prisma.db.storefrontSettings.findFirst({
        select: { accentColor: true, bannerUrl: true, bannerTitle: true, bannerText: true },
      }),
    ]);

    if (!tenant) throw AppException.notFound('Restaurant', ErrorCode.TENANT_NOT_FOUND);

    const hasBanner = Boolean(appearance?.bannerUrl || appearance?.bannerTitle);
    return {
      restaurant: {
        name: tenant.companyName || tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl,
        // The storefront's own accent wins over the white-label colour.
        primaryColor: appearance?.accentColor ?? tenant.primaryColor,
        phone: tenant.phone,
        botUsername: bot?.botUsername ?? null,
      },
      banner: hasBanner
        ? { imageUrl: appearance!.bannerUrl, title: appearance!.bannerTitle, text: appearance!.bannerText }
        : null,
      checkout,
    };
  }
}
