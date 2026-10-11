import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type CampaignAudience,
  type MarketingCampaign,
  type Paginated,
} from '@restor/shared-types';
import { normalizePagination, paginated } from '@restor/shared-utils';
import type { CreateCampaignInput } from '@restor/validation';
import { getContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerNotificationsService } from '../customer-notifications/customer-notifications.service';
import { CAMPAIGN_COOLDOWN_HOURS, nextCampaignAllowedAt } from './campaign.math';

/**
 * Marketing messages a restaurant sends to its own customers (TZ 48 §16.2).
 *
 * The rules, all enforced here rather than trusted to the admin screen:
 *
 *  - only customers of THIS restaurant who opted in (the audience is a
 *    tenant-scoped query, and consent lives on the person's account);
 *  - one send per restaurant per {@link CAMPAIGN_COOLDOWN_HOURS} hours, checked
 *    under a lock so two admins pressing "send" together still send once;
 *  - the bot only ever writes to people who opened the restaurant's Mini App
 *    from it — Telegram does not let a bot start a conversation, and this does
 *    not try to.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: CustomerNotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(query: { page?: number; limit?: number }): Promise<Paginated<MarketingCampaign>> {
    const page = normalizePagination(query);

    const [rows, total] = await Promise.all([
      this.prisma.db.marketingCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: {
          product: { select: { name: true } },
          promoCode: { select: { code: true } },
          createdBy: { select: { fullName: true } },
        },
      }),
      this.prisma.db.marketingCampaign.count(),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        productId: row.productId,
        productName: row.product?.name ?? null,
        promoCodeId: row.promoCodeId,
        promoCode: row.promoCode?.code ?? null,
        recipientCount: row.recipientCount,
        telegramQueued: row.telegramQueued,
        createdByName: row.createdBy?.fullName ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
    );
  }

  async audience(): Promise<CampaignAudience> {
    const tenantId = this.requireTenant();
    const [optedIn, last] = await Promise.all([
      this.notifications.countOptedIn(tenantId),
      this.prisma.db.marketingCampaign.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      optedIn,
      nextAllowedAt: nextCampaignAllowedAt(last?.createdAt ?? null, new Date())?.toISOString() ?? null,
      cooldownHours: CAMPAIGN_COOLDOWN_HOURS,
    };
  }

  async send(input: CreateCampaignInput): Promise<MarketingCampaign> {
    const tenantId = this.requireTenant();
    const ctx = getContext();

    if (input.productId) {
      const product = await this.prisma.db.product.findFirst({
        where: { id: input.productId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!product) throw AppException.notFound('Product', ErrorCode.PRODUCT_NOT_FOUND);
    }
    if (input.promoCodeId) {
      const code = await this.prisma.db.promoCode.findFirst({
        where: { id: input.promoCodeId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!code) throw AppException.notFound('Promo code', ErrorCode.PROMO_CODE_NOT_FOUND);
    }

    // The cooldown check and the insert that starts the next cooldown happen
    // under one per-restaurant lock, so a double click cannot send twice.
    const campaign = await this.prisma.transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campaign:${tenantId}`}))`;

      const last = await tx.marketingCampaign.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const next = nextCampaignAllowedAt(last?.createdAt ?? null, new Date());
      if (next) {
        throw new AppException(
          ErrorCode.CAMPAIGN_RATE_LIMITED,
          `Keyingi xabarni ${formatWhen(next)} dan keyin yuborish mumkin`,
          429,
        );
      }

      return tx.marketingCampaign.create({
        data: {
          tenantId,
          kind: input.kind,
          title: input.title,
          body: input.body,
          productId: input.productId ?? null,
          promoCodeId: input.promoCodeId ?? null,
          createdByUserId: ctx?.userId ?? null,
        },
        select: { id: true },
      });
    });

    const result = await this.notifications.sendCampaign({
      tenantId,
      campaignId: campaign.id,
      kind: input.kind,
      title: input.title,
      body: input.body,
      productId: input.productId ?? null,
      requestId: ctx?.requestId ?? null,
    });

    await this.prisma.db.marketingCampaign.update({
      where: { id: campaign.id },
      data: { recipientCount: result.recipients, telegramQueued: result.telegramQueued },
    });

    await this.audit.record({
      action: 'MARKETING_CAMPAIGN_SENT',
      entity: 'MarketingCampaign',
      entityId: campaign.id,
      newValue: { kind: input.kind, title: input.title, recipients: result.recipients },
    });

    const page = await this.list({ page: 1, limit: 1 });
    return page.items[0]!;
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');
    return tenantId;
  }
}

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
