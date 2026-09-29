import type { BaseEntity } from '../api';
import type {
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
} from '../enums';

export interface Order extends BaseEntity {
  tenantId: string;
  branchId: string;
  branch?: { id: string; name: string };

  /**
   * Per-branch sequential counter (TZ §41). The UUID `id` is internal; this is
   * what staff and customers say out loud.
   */
  number: number;
  /** Human-readable label, e.g. `CH-1054`. */
  displayNumber: string;

  type: OrderType;
  source: OrderSource;
  status: OrderStatus;
  paymentStatus: PaymentStatus;

  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;

  items: OrderItem[];

  /** All money fields are minor units of the tenant's currency. */
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  /** Sum of settled payments; `total - paidTotal` is what is still owed. */
  paidTotal: number;
  refundedTotal: number;

  /** Delivery target, denormalised so history survives address edits. */
  deliveryAddress: OrderDeliveryAddress | null;
  /** Dine-in / QR orders only. */
  tableId: string | null;
  tableNumber: string | null;

  courierId: string | null;
  promoCodeId: string | null;
  appliedPromotions: AppliedPromotion[];

  comment: string | null;
  cancelReason: string | null;
  /** When the kitchen expects to finish, computed at ACCEPTED. */
  estimatedReadyAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;

  createdByUserId: string | null;
  /**
   * Client-generated UUID for idempotency. A POS that went offline replays the
   * same value, and the second attempt returns the first order (TZ §18).
   */
  clientUuid: string | null;
}

/** A delivery address as STORED on an order: every field is always present. */
export interface OrderDeliveryAddress {
  label: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  entrance: string | null;
  floor: string | null;
  apartment: string | null;
  landmark: string | null;
  comment: string | null;
}

/**
 * A delivery address as SUBMITTED.
 *
 * Only the street line is required — a customer ordering from a phone should
 * not have to fill in an entrance and a landmark to place an order, and the
 * courier can call. Kept separate from {@link OrderDeliveryAddress} so the
 * stored shape stays exhaustive while the input stays forgiving.
 */
export interface OrderDeliveryAddressInput {
  address: string;
  label?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  entrance?: string | null;
  floor?: string | null;
  apartment?: string | null;
  landmark?: string | null;
  comment?: string | null;
}

export interface OrderItem extends BaseEntity {
  orderId: string;
  productId: string | null;
  variantId: string | null;
  /**
   * Name and price are snapshotted at order time so later menu edits never
   * rewrite history or a printed receipt.
   */
  name: string;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
  /** `(unitPrice + modifiers) * quantity`, after item-level discount. */
  total: number;
  discountTotal: number;
  comment: string | null;
  modifiers: OrderItemModifier[];
}

export interface OrderItemModifier {
  id: string;
  orderItemId: string;
  modifierId: string | null;
  name: string;
  price: number;
  quantity: number;
}

export interface AppliedPromotion {
  promotionId: string | null;
  promoCodeId: string | null;
  name: string;
  /** Discount contributed by this promotion, in minor units. */
  amount: number;
}

/** One row of the order timeline (TZ §13). */
export interface OrderStatusHistoryEntry {
  id: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  userId: string | null;
  userName: string | null;
  comment: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export interface CreateOrderRequest {
  branchId: string;
  type: OrderType;
  source?: OrderSource;
  items: CreateOrderItemRequest[];
  customer?: {
    id?: string;
    name?: string;
    phone?: string;
  };
  deliveryAddress?: OrderDeliveryAddressInput;
  addressId?: string;
  tableId?: string;
  promoCode?: string;
  comment?: string;
  /** Intended method; the payment itself is recorded separately. */
  paymentMethod?: PaymentMethod;
  /** Idempotency key — required from the POS, optional elsewhere. */
  clientUuid?: string;
  /** Schedule the order for later; must be inside the branch's working hours. */
  scheduledFor?: string;
}

export interface CreateOrderItemRequest {
  productId: string;
  variantId?: string;
  quantity: number;
  modifierIds?: string[];
  comment?: string;
}

export interface UpdateOrderStatusRequest {
  status: OrderStatus;
  comment?: string;
  /** Required when moving to CANCELLED. */
  cancelReason?: string;
}

export interface AssignCourierRequest {
  courierId: string;
  comment?: string;
}

export interface OrderListQuery {
  branchId?: string;
  status?: OrderStatus | OrderStatus[];
  type?: OrderType;
  source?: OrderSource;
  paymentStatus?: PaymentStatus;
  courierId?: string;
  customerId?: string;
  /** ISO datetimes; both are inclusive. */
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Price breakdown returned by the cart-preview endpoint, so the client can
 * show an exact total before the order exists. Computed server-side: the
 * client never calculates money (TZ §76).
 */
export interface OrderPricePreview {
  items: Array<{
    productId: string;
    variantId: string | null;
    name: string;
    unitPrice: number;
    quantity: number;
    modifiersTotal: number;
    total: number;
  }>;
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  appliedPromotions: AppliedPromotion[];
  /** Populated when the cart is below the branch minimum, etc. */
  warnings: string[];
}
