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
  isPointInPolygon,
  isWithinRadius,
  multiplyMoney,
  normalizeCode,
  subtractMoney,
  toLatLngRing,
  type Coordinates,
  type LatLngRing,
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
  /**
   * The delivery minimum that applies to THIS address: the zone's when the
   * address fell in a zone that sets one, the branch's otherwise.
   */
  minOrderAmount: number;
  /** The drawn zone that priced the delivery, when the branch uses zones. */
  deliveryZone: { id: string; name: string } | null;
}

/** A drawn delivery zone, as pricing reads it. */
export interface PricingZone {
  id: string;
  name: string;
  polygon: LatLngRing;
  deliveryPrice: number;
  minOrderAmount: number | null;
  freeDeliveryFrom: number | null;
  sortOrder: number;
}

/**
 * The zone that contains `point`.
 *
 * Where zones overlap the lowest `sortOrder` wins, so an owner can draw a
 * cheap inner zone on top of a wider outer one and the inner tariff applies
 * near the branch. `null` means the point is outside every zone.
 */
export function zoneFor(point: Coordinates, zones: readonly PricingZone[]): PricingZone | null {
  const ordered = [...zones].sort((a, b) => a.sortOrder - b.sortOrder);
  return ordered.find((zone) => isPointInPolygon(point, zone.polygon)) ?? null;
}

/**
 * What a delivery costs inside a zone: its flat price, or nothing once the
 * discounted goods total reaches the zone's free threshold. Same threshold
 * rule as the branch's `freeDeliveryFrom`, measured on what the customer pays.
 */
export function zoneFeeFor(
  zone: Pick<PricingZone, 'deliveryPrice' | 'freeDeliveryFrom'>,
  goodsTotal: number,
): number {
  if (zone.freeDeliveryFrom != null && goodsTotal >= zone.freeDeliveryFrom) return 0;
  return zone.deliveryPrice;
}

/** The delivery-charge rules a branch can configure (TZ §11). */
export interface DeliveryPricing {
  deliveryPrice: number;
  freeDeliveryRadiusM: number | null;
  freeDeliveryFrom: number | null;
  deliveryPricePerKm: number | null;
}

/**
 * What a delivery costs.
 *
 * Extracted and pure so the arithmetic can be tested exhaustively without a
 * database: this decides what a customer is charged, and an off-by-one in the
 * kilometre rounding is the kind of error nobody notices until a month of
 * orders has been mispriced.
 *
 * Three rules a restaurant can combine, checked in this order:
 *
 *  1. `freeDeliveryFrom` — free once the order is big enough, at any
 *     distance. The usual "free over 100 000" offer.
 *  2. `freeDeliveryRadiusM` — free close to the branch. "Free within 1 km."
 *  3. `deliveryPricePerKm` — beyond the free zone, a charge per started
 *     kilometre on top of the base price. `null` keeps the price flat.
 *
 * A branch that sets none of them keeps a single flat `deliveryPrice`, and one
 * that also sets that to zero delivers free everywhere. Both stay valid: this
 * adds options, it does not require them.
 *
 * `distanceM` is `null` when the distance is unknown — a phone order with no
 * map pin. Every distance-based rule then stands down and the flat price
 * applies, which is the only honest answer when nobody knows how far it is.
 */
export function deliveryFeeFor(
  branch: DeliveryPricing,
  distanceM: number | null,
  goodsTotal: number,
): number {
  if (branch.freeDeliveryFrom != null && goodsTotal >= branch.freeDeliveryFrom) {
    return 0;
  }

  const freeRadiusM = branch.freeDeliveryRadiusM;
  if (freeRadiusM != null && distanceM != null && distanceM <= freeRadiusM) {
    return 0;
  }

  if (branch.deliveryPricePerKm == null || distanceM == null) {
    return branch.deliveryPrice;
  }

  // Charged from the edge of the free zone outwards, per started kilometre:
  // 1 200 m with a 1 km free zone is one chargeable kilometre, not two.
  const chargeableM = Math.max(0, distanceM - (freeRadiusM ?? 0));
  const chargeableKm = Math.ceil(chargeableM / 1000);

  return addMoney(branch.deliveryPrice, multiplyMoney(branch.deliveryPricePerKm, chargeableKm));
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

    // Drawn zones, when the branch has any, replace the radius as its
    // delivery area.
    const zones =
      request.type === OrderType.DELIVERY
        ? (
            await this.prisma.db.deliveryZone.findMany({
              where: { branchId: branch.id, isActive: true },
              orderBy: { sortOrder: 'asc' },
            })
          ).map((row) => ({ ...row, polygon: toLatLngRing(row.polygon) }))
        : [];

    // Deliverability is settled before any discount work: an address outside
    // the area is refused, not priced, and there is no point evaluating
    // promotions for an order that cannot be delivered.
    const distanceM = this.assertDeliverable(request, branch, warnings, zones.length > 0);
    const zone = this.resolveZone(request, zones, warnings);

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

    // The free-delivery threshold is measured on what the customer actually
    // pays for the goods, not the pre-discount subtotal: a code that halves a
    // basket should not still earn the reward for a large order.
    const goodsTotal = subtractMoney(subtotal, discountTotal);
    const deliveryFee =
      request.type === OrderType.DELIVERY && zone
        ? zoneFeeFor(zone, goodsTotal)
        : this.deliveryFeeFor(request, branch, distanceM, goodsTotal);
    const effectiveDeliveryFee = promo.freeDelivery ? 0 : deliveryFee;
    const minOrderAmount = zone?.minOrderAmount ?? branch.minOrderAmount;

    if (subtotal < minOrderAmount && request.type === OrderType.DELIVERY) {
      warnings.push(`The minimum order for delivery at this address is ${minOrderAmount}`);
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
      minOrderAmount,
      deliveryZone: zone ? { id: zone.id, name: zone.name } : null,
    };
  }

  /**
   * The zone this delivery falls in, when the branch delivers by zones.
   *
   * `null` both when the branch has no zones and when the address has no
   * coordinates — the latter is accepted at the branch's flat price with a
   * warning, exactly as the radius check treats a phone order with no pin.
   * An address with coordinates outside every zone is refused.
   */
  private resolveZone(
    request: PricingRequest,
    zones: PricingZone[],
    warnings: string[],
  ): PricingZone | null {
    if (request.type !== OrderType.DELIVERY || zones.length === 0) return null;

    if (request.deliveryLatitude == null || request.deliveryLongitude == null) {
      warnings.push('Delivery address has no coordinates; the delivery zone was not verified');
      return null;
    }

    const zone = zoneFor(
      { latitude: request.deliveryLatitude, longitude: request.deliveryLongitude },
      zones,
    );
    if (!zone) {
      throw new AppException(
        ErrorCode.OUTSIDE_DELIVERY_RADIUS,
        'Bu manzil filialning yetkazib berish hududidan tashqarida',
        422,
      );
    }
    return zone;
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

  /**
   * Refuses an undeliverable address and reports how far it is.
   *
   * Returns `null` when the distance is unknown — either the branch has no
   * coordinates or the address does not. That is not an error: plenty of
   * orders are typed in by phone with no map pin, and refusing them would be
   * worse than pricing them at the flat rate.
   */
  private assertDeliverable(
    request: PricingRequest,
    branch: {
      deliveryRadiusM: number | null;
      latitude: number | null;
      longitude: number | null;
      acceptsDelivery: boolean;
    },
    warnings: string[],
    /** Drawn zones define the area instead; the radius then stands down. */
    usesZones = false,
  ): number | null {
    if (request.type !== OrderType.DELIVERY) return null;

    if (!branch.acceptsDelivery) {
      throw AppException.badRequest('This branch does not deliver');
    }

    const hasTarget = request.deliveryLatitude != null && request.deliveryLongitude != null;
    const hasOrigin = branch.latitude != null && branch.longitude != null;

    if (!hasTarget || !hasOrigin) {
      if (branch.deliveryRadiusM != null && !usesZones) {
        // Without coordinates the radius cannot be checked; the order is still
        // accepted, but the dispatcher is told to confirm.
        warnings.push('Delivery address has no coordinates; the radius was not verified');
      }
      return null;
    }

    const distanceM = distanceMeters(
      { latitude: branch.latitude!, longitude: branch.longitude! },
      { latitude: request.deliveryLatitude!, longitude: request.deliveryLongitude! },
    );

    if (!usesZones && !isWithinRadius(
      { latitude: branch.latitude!, longitude: branch.longitude! },
      { latitude: request.deliveryLatitude!, longitude: request.deliveryLongitude! },
      branch.deliveryRadiusM,
    )) {
      throw new AppException(
        ErrorCode.OUTSIDE_DELIVERY_RADIUS,
        'That address is outside this branch’s delivery area',
        422,
      );
    }

    return distanceM;
  }

  private deliveryFeeFor(
    request: PricingRequest,
    branch: DeliveryPricing,
    distanceM: number | null,
    goodsTotal: number,
  ): number {
    if (request.type !== OrderType.DELIVERY) return 0;
    return deliveryFeeFor(branch, distanceM, goodsTotal);
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
