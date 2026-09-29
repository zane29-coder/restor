import type { BaseEntity } from '../api';
import type {
  LoyaltyTransactionType,
  PromoCodeType,
  PromotionType,
  Weekday,
} from '../enums';

/* -------------------------------------------------------------------------- */
/* Customers (TZ §31, §32)                                                    */
/* -------------------------------------------------------------------------- */

export interface Customer extends BaseEntity {
  tenantId: string;
  phone: string;
  fullName: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  email: string | null;
  birthDate: string | null;
  language: string;
  isBlocked: boolean;

  /** Denormalised aggregates, recomputed when an order reaches DELIVERED. */
  ordersCount: number;
  totalSpent: number;
  averageCheck: number;
  lastOrderAt: string | null;

  addresses?: CustomerAddress[];
  favoriteProducts?: Array<{ productId: string; name: string; orderCount: number }>;
  loyalty?: LoyaltyAccount;
}

export interface CustomerAddress extends BaseEntity {
  customerId: string;
  label: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  entrance: string | null;
  floor: string | null;
  apartment: string | null;
  landmark: string | null;
  comment: string | null;
  isDefault: boolean;
}

/** Marketing segments (TZ §32). Evaluated server-side against live data. */
export const CustomerSegment = {
  NEW: 'NEW',
  VIP: 'VIP',
  INACTIVE_30D: 'INACTIVE_30D',
  TOP_SPENDER: 'TOP_SPENDER',
  FREQUENT: 'FREQUENT',
} as const;
export type CustomerSegment = (typeof CustomerSegment)[keyof typeof CustomerSegment];

export interface CustomerSegmentResult {
  segment: CustomerSegment;
  customerCount: number;
  totalSpent: number;
}

/* -------------------------------------------------------------------------- */
/* Promotions (TZ §10)                                                        */
/* -------------------------------------------------------------------------- */

export interface Promotion extends BaseEntity {
  tenantId: string;
  name: string;
  description: string | null;
  type: PromotionType;
  /** Percent for PERCENTAGE_DISCOUNT, minor units for FIXED_DISCOUNT. */
  value: number;
  /** Caps a percentage discount, in minor units. */
  maxDiscount: number | null;
  minOrderAmount: number | null;
  /** Type-specific configuration, e.g. `{ buyProductId, buyQty, getProductId }`. */
  config: Record<string, unknown>;
  startsAt: string | null;
  endsAt: string | null;
  /** Happy-hour window as `HH:mm` in the branch timezone (TZ §10). */
  timeFrom: string | null;
  timeTo: string | null;
  /** Empty means every day. */
  daysOfWeek: Weekday[];
  /** Empty means every branch. */
  branchIds: string[];
  productIds: string[];
  categoryIds: string[];
  priority: number;
  /** When false, other promotions may stack on top of this one. */
  isExclusive: boolean;
  isActive: boolean;
}

export interface PromoCode extends BaseEntity {
  tenantId: string;
  code: string;
  type: PromoCodeType;
  discount: number;
  minOrderAmount: number | null;
  maxDiscount: number | null;
  /** Total redemptions allowed; `null` is unlimited. */
  usageLimit: number | null;
  /** Redemptions allowed per customer. */
  userLimit: number | null;
  usedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  branchIds: string[];
  isActive: boolean;
}

export interface PromoCodeUsage {
  id: string;
  promoCodeId: string;
  customerId: string | null;
  orderId: string;
  discountAmount: number;
  usedAt: string;
}

export interface ValidatePromoCodeRequest {
  code: string;
  branchId: string;
  subtotal: number;
  customerId?: string;
}

export interface ValidatePromoCodeResult {
  valid: boolean;
  code: string;
  discountAmount: number;
  freeDelivery: boolean;
  reason?: string;
}

/* -------------------------------------------------------------------------- */
/* Loyalty (TZ §33)                                                           */
/* -------------------------------------------------------------------------- */

export interface LoyaltyProgram extends BaseEntity {
  tenantId: string;
  isActive: boolean;
  /** Percent of the order total returned as points. */
  cashbackPercent: number;
  /** Minor units of spend one point is worth when redeemed. */
  pointValue: number;
  /** Highest share of an order that may be paid with points, 0-100. */
  maxRedeemPercent: number;
  /** Points expire this many days after being earned; `null` never expires. */
  expiryDays: number | null;
  referralBonus: number;
  levels: LoyaltyLevel[];
}

export interface LoyaltyLevel {
  id: string;
  name: string;
  /** Lifetime spend required to reach this level. */
  thresholdSpent: number;
  cashbackPercent: number;
  sortOrder: number;
}

export interface LoyaltyAccount extends BaseEntity {
  tenantId: string;
  customerId: string;
  points: number;
  lifetimePoints: number;
  levelId: string | null;
  levelName: string | null;
  referralCode: string;
  referredByCustomerId: string | null;
}

export interface LoyaltyTransaction extends BaseEntity {
  accountId: string;
  type: LoyaltyTransactionType;
  /** Positive to credit points, negative to debit. */
  points: number;
  orderId: string | null;
  comment: string | null;
  expiresAt: string | null;
}
