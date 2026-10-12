import type { BaseEntity } from '../api';
import type {
  KitchenTicketStatus,
  NotificationChannel,
  NotificationStatus,
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  ReservationStatus,
  StorageProvider,
  TableShape,
  TelegramEvent,
  WaiterCallStatus,
  WaiterCallType,
} from '../enums';

/* -------------------------------------------------------------------------- */
/* Telegram routing (TZ §15)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Bot credentials for a tenant, optionally narrowed to one branch.
 * The token is write-only: it is stored encrypted and never returned.
 */
export interface TelegramConfig extends BaseEntity {
  tenantId: string;
  branchId: string | null;
  botUsername: string | null;
  /** Whether a bot token is stored — the token itself is never serialised. */
  hasToken: boolean;
  /** Default group chat, used for any event without its own route. */
  defaultChatId: string | null;
  isActive: boolean;
  routes: TelegramRoute[];
}

/** One event → chat/topic binding (TZ §15). */
export interface TelegramRoute extends BaseEntity {
  configId: string;
  branchId: string | null;
  event: TelegramEvent;
  /** Supergroup id, e.g. `-1001234567890`. */
  chatId: string;
  /** Forum topic (`message_thread_id`); `null` posts to the general topic. */
  topicId: number | null;
  isActive: boolean;
}

export interface UpsertTelegramRouteRequest {
  event: TelegramEvent;
  chatId: string;
  topicId?: number | null;
  branchId?: string | null;
  isActive?: boolean;
}

/**
 * Live state of a restaurant's bot (TZ §14).
 *
 * Exists to answer one question — "why is the bot silent?" — which the config
 * alone cannot. A stored token says nothing about whether Telegram is actually
 * delivering anywhere, and a bot that was never pointed at this deployment
 * looks identical to a working one until somebody presses /start.
 */
export interface TelegramBotStatus {
  hasToken: boolean;
  isActive: boolean;
  botUsername: string | null;
  /** `https://t.me/{username}` — what a customer opens. */
  botLink: string | null;
  /** Mini App address for this restaurant, carrying its slug. */
  miniAppUrl: string;
  /** Where Telegram currently delivers this bot's updates; `null` when nowhere. */
  webhookUrl: string | null;
  /** Where this deployment needs them delivered. */
  expectedWebhookUrl: string;
  /** The two above agree. Anything else and the bot does not answer here. */
  isConnected: boolean;
  /** Updates Telegram is holding; a growing number means deliveries are failing. */
  pendingUpdateCount: number;
  lastErrorAt: string | null;
  /** Telegram's own words about its last failed delivery. */
  lastErrorMessage: string | null;
  /** Screen-ready summary, in Uzbek. */
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Notifications (TZ §38)                                                     */
/* -------------------------------------------------------------------------- */

export interface Notification extends BaseEntity {
  tenantId: string | null;
  channel: NotificationChannel;
  /** Chat id, phone, device token or email depending on the channel. */
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  attempts: number;
  errorMessage: string | null;
  sentAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Kitchen (TZ §21, §22)                                                      */
/* -------------------------------------------------------------------------- */

/** A kitchen station an order's items can be routed to (TZ §22). */
export interface KitchenStation extends BaseEntity {
  tenantId: string;
  branchId: string;
  name: string;
  /** Categories whose products are prepared at this station. */
  categoryIds: string[];
  sortOrder: number;
  isActive: boolean;
}

/**
 * What one KDS screen shows. A single order may produce several tickets when
 * its items belong to different stations.
 */
export interface KitchenTicket {
  id: string;
  orderId: string;
  displayNumber: string;
  branchId: string;
  stationId: string | null;
  status: KitchenTicketStatus;
  source: OrderSource;
  items: Array<{
    id: string;
    name: string;
    variantName: string | null;
    quantity: number;
    modifiers: string[];
    comment: string | null;
  }>;
  comment: string | null;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  /** Seconds since creation — drives the card's colour band (TZ §21). */
  elapsedSeconds: number;
}

/** Colour thresholds for the KDS timer, in minutes. */
export const KDS_TIMER_THRESHOLDS = {
  normalMaxMinutes: 10,
  warningMaxMinutes: 20,
} as const;

/* -------------------------------------------------------------------------- */
/* Tables & waiter calls (TZ §29, §30)                                        */
/* -------------------------------------------------------------------------- */

export interface RestaurantTable extends BaseEntity {
  tenantId: string;
  branchId: string;
  number: string;
  name: string | null;
  seats: number | null;
  zone: string | null;
  /** Random token embedded in the QR code; rotating it invalidates old codes. */
  qrToken: string;
  /** Fully-qualified URL a guest lands on after scanning. */
  qrUrl: string;
  isActive: boolean;
  /** Centre on the zone's plan, in units of a 1000 × 625 canvas; null until placed. */
  layoutX: number | null;
  layoutY: number | null;
  shape: TableShape;
}

export interface WaiterCall extends BaseEntity {
  tenantId: string;
  branchId: string;
  tableId: string;
  tableNumber: string;
  type: WaiterCallType;
  status: WaiterCallStatus;
  acknowledgedByUserId: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface TableReservation extends BaseEntity {
  branchId: string;
  tableId: string | null;
  tableNumber: string | null;
  guestName: string;
  guestPhone: string;
  partySize: number;
  startsAt: string;
  durationMinutes: number;
  status: ReservationStatus;
  note: string | null;
  seatedAt: string | null;
  closedAt: string | null;
  createdByName: string | null;
}

/** One table as the live floor shows it. */
export interface FloorTable extends RestaurantTable {
  /** The dine-in order currently open on it, if any. */
  openOrder: {
    id: string;
    displayNumber: string;
    status: OrderStatus;
    total: number;
    itemCount: number;
    createdAt: string;
    createdByName: string | null;
  } | null;
  /** Waiter calls still waiting for, or being walked to by, staff. */
  calls: Array<{ id: string; type: WaiterCallType; status: WaiterCallStatus; createdAt: string }>;
  /** A guest sitting on a reservation, or the next booking within three hours. */
  reservation: Pick<TableReservation, 'id' | 'guestName' | 'guestPhone' | 'partySize' | 'startsAt' | 'status' | 'note'> | null;
}

export interface TableFloor {
  branchId: string;
  tables: FloorTable[];
  /** Today's completed dine-in orders at this branch, in the branch's day. */
  today: { orders: number; revenue: number; reservations: number };
}

/* -------------------------------------------------------------------------- */
/* Audit log (TZ §37)                                                         */
/* -------------------------------------------------------------------------- */

export interface AuditLog extends BaseEntity {
  tenantId: string | null;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ip: string | null;
  device: string | null;
  requestId: string | null;
}

/** Audited actions. Extend freely; values are stored as plain strings. */
export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PRICE_CHANGED: 'PRICE_CHANGED',
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_DELETED: 'PRODUCT_DELETED',
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  EMPLOYEE_CREATED: 'EMPLOYEE_CREATED',
  EMPLOYEE_DELETED: 'EMPLOYEE_DELETED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_DELETED: 'ROLE_DELETED',
  SHIFT_OPENED: 'SHIFT_OPENED',
  SHIFT_CLOSED: 'SHIFT_CLOSED',
  CASH_HANDOVER_CONFIRMED: 'CASH_HANDOVER_CONFIRMED',
  TENANT_BLOCKED: 'TENANT_BLOCKED',
  TENANT_ACTIVATED: 'TENANT_ACTIVATED',
  SUBSCRIPTION_CHANGED: 'SUBSCRIPTION_CHANGED',
  TELEGRAM_CONFIG_CHANGED: 'TELEGRAM_CONFIG_CHANGED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/* -------------------------------------------------------------------------- */
/* File storage (TZ §39)                                                      */
/* -------------------------------------------------------------------------- */

export interface FileAsset extends BaseEntity {
  tenantId: string | null;
  provider: StorageProvider;
  /** Storage key/path, relative to the bucket or storage root. */
  key: string;
  url: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string | null;
}

export interface UploadResult {
  id: string;
  url: string;
  key: string;
  sizeBytes: number;
  mimeType: string;
}

/* -------------------------------------------------------------------------- */
/* Dashboard & reports (TZ §7)                                                */
/* -------------------------------------------------------------------------- */

export interface DashboardStats {
  /** Inclusive date range the figures cover, in the tenant's timezone. */
  dateFrom: string;
  dateTo: string;
  branchId: string | null;
  revenue: number;
  ordersCount: number;
  averageCheck: number;
  customersCount: number;
  newCustomersCount: number;
  cancelledOrders: number;
  deliveryOrders: number;
  posOrders: number;
  onlineOrders: number;
  /** Change vs. the preceding period of equal length, as a percentage. */
  revenueChangePercent: number | null;
  ordersChangePercent: number | null;
}

/** One branch's trading in a period, for rankings and comparisons. */
export interface BranchReportRow {
  branchId: string;
  branchName: string;
  isActive: boolean;
  /** Net of refunds, DELIVERED orders only — same rule as every report. */
  revenue: number;
  ordersCount: number;
  averageCheck: number;
  cancelledOrders: number;
  /** What promotions and promo codes cost this branch. */
  discountTotal: number;
  /** The branch's DAILY goal; multiply by the days in the period to compare. */
  dailyRevenueTarget: number | null;
}

/** What the offers did in a period: per promotion, per code, per branch. */
export interface PromotionStats {
  dateFrom: string;
  dateTo: string;
  /** Completed orders in the period that carried any discount. */
  ordersWithDiscount: number;
  ordersTotal: number;
  /** Everything the offers gave away, minor units. */
  discountTotal: number;
  /** Net revenue of the discounted orders. */
  discountedRevenue: number;
  revenueTotal: number;
  promotions: Array<{ promotionId: string; uses: number; discountTotal: number; revenue: number }>;
  promoCodes: Array<{ promoCodeId: string; uses: number; discountTotal: number; revenue: number; newCustomers: number }>;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    ordersWithDiscount: number;
    discountTotal: number;
    revenue: number;
  }>;
}

export interface RevenuePoint {
  /** Bucket start, ISO date or datetime depending on the granularity. */
  at: string;
  revenue: number;
  orders: number;
}

export interface TopProductRow {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
  /**
   * ABC class by share of revenue: A is the top 80%, B the next 15%, C the
   * rest. The point of the split is that A items are what a kitchen must
   * never run out of, and C items are what a menu can afford to lose.
   */
  abcClass?: 'A' | 'B' | 'C';
  /** This product's share of the period's revenue, as a percentage. */
  revenueSharePercent?: number;
  /** Ingredient cost of one serving, averaged over branches that cost it; null without a recipe. */
  unitCost?: number | null;
  /** Gross margin over the costed sales; null without a recipe. */
  marginPercent?: number | null;
}

/** How a period's takings were tendered (TZ §35). */
export interface PaymentBreakdownRow {
  method: PaymentMethod;
  amount: number;
  count: number;
  sharePercent: number;
}

/** One period's trading, the figures an owner checks daily (TZ §7). */
export interface SalesReport {
  dateFrom: string;
  dateTo: string;
  branchId: string | null;
  revenue: number;
  /** Refunds issued in the period, already subtracted from `revenue`. */
  refunds: number;
  ordersCount: number;
  averageCheck: number;
  /** Discounts and promotions given away — what the offers actually cost. */
  discountTotal: number;
  deliveryFees: number;
  /**
   * Ingredient cost of the dishes sold, from their recipes, and the revenue
   * it is measured against. Only dishes with a recipe at the branch that sold
   * them are costed, so `costOfGoods / costedRevenue` is an honest margin;
   * `costOfGoods` is null when nothing sold had a recipe.
   */
  costOfGoods: number | null;
  costedRevenue: number;
  byType: Array<{ type: OrderType; count: number; revenue: number }>;
  bySource: Array<{ source: OrderSource; count: number; revenue: number }>;
  byPayment: PaymentBreakdownRow[];
  timeline: RevenuePoint[];
}

/** Cash accountability across a period's shifts (TZ §19). */
export interface FinanceReport {
  dateFrom: string;
  dateTo: string;
  branchId: string | null;
  shiftsCount: number;
  /**
   * Shifts still open, excluded from the reconciliation below.
   *
   * An open shift has nothing counted yet, so including it would make
   * `expectedCash` and `countedCash` disagree by its whole balance and leave
   * a reader wondering where the gap came from.
   */
  openShiftsCount: number;
  openingCash: number;
  cashSales: number;
  cardSales: number;
  onlineSales: number;
  refunds: number;
  cashIn: number;
  cashOut: number;
  courierHandovers: number;
  /** Expected in the drawers of CLOSED shifts. Ties to `countedCash`. */
  expectedCash: number;
  countedCash: number;
  /** `countedCash − expectedCash`. Negative is a shortage. */
  difference: number;
  /** Still sitting in the drawers of shifts nobody has closed yet. */
  cashInOpenShifts: number;
  /** Shifts that closed with a difference, newest first — what to look at. */
  discrepancies: Array<{
    shiftId: string;
    branchId: string;
    closedAt: string | null;
    expectedCash: number;
    actualCash: number | null;
    difference: number;
    closedByName: string | null;
    comment: string | null;
  }>;
  /** Every shift in the window, newest first (at most 200) — the Z-report ledger. */
  shifts: Array<{
    shiftId: string;
    branchId: string;
    branchName: string;
    openedAt: string;
    closedAt: string | null;
    openedByName: string | null;
    closedByName: string | null;
    expectedCash: number;
    actualCash: number | null;
    difference: number | null;
    cashTotal: number;
    cardTotal: number;
    onlineTotal: number;
    refundTotal: number;
    orderCount: number;
  }>;
}
