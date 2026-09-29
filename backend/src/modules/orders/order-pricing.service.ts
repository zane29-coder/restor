import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  OrderType,
  PromoCodeType,
  type AppliedPromotion,
  type OrderPricePreview,
} from '@restor/shared-types';
import {
  addMoney,
  calculateDiscount,
  distanceMeters,
  isWithinRadius,
  multiplyMoney,
  normalizeCode,
  subtractMoney,
} from '@restor/shared-utils';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../database/prisma.service';

export interface PricingRequestItem {
  productId: string;
  variantId?: string;
  quantity: number;
  modifierIds?: string[];
  comment?: string;
}

export interface PricingRequest {
  branchId: string;
  type: OrderType;
  items: PricingRequestItem[];
  promoCode?: string;
  customerId?: string;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
}

/** A fully priced line, ready to be written as an `OrderItem`. */
export interface PricedItem {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
  modifiersTotal: number;
  total: number;
  comment: string | null;
  preparationTime: number;
  categoryId: string;
  modifiers: Array<{ modifierId: string; name: string; price: number }>;
}

export interface PricingResult {
  items: PricedItem[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  appliedPromotions: AppliedPromotion[];
  promoCodeId: string | null;
  warnings: string[];
  estimatedPrepMinutes: number;
}

/**
 * Prices a cart entirely from server-side data (TZ §76).
 *
 * The client sends WHAT was ordered — product ids, quantities, modifier ids —
 * and never what it costs. Every price, discount and fee is read from the
 * database here, so a tampered client cannot buy a pizza for 1 UZS.
 *
 * All arithmetic is on integers in minor units via `@restor/shared-utils`;
 * floats never touch a price.
 */
@Injectable()
export class OrderPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async price(request: PricingRequest): Promise<PricingResult> {
    const warnings: string[] = [];

    const branch = await this.prisma.db.branch.findFirst({
      where: { id: request.branchId, deletedAt: null, isActive: true },
    });
    if (!branch) throw AppException.notFound('Branch', ErrorCode.BRANCH_NOT_FOUND);

    const items = await this.priceItems(request);
    const subtotal = addMoney(...items.map((item) => item.total));

    const deliveryFee = this.deliveryFeeFor(request, branch, warnings);

    // Promotions first, then the promo code on top of the already-reduced
    // subtotal — otherwise a 20% promotion plus a 20% code could exceed 40%.
    const { discount: promotionDiscount, applied } = await this.applyPromotions(
      request,
      items,
      subtotal,
    );

    const afterPromotions = subtractMoney(subtotal, promotionDiscount);
    const promo = await this.applyPromoCode(request, afterPromotions, branch.id);

    const appliedPromotions = [...applied];
    if (promo.applied) appliedPromotions.push(promo.applied);

    const discountTotal = addMoney(promotionDiscount, promo.discount);
    const effectiveDeliveryFee = promo.freeDelivery ? 0 : deliveryFee;

    if (subtotal < branch.minOrderAmount && request.type === OrderType.DELIVERY) {
      warnings.push(
        `The minimum order for delivery at this branch is ${branch.minOrderAmount}`,
      );
    }

    const total = addMoney(subtractMoney(subtotal, discountTotal), effectiveDeliveryFee);

    return {
      items,
      subtotal,
      discountTotal,
      deliveryFee: effectiveDeliveryFee,
      serviceFee: 0,
      total,
      appliedPromotions,
      promoCodeId: promo.promoCodeId,
      warnings,
      // The kitchen works lines in parallel, so the slowest one sets the ETA.
      estimatedPrepMinutes: items.reduce(
        (max, item) => Math.max(max, item.preparationTime),
        branch.averagePrepMinutes,
      ),
    };
  }

  /** The shape the preview endpoint returns to the cart screen. */
  toPreview(result: PricingResult): OrderPricePreview {
    return {
      items: result.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        modifiersTotal: item.modifiersTotal,
        total: item.total,
      })),
      subtotal: result.subtotal,
      discountTotal: result.discountTotal,
      deliveryFee: result.deliveryFee,
      serviceFee: result.serviceFee,
      total: result.total,
      appliedPromotions: result.appliedPromotions,
      warnings: result.warnings,
    };
  }

  /* ------------------------------------------------------------------ */

  private async priceItems(request: PricingRequest): Promise<PricedItem[]> {
    const productIds = [...new Set(request.items.map((item) => item.productId))];

    const products = await this.prisma.db.product.findMany({
      where: { id: { in: productIds }, deletedAt: null, isActive: true },
      include: {
        variants: { where: { isActive: true } },
        branchSettings: { where: { branchId: request.branchId } },
        modifierGroups: {
          include: {
            modifierGroup: {
              include: { modifiers: { where: { isActive: true } } },
            },
          },
        },
      },
    });

    const byId = new Map(products.map((product) => [product.id, product]));

    return request.items.map((requested) => {
      const product = byId.get(requested.productId);
      if (!product) {
        throw AppException.notFound('Product', ErrorCode.PRODUCT_NOT_FOUND);
      }

      const setting = product.branchSettings[0];
      if (!setting?.isAvailable || setting.isStopListed) {
        throw new AppException(
          ErrorCode.PRODUCT_UNAVAILABLE,
          `"${product.name}" is not available at this branch right now`,
          409,
        );
      }

      // Precedence: branch override > discount price > list price.
      const basePrice = setting.priceOverride ?? product.discountPrice ?? product.price;

      let variantName: string | null = null;
      let unitPrice = basePrice;

      if (requested.variantId) {
        const variant = product.variants.find((entry) => entry.id === requested.variantId);
        if (!variant) {
          throw AppException.badRequest(`Unknown option for "${product.name}"`);
        }
        variantName = variant.name;
        // Clamped at zero: a misconfigured negative delta must not create a
        // negative price.
        unitPrice = Math.max(0, basePrice + variant.priceDelta);
      }

      const modifiers = this.resolveModifiers(product, requested.modifierIds ?? []);
      const modifiersPerUnit = addMoney(...modifiers.map((modifier) => modifier.price));
      const modifiersTotal = multiplyMoney(modifiersPerUnit, requested.quantity);

      const total = addMoney(
        multiplyMoney(unitPrice, requested.quantity),
        modifiersTotal,
      );

      return {
        productId: product.id,
        variantId: requested.variantId ?? null,
        name: product.name,
        variantName,
        unitPrice,
        quantity: requested.quantity,
        modifiersTotal,
        total,
        comment: requested.comment ?? null,
        preparationTime: product.preparationTime,
        categoryId: product.categoryId,
        modifiers,
      };
    });
  }

  /**
   * Validates the chosen modifiers against their group's min/max.
   *
   * Enforced here rather than only in the UI: a "choose exactly one sauce"
   * group must not end up with three sauces because someone posted directly.
   */
  private resolveModifiers(
    product: {
      name: string;
      modifierGroups: Array<{
        modifierGroup: {
          id: string;
          name: string;
          minSelect: number;
          maxSelect: number;
          modifiers: Array<{ id: string; name: string; price: number }>;
        };
      }>;
    },
    modifierIds: string[],
  ): Array<{ modifierId: string; name: string; price: number }> {
    const selected = new Set(modifierIds);
    const resolved: Array<{ modifierId: string; name: string; price: number }> = [];

    for (const link of product.modifierGroups) {
      const group = link.modifierGroup;
      const chosen = group.modifiers.filter((modifier) => selected.has(modifier.id));

      if (chosen.length < group.minSelect || chosen.length > group.maxSelect) {
        throw new AppException(
          ErrorCode.MODIFIER_SELECTION_INVALID,
          `"${group.name}" for "${product.name}" requires between ${group.minSelect} and ${group.maxSelect} choice(s)`,
          422,
        );
      }

      for (const modifier of chosen) {
        resolved.push({ modifierId: modifier.id, name: modifier.name, price: modifier.price });
        selected.delete(modifier.id);
      }
    }

    // Anything left over belongs to another product — reject rather than
    // silently ignore, so a client bug surfaces instead of charging wrongly.
    if (selected.size > 0) {
      throw new AppException(
        ErrorCode.MODIFIER_SELECTION_INVALID,
        `Some selected options do not belong to "${product.name}"`,
        422,
      );
    }

    return resolved;
  }

  private deliveryFeeFor(
    request: PricingRequest,
    branch: {
      deliveryPrice: number;
      deliveryRadiusM: number | null;
      latitude: number | null;
      longitude: number | null;
      acceptsDelivery: boolean;
    },
    warnings: string[],
  ): number {
    if (request.type !== OrderType.DELIVERY) return 0;

    if (!branch.acceptsDelivery) {
      throw AppException.badRequest('This branch does not deliver');
    }

    const hasTarget =
      request.deliveryLatitude != null && request.deliveryLongitude != null;
    const hasOrigin = branch.latitude != null && branch.longitude != null;

    if (hasTarget && hasOrigin) {
      const origin = { latitude: branch.latitude!, longitude: branch.longitude! };
      const target = {
        latitude: request.deliveryLatitude!,
        longitude: request.deliveryLongitude!,
      };

      if (!isWithinRadius(origin, target, branch.deliveryRadiusM)) {
        throw new AppException(
          ErrorCode.OUTSIDE_DELIVERY_RADIUS,
          'That address is outside this branch’s delivery area',
          422,
        );
      }
    } else if (branch.deliveryRadiusM != null) {
      // Without coordinates the radius cannot be checked; the order is still
      // accepted, but the dispatcher is told to confirm.
      warnings.push('Delivery address has no coordinates; the radius was not verified');
    }

    return branch.deliveryPrice;
  }

  /**
   * Automatic promotions (TZ §10).
   *
   * Evaluated in priority order. The first EXCLUSIVE promotion that applies
   * wins and stops the loop; non-exclusive ones stack.
   */
  private async applyPromotions(
    request: PricingRequest,
    items: PricedItem[],
    subtotal: number,
  ): Promise<{ discount: number; applied: AppliedPromotion[] }> {
    const now = new Date();

    const promotions = await this.prisma.db.promotion.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { priority: 'desc' },
    });

    const applied: AppliedPromotion[] = [];
    let discount = 0;

    for (const promotion of promotions) {
      if (!this.promotionApplies(promotion, request, items, subtotal, now)) continue;

      const amount = this.promotionAmount(promotion, items, subtotal);
      if (amount <= 0) continue;

      applied.push({ promotionId: promotion.id, promoCodeId: null, name: promotion.name, amount });
      discount = addMoney(discount, amount);

      if (promotion.isExclusive) break;
    }

    // A discount can never exceed what is being discounted.
    return { discount: Math.min(discount, subtotal), applied };
  }

  private promotionApplies(
    promotion: {
      branchIds: string[];
      productIds: string[];
      categoryIds: string[];
      daysOfWeek: number[];
      timeFrom: string | null;
      timeTo: string | null;
      minOrderAmount: number | null;
    },
    request: PricingRequest,
    items: PricedItem[],
    subtotal: number,
    now: Date,
  ): boolean {
    if (promotion.branchIds.length > 0 && !promotion.branchIds.includes(request.branchId)) {
      return false;
    }
    if (promotion.minOrderAmount !== null && subtotal < promotion.minOrderAmount) {
      return false;
    }
    if (promotion.productIds.length > 0) {
      if (!items.some((item) => promotion.productIds.includes(item.productId))) return false;
    }
    if (promotion.categoryIds.length > 0) {
      if (!items.some((item) => promotion.categoryIds.includes(item.categoryId))) return false;
    }

    // ISO weekday: JS Sunday is 0, ours is 7.
    const weekday = now.getDay() === 0 ? 7 : now.getDay();
    if (promotion.daysOfWeek.length > 0 && !promotion.daysOfWeek.includes(weekday)) {
      return false;
    }

    if (promotion.timeFrom && promotion.timeTo) {
      const minutes = now.getHours() * 60 + now.getMinutes();
      const from = toMinutes(promotion.timeFrom);
      const to = toMinutes(promotion.timeTo);
      const inWindow = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
      if (!inWindow) return false;
    }

    return true;
  }

  private promotionAmount(
    promotion: { type: string; value: number; maxDiscount: number | null; productIds: string[]; categoryIds: string[] },
    items: PricedItem[],
    subtotal: number,
  ): number {
    // Percentage promotions apply only to the lines they target.
    const targeted =
      promotion.productIds.length === 0 && promotion.categoryIds.length === 0
        ? subtotal
        : addMoney(
            ...items
              .filter(
                (item) =>
                  promotion.productIds.includes(item.productId) ||
                  promotion.categoryIds.includes(item.categoryId),
              )
              .map((item) => item.total),
          );

    switch (promotion.type) {
      case 'PERCENTAGE_DISCOUNT':
      case 'HAPPY_HOUR':
        return calculateDiscount(targeted, promotion.value, promotion.maxDiscount);
      case 'FIXED_DISCOUNT':
        return Math.min(promotion.value, targeted);
      case 'FREE_DELIVERY':
        // Handled by the delivery-fee path, not as a subtotal discount.
        return 0;
      default:
        // BUY_X_GET_Y and COMBO need per-line logic; not in this milestone.
        return 0;
    }
  }

  /** Promo code (TZ §34), validated against limits and per-customer usage. */
  private async applyPromoCode(
    request: PricingRequest,
    subtotal: number,
    branchId: string,
  ): Promise<{
    discount: number;
    freeDelivery: boolean;
    promoCodeId: string | null;
    applied: AppliedPromotion | null;
  }> {
    const none = { discount: 0, freeDelivery: false, promoCodeId: null, applied: null };
    if (!request.promoCode) return none;

    const code = normalizeCode(request.promoCode);
    const now = new Date();

    const promo = await this.prisma.db.promoCode.findFirst({
      where: { code, deletedAt: null, isActive: true },
    });

    if (!promo) {
      throw AppException.notFound('Promo code', ErrorCode.PROMO_CODE_NOT_FOUND);
    }

    if ((promo.startsAt && promo.startsAt > now) || (promo.endsAt && promo.endsAt < now)) {
      throw new AppException(ErrorCode.PROMO_CODE_EXPIRED, 'This promo code has expired', 422);
    }

    if (promo.branchIds.length > 0 && !promo.branchIds.includes(branchId)) {
      throw new AppException(
        ErrorCode.PROMO_CODE_NOT_APPLICABLE,
        'This promo code is not valid at this branch',
        422,
      );
    }

    if (promo.minOrderAmount !== null && subtotal < promo.minOrderAmount) {
      throw new AppException(
        ErrorCode.PROMO_CODE_NOT_APPLICABLE,
        `This code needs a minimum order of ${promo.minOrderAmount}`,
        422,
      );
    }

    if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) {
      throw new AppException(
        ErrorCode.PROMO_CODE_LIMIT_REACHED,
        'This promo code has been fully redeemed',
        422,
      );
    }

    if (promo.userLimit !== null && request.customerId) {
      const used = await this.prisma.db.promoCodeUsage.count({
        where: { promoCodeId: promo.id, customerId: request.customerId },
      });
      if (used >= promo.userLimit) {
        throw new AppException(
          ErrorCode.PROMO_CODE_LIMIT_REACHED,
          'You have already used this promo code',
          422,
        );
      }
    }

    if (promo.type === PromoCodeType.FREE_DELIVERY) {
      return {
        discount: 0,
        freeDelivery: true,
        promoCodeId: promo.id,
        applied: { promotionId: null, promoCodeId: promo.id, name: promo.code, amount: 0 },
      };
    }

    const discount =
      promo.type === PromoCodeType.PERCENTAGE
        ? calculateDiscount(subtotal, promo.discount, promo.maxDiscount)
        : Math.min(promo.discount, subtotal);

    return {
      discount,
      freeDelivery: false,
      promoCodeId: promo.id,
      applied: { promotionId: null, promoCodeId: promo.id, name: promo.code, amount: discount },
    };
  }
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
