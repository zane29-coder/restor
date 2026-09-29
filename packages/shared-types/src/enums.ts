/**
 * Domain enums shared by the backend and every client.
 *
 * These are mirrored one-for-one by the Prisma enums in
 * `backend/prisma/schema.prisma`. Changing a member here without a matching
 * migration will drift the contract, so treat the two as a single unit.
 *
 * They are `const` objects rather than TS `enum`s so the values survive
 * `isolatedModules`, tree-shake cleanly, and can be iterated at runtime.
 */

/* -------------------------------------------------------------------------- */
/* Tenant & subscription (TZ §4, §6)                                          */
/* -------------------------------------------------------------------------- */

export const TenantStatus = {
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const SubscriptionStatus = {
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/* -------------------------------------------------------------------------- */
/* Orders (TZ §12)                                                            */
/* -------------------------------------------------------------------------- */

export const OrderStatus = {
  NEW: 'NEW',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  WAITING_COURIER: 'WAITING_COURIER',
  COURIER_ASSIGNED: 'COURIER_ASSIGNED',
  ON_DELIVERY: 'ON_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Statuses after which an order no longer moves. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

/**
 * Allowed status transitions. The order service validates against this map, so
 * a client cannot jump an order straight from NEW to DELIVERED.
 *
 * PICKUP and DINE_IN orders finish at READY -> DELIVERED (handed to the guest);
 * DELIVERY orders travel the courier path.
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  NEW: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  ACCEPTED: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.READY, OrderStatus.CANCELLED],
  READY: [OrderStatus.WAITING_COURIER, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  WAITING_COURIER: [OrderStatus.COURIER_ASSIGNED, OrderStatus.CANCELLED],
  COURIER_ASSIGNED: [OrderStatus.ON_DELIVERY, OrderStatus.WAITING_COURIER, OrderStatus.CANCELLED],
  ON_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [OrderStatus.REFUNDED],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

export const OrderType = {
  DELIVERY: 'DELIVERY',
  PICKUP: 'PICKUP',
  DINE_IN: 'DINE_IN',
  TABLE: 'TABLE',
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

/** Which client created the order — drives analytics splits on the dashboard. */
export const OrderSource = {
  TELEGRAM_MINI_APP: 'TELEGRAM_MINI_APP',
  TELEGRAM_BOT: 'TELEGRAM_BOT',
  WEB: 'WEB',
  POS: 'POS',
  QR_TABLE: 'QR_TABLE',
  CALL_CENTER: 'CALL_CENTER',
  ADMIN: 'ADMIN',
} as const;
export type OrderSource = (typeof OrderSource)[keyof typeof OrderSource];

export const PaymentStatus = {
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/* -------------------------------------------------------------------------- */
/* Payments (TZ §17, §35)                                                     */
/* -------------------------------------------------------------------------- */

export const PaymentMethod = {
  CASH: 'CASH',
  CARD: 'CARD',
  TERMINAL: 'TERMINAL',
  CLICK: 'CLICK',
  PAYME: 'PAYME',
  QR: 'QR',
  BONUS: 'BONUS',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/** Methods settled through an external provider webhook rather than at the till. */
export const ONLINE_PAYMENT_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CLICK,
  PaymentMethod.PAYME,
  PaymentMethod.QR,
];

export const PaymentTransactionStatus = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentTransactionStatus =
  (typeof PaymentTransactionStatus)[keyof typeof PaymentTransactionStatus];

export const PaymentTransactionType = {
  CHARGE: 'CHARGE',
  REFUND: 'REFUND',
} as const;
export type PaymentTransactionType =
  (typeof PaymentTransactionType)[keyof typeof PaymentTransactionType];

/* -------------------------------------------------------------------------- */
/* Cash register (TZ §19, §28)                                                */
/* -------------------------------------------------------------------------- */

export const CashShiftStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type CashShiftStatus = (typeof CashShiftStatus)[keyof typeof CashShiftStatus];

export const CashTransactionType = {
  SALE: 'SALE',
  REFUND: 'REFUND',
  /** Manual cash put into the drawer (e.g. float top-up). */
  CASH_IN: 'CASH_IN',
  /** Manual cash taken out (e.g. supplier payment). */
  CASH_OUT: 'CASH_OUT',
  /** Courier handing collected cash to the cashier. */
  COURIER_HANDOVER: 'COURIER_HANDOVER',
  /** Cash counted into the drawer when the shift opens. */
  OPENING_FLOAT: 'OPENING_FLOAT',
  /** Cash removed when the shift closes. */
  WITHDRAWAL: 'WITHDRAWAL',
} as const;
export type CashTransactionType =
  (typeof CashTransactionType)[keyof typeof CashTransactionType];

/* -------------------------------------------------------------------------- */
/* Couriers & delivery (TZ §23-§28)                                           */
/* -------------------------------------------------------------------------- */

export const CourierStatus = {
  OFFLINE: 'OFFLINE',
  AVAILABLE: 'AVAILABLE',
  ON_DELIVERY: 'ON_DELIVERY',
  BREAK: 'BREAK',
} as const;
export type CourierStatus = (typeof CourierStatus)[keyof typeof CourierStatus];

export const VehicleType = {
  FOOT: 'FOOT',
  BICYCLE: 'BICYCLE',
  SCOOTER: 'SCOOTER',
  MOTORCYCLE: 'MOTORCYCLE',
  CAR: 'CAR',
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];

export const DeliveryStatus = {
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  ACCEPTED: 'ACCEPTED',
  PICKED_UP: 'PICKED_UP',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const CourierTransactionType = {
  /** Cash collected from a customer on delivery. */
  CASH_RECEIVED: 'CASH_RECEIVED',
  /** Courier's own earning for the delivery. */
  DELIVERY_INCOME: 'DELIVERY_INCOME',
  EXPENSE: 'EXPENSE',
  /** Cash handed to the cashier — reduces the balance the courier owes. */
  HANDOVER: 'HANDOVER',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type CourierTransactionType =
  (typeof CourierTransactionType)[keyof typeof CourierTransactionType];

export const HandoverStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  DISPUTED: 'DISPUTED',
  CANCELLED: 'CANCELLED',
} as const;
export type HandoverStatus = (typeof HandoverStatus)[keyof typeof HandoverStatus];

/* -------------------------------------------------------------------------- */
/* Promotions & loyalty (TZ §10, §33, §34)                                    */
/* -------------------------------------------------------------------------- */

export const PromotionType = {
  PERCENTAGE_DISCOUNT: 'PERCENTAGE_DISCOUNT',
  FIXED_DISCOUNT: 'FIXED_DISCOUNT',
  BUY_X_GET_Y: 'BUY_X_GET_Y',
  COMBO: 'COMBO',
  HAPPY_HOUR: 'HAPPY_HOUR',
  FREE_DELIVERY: 'FREE_DELIVERY',
} as const;
export type PromotionType = (typeof PromotionType)[keyof typeof PromotionType];

export const PromoCodeType = {
  PERCENTAGE: 'PERCENTAGE',
  FIXED: 'FIXED',
  FREE_DELIVERY: 'FREE_DELIVERY',
} as const;
export type PromoCodeType = (typeof PromoCodeType)[keyof typeof PromoCodeType];

export const LoyaltyTransactionType = {
  EARN: 'EARN',
  REDEEM: 'REDEEM',
  EXPIRE: 'EXPIRE',
  ADJUSTMENT: 'ADJUSTMENT',
  REFERRAL_BONUS: 'REFERRAL_BONUS',
} as const;
export type LoyaltyTransactionType =
  (typeof LoyaltyTransactionType)[keyof typeof LoyaltyTransactionType];

/* -------------------------------------------------------------------------- */
/* Telegram (TZ §15)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Events a branch can route to a specific Telegram chat + topic.
 * The admin picks a chat/topic per event, per branch.
 */
export const TelegramEvent = {
  NEW_ORDER: 'NEW_ORDER',
  ORDER_ACCEPTED: 'ORDER_ACCEPTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  KITCHEN_READY: 'KITCHEN_READY',
  COURIER_ASSIGNED: 'COURIER_ASSIGNED',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  DELIVERY_PROBLEM: 'DELIVERY_PROBLEM',
  WAITER_CALL: 'WAITER_CALL',
  SHIFT_CLOSED: 'SHIFT_CLOSED',
} as const;
export type TelegramEvent = (typeof TelegramEvent)[keyof typeof TelegramEvent];

/* -------------------------------------------------------------------------- */
/* Notifications (TZ §38)                                                     */
/* -------------------------------------------------------------------------- */

export const NotificationChannel = {
  TELEGRAM: 'TELEGRAM',
  PUSH: 'PUSH',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
} as const;
export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type NotificationStatus =
  (typeof NotificationStatus)[keyof typeof NotificationStatus];

/* -------------------------------------------------------------------------- */
/* Kitchen (TZ §21, §22)                                                      */
/* -------------------------------------------------------------------------- */

export const KitchenTicketStatus = {
  QUEUED: 'QUEUED',
  IN_PROGRESS: 'IN_PROGRESS',
  READY: 'READY',
  SERVED: 'SERVED',
  CANCELLED: 'CANCELLED',
} as const;
export type KitchenTicketStatus =
  (typeof KitchenTicketStatus)[keyof typeof KitchenTicketStatus];

/* -------------------------------------------------------------------------- */
/* Tables / waiter calls (TZ §29, §30)                                        */
/* -------------------------------------------------------------------------- */

export const WaiterCallType = {
  CALL_WAITER: 'CALL_WAITER',
  REQUEST_BILL: 'REQUEST_BILL',
} as const;
export type WaiterCallType = (typeof WaiterCallType)[keyof typeof WaiterCallType];

export const WaiterCallStatus = {
  PENDING: 'PENDING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED',
} as const;
export type WaiterCallStatus = (typeof WaiterCallStatus)[keyof typeof WaiterCallStatus];

/* -------------------------------------------------------------------------- */
/* Storage (TZ §39)                                                           */
/* -------------------------------------------------------------------------- */

export const StorageProvider = {
  LOCAL: 'LOCAL',
  S3: 'S3',
  MINIO: 'MINIO',
} as const;
export type StorageProvider = (typeof StorageProvider)[keyof typeof StorageProvider];

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

/** ISO-8601 weekday numbering: 1 = Monday … 7 = Sunday. */
export const Weekday = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
} as const;
export type Weekday = (typeof Weekday)[keyof typeof Weekday];

export const Currency = {
  UZS: 'UZS',
  USD: 'USD',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];
