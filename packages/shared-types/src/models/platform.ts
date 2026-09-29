import type { BaseEntity } from '../api';
import type {
  KitchenTicketStatus,
  NotificationChannel,
  NotificationStatus,
  OrderSource,
  StorageProvider,
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
}
