import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  PromoCodeType,
  PromotionType,
  type Paginated,
  type PromoCode,
  type PromoCodeUsage,
  type Promotion,
  type Weekday,
} from '@restor/shared-types';
import { normalizeCode, normalizePagination, paginated } from '@restor/shared-utils';
import type {
  CreatePromoCodeInput,
  CreatePromotionInput,
  PromoCodeListQueryInput,
  PromotionListQueryInput,
  UpdatePromoCodeInput,
  UpdatePromotionInput,
} from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Promotions and promo codes (TZ §10).
 *
 * The pricing engine already reads these rows on every order — this is the
 * surface that lets a manager create them, which until now meant a direct
 * database insert.
 *
 * The rule that shapes the write paths: **a promotion's `value` means
 * different things per type**, and the two readings are catastrophically
 * different. `50` on a PERCENTAGE_DISCOUNT is half off; `50` on a
 * FIXED_DISCOUNT is fifty soʻm. A manager who picks the wrong type and keeps
 * the number gives the shop away, and nothing downstream would question it.
 * So the coherence check runs against the MERGED row on update, not just the
 * patch — a patch that changes only the type would otherwise sail past it.
 */
@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Promotions                                                         */
  /* ------------------------------------------------------------------ */

  async listPromotions(query: PromotionListQueryInput): Promise<Paginated<Promotion>> {
    const page = normalizePagination(query);

    const where = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.branchId ? { branchIds: { has: query.branchId } } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.promotion.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.promotion.count({ where }),
    ]);

    return paginated(rows.map(toPromotion), total, page);
  }

  async getPromotion(id: string): Promise<Promotion> {
    const row = await this.prisma.db.promotion.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw AppException.notFound('Promotion');
    return toPromotion(row);
  }

  async createPromotion(input: CreatePromotionInput): Promise<Promotion> {
    const tenantId = this.requireTenant();
    await this.assertBranchesExist(input.branchIds);

    const row = await this.prisma.db.promotion.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        value: input.value,
        maxDiscount: input.maxDiscount ?? null,
        minOrderAmount: input.minOrderAmount ?? null,
        config: (input.config ?? {}) as object,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        timeFrom: input.timeFrom ?? null,
        timeTo: input.timeTo ?? null,
        daysOfWeek: input.daysOfWeek,
        branchIds: input.branchIds,
        productIds: input.productIds,
        categoryIds: input.categoryIds,
        priority: input.priority,
        isExclusive: input.isExclusive,
        isActive: input.isActive,
      },
    });

    await this.audit.record({
      action: 'PROMOTION_CREATED',
      entity: 'Promotion',
      entityId: row.id,
      newValue: { name: input.name, type: input.type, value: input.value },
    });

    return toPromotion(row);
  }

  async updatePromotion(id: string, input: UpdatePromotionInput): Promise<Promotion> {
    const before = await this.getPromotion(id);
    if (input.branchIds) await this.assertBranchesExist(input.branchIds);

    // The type/value pair is checked against what the row will BE, not against
    // the patch. A request that flips the type and leaves the old value would
    // otherwise pass: nothing in the patch alone is wrong.
    assertValueMatchesType(
      (input.type ?? before.type) as PromotionType,
      input.value ?? before.value,
    );

    const row = await this.prisma.db.promotion.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.maxDiscount !== undefined ? { maxDiscount: input.maxDiscount ?? null } : {}),
        ...(input.minOrderAmount !== undefined
          ? { minOrderAmount: input.minOrderAmount ?? null }
          : {}),
        ...(input.config !== undefined ? { config: input.config as object } : {}),
        ...(input.startsAt !== undefined
          ? { startsAt: input.startsAt ? new Date(input.startsAt) : null }
          : {}),
        ...(input.endsAt !== undefined
          ? { endsAt: input.endsAt ? new Date(input.endsAt) : null }
          : {}),
        ...(input.timeFrom !== undefined ? { timeFrom: input.timeFrom ?? null } : {}),
        ...(input.timeTo !== undefined ? { timeTo: input.timeTo ?? null } : {}),
        ...(input.daysOfWeek !== undefined ? { daysOfWeek: input.daysOfWeek } : {}),
        ...(input.branchIds !== undefined ? { branchIds: input.branchIds } : {}),
        ...(input.productIds !== undefined ? { productIds: input.productIds } : {}),
        ...(input.categoryIds !== undefined ? { categoryIds: input.categoryIds } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.isExclusive !== undefined ? { isExclusive: input.isExclusive } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    const after = toPromotion(row);
    await this.audit.recordChange(
      'PROMOTION_UPDATED',
      'Promotion',
      id,
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );

    return after;
  }

  /**
   * Soft-deletes a promotion.
   *
   * Never a hard delete: orders already priced with it reference it in their
   * applied-promotion history, and a finance report that cannot name the
   * discount it is looking at is useless.
   */
  async deletePromotion(id: string): Promise<void> {
    await this.getPromotion(id);

    await this.prisma.db.promotion.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      action: 'PROMOTION_DELETED',
      entity: 'Promotion',
      entityId: id,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Promo codes                                                        */
  /* ------------------------------------------------------------------ */

  async listPromoCodes(query: PromoCodeListQueryInput): Promise<Paginated<PromoCode>> {
    const page = normalizePagination(query);

    const where = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search ? { code: { contains: normalizeCode(query.search) } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.promoCode.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.promoCode.count({ where }),
    ]);

    return paginated(rows.map(toPromoCode), total, page);
  }

  async getPromoCode(id: string): Promise<PromoCode> {
    const row = await this.prisma.db.promoCode.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw AppException.notFound('PromoCode', ErrorCode.PROMO_CODE_NOT_FOUND);
    return toPromoCode(row);
  }

  async createPromoCode(input: CreatePromoCodeInput): Promise<PromoCode> {
    const tenantId = this.requireTenant();
    const code = normalizeCode(input.code);
    await this.assertBranchesExist(input.branchIds);

    // Checked before insert for a readable message; the unique index on
    // (tenantId, code) is what actually closes the race between two admins.
    const duplicate = await this.prisma.db.promoCode.findFirst({
      where: { code, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.conflict(`"${code}" kodi allaqachon mavjud`);
    }

    const row = await this.prisma.db.promoCode.create({
      data: {
        tenantId,
        code,
        type: input.type,
        discount: input.discount,
        minOrderAmount: input.minOrderAmount ?? null,
        maxDiscount: input.maxDiscount ?? null,
        usageLimit: input.usageLimit ?? null,
        userLimit: input.userLimit ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        branchIds: input.branchIds,
        isActive: input.isActive,
      },
    });

    await this.audit.record({
      action: 'PROMO_CODE_CREATED',
      entity: 'PromoCode',
      entityId: row.id,
      newValue: { code, type: input.type, discount: input.discount },
    });

    return toPromoCode(row);
  }

  async updatePromoCode(id: string, input: UpdatePromoCodeInput): Promise<PromoCode> {
    const before = await this.getPromoCode(id);
    if (input.branchIds) await this.assertBranchesExist(input.branchIds);

    assertDiscountMatchesType(
      (input.type ?? before.type) as PromoCodeType,
      input.discount ?? before.discount,
    );

    const row = await this.prisma.db.promoCode.update({
      where: { id },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.discount !== undefined ? { discount: input.discount } : {}),
        ...(input.minOrderAmount !== undefined
          ? { minOrderAmount: input.minOrderAmount ?? null }
          : {}),
        ...(input.maxDiscount !== undefined ? { maxDiscount: input.maxDiscount ?? null } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit ?? null } : {}),
        ...(input.userLimit !== undefined ? { userLimit: input.userLimit ?? null } : {}),
        ...(input.startsAt !== undefined
          ? { startsAt: input.startsAt ? new Date(input.startsAt) : null }
          : {}),
        ...(input.endsAt !== undefined
          ? { endsAt: input.endsAt ? new Date(input.endsAt) : null }
          : {}),
        ...(input.branchIds !== undefined ? { branchIds: input.branchIds } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    const after = toPromoCode(row);
    await this.audit.recordChange(
      'PROMO_CODE_UPDATED',
      'PromoCode',
      id,
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );

    return after;
  }

  async deletePromoCode(id: string): Promise<void> {
    await this.getPromoCode(id);

    // Soft, for the same reason as promotions: redemptions point at it.
    await this.prisma.db.promoCode.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      action: 'PROMO_CODE_DELETED',
      entity: 'PromoCode',
      entityId: id,
    });
  }

  /** Who redeemed a code and for how much — the campaign's actual result. */
  async listUsages(
    promoCodeId: string,
    query: { page?: number; limit?: number },
  ): Promise<Paginated<PromoCodeUsage>> {
    await this.getPromoCode(promoCodeId);
    const page = normalizePagination(query);

    const [rows, total] = await Promise.all([
      this.prisma.db.promoCodeUsage.findMany({
        where: { promoCodeId },
        orderBy: { usedAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.promoCodeUsage.count({ where: { promoCodeId } }),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        promoCodeId: row.promoCodeId,
        customerId: row.customerId,
        orderId: row.orderId,
        discountAmount: row.discountAmount,
        usedAt: row.usedAt.toISOString(),
      })),
      total,
      page,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Rejects branch ids that are not this tenant's.
   *
   * `branchIds` is a plain array column, so the Prisma tenant scoping cannot
   * reach into it — an id from another restaurant would be stored happily and
   * quietly never match anything.
   */
  private async assertBranchesExist(branchIds: string[]): Promise<void> {
    if (branchIds.length === 0) return;

    const found = await this.prisma.db.branch.count({
      where: { id: { in: branchIds }, deletedAt: null },
    });
    if (found !== branchIds.length) {
      throw AppException.badRequest('Filiallardan biri topilmadi');
    }
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');
    return tenantId;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * `value` read against the type it is stored under.
 *
 * Exported and pure so the same check can be exercised directly: this is the
 * difference between "50% off" and "50 soʻm off", and the wrong reading is a
 * promotion that empties the till without erroring anywhere.
 */
export function assertValueMatchesType(type: PromotionType, value: number): void {
  if (type === PromotionType.PERCENTAGE_DISCOUNT && (value < 1 || value > 100)) {
    throw AppException.badRequest(
      'Foizli chegirma uchun qiymat 1–100 oraligʻida boʻlishi kerak',
    );
  }
  if (type === PromotionType.FIXED_DISCOUNT && value <= 0) {
    throw AppException.badRequest('Belgilangan chegirma noldan katta boʻlishi kerak');
  }
}

export function assertDiscountMatchesType(type: PromoCodeType, discount: number): void {
  if (type === PromoCodeType.PERCENTAGE && (discount < 1 || discount > 100)) {
    throw AppException.badRequest('Foizli kod uchun qiymat 1–100 oraligʻida boʻlishi kerak');
  }
  if (type === PromoCodeType.FIXED && discount <= 0) {
    throw AppException.badRequest('Belgilangan chegirma noldan katta boʻlishi kerak');
  }
}

function toPromotion(row: {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: string;
  value: number;
  maxDiscount: number | null;
  minOrderAmount: number | null;
  config: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
  timeFrom: string | null;
  timeTo: string | null;
  daysOfWeek: number[];
  branchIds: string[];
  productIds: string[];
  categoryIds: string[];
  priority: number;
  isExclusive: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Promotion {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    type: row.type as PromotionType,
    value: row.value,
    maxDiscount: row.maxDiscount,
    minOrderAmount: row.minOrderAmount,
    config: (row.config ?? {}) as Record<string, unknown>,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    timeFrom: row.timeFrom,
    timeTo: row.timeTo,
    daysOfWeek: row.daysOfWeek as Weekday[],
    branchIds: row.branchIds,
    productIds: row.productIds,
    categoryIds: row.categoryIds,
    priority: row.priority,
    isExclusive: row.isExclusive,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPromoCode(row: {
  id: string;
  tenantId: string;
  code: string;
  type: string;
  discount: number;
  minOrderAmount: number | null;
  maxDiscount: number | null;
  usageLimit: number | null;
  userLimit: number | null;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  branchIds: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PromoCode {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    type: row.type as PromoCodeType,
    discount: row.discount,
    minOrderAmount: row.minOrderAmount,
    maxDiscount: row.maxDiscount,
    usageLimit: row.usageLimit,
    userLimit: row.userLimit,
    usedCount: row.usedCount,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    branchIds: row.branchIds,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
