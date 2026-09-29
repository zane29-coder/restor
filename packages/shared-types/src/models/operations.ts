import type { BaseEntity } from '../api';
import type {
  CashShiftStatus,
  CashTransactionType,
  CourierStatus,
  CourierTransactionType,
  DeliveryStatus,
  HandoverStatus,
  PaymentMethod,
  PaymentTransactionStatus,
  PaymentTransactionType,
  VehicleType,
} from '../enums';

/* -------------------------------------------------------------------------- */
/* Payments (TZ §35, §36)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One tender against an order. A mixed payment (TZ §17) is simply two rows —
 * 100 000 CASH plus 56 000 CARD — and the order is PAID once they sum to the
 * total.
 */
export interface Payment extends BaseEntity {
  tenantId: string;
  branchId: string;
  orderId: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentTransactionStatus;
  /** Provider-side identifier, used to make webhooks idempotent. */
  externalId: string | null;
  paidAt: string | null;
  refundedAmount: number;
  cashShiftId: string | null;
  receivedByUserId: string | null;
}

export interface PaymentTransaction extends BaseEntity {
  paymentId: string;
  type: PaymentTransactionType;
  amount: number;
  status: PaymentTransactionStatus;
  externalId: string | null;
  /**
   * Unique per provider event. The webhook handler inserts on this key, so a
   * replayed callback can never double-credit an order (TZ §36).
   */
  idempotencyKey: string;
  /** Raw provider payload, retained for reconciliation. Secrets are stripped. */
  rawPayload: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface CreatePaymentRequest {
  orderId: string;
  method: PaymentMethod;
  amount: number;
  /** Cash tendered by the customer; the API returns the change to give. */
  tendered?: number;
}

export interface MixedPaymentRequest {
  orderId: string;
  parts: Array<{ method: PaymentMethod; amount: number }>;
}

export interface RefundRequest {
  orderId: string;
  amount: number;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Cash register & shifts (TZ §19)                                            */
/* -------------------------------------------------------------------------- */

export interface CashRegister extends BaseEntity {
  tenantId: string;
  branchId: string;
  name: string;
  /** Stable device identifier, used to enforce the plan's POS-terminal limit. */
  deviceId: string | null;
  isActive: boolean;
  /** Present when a shift is currently open on this register. */
  currentShiftId: string | null;
}

export interface CashShift extends BaseEntity {
  tenantId: string;
  branchId: string;
  cashRegisterId: string;
  status: CashShiftStatus;
  openedByUserId: string;
  closedByUserId: string | null;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  /** Opening float + cash sales - refunds + handovers - withdrawals. */
  expectedCash: number;
  /** What the cashier physically counted at close. */
  actualCash: number | null;
  /** `actualCash - expectedCash`; negative means a shortage. */
  difference: number | null;
  cashTotal: number;
  cardTotal: number;
  onlineTotal: number;
  refundTotal: number;
  orderCount: number;
}

export interface CashTransaction extends BaseEntity {
  tenantId: string;
  branchId: string;
  cashShiftId: string;
  type: CashTransactionType;
  method: PaymentMethod;
  /** Always positive; the `type` decides the direction. */
  amount: number;
  orderId: string | null;
  courierId: string | null;
  comment: string | null;
  createdByUserId: string;
}

export interface OpenShiftRequest {
  cashRegisterId: string;
  openingCash: number;
}

export interface CloseShiftRequest {
  actualCash: number;
  comment?: string;
}

/** Figures shown on the close-shift screen before the cashier confirms. */
export interface ShiftSummary {
  shiftId: string;
  openedAt: string;
  openingCash: number;
  cashSales: number;
  cardSales: number;
  onlineSales: number;
  refunds: number;
  cashIn: number;
  cashOut: number;
  courierHandovers: number;
  expectedCash: number;
  orderCount: number;
}

/* -------------------------------------------------------------------------- */
/* Couriers & delivery (TZ §23-§28)                                           */
/* -------------------------------------------------------------------------- */

export interface Courier extends BaseEntity {
  tenantId: string;
  userId: string;
  branchId: string | null;
  fullName: string;
  phone: string;
  status: CourierStatus;
  vehicleType: VehicleType;
  isActive: boolean;
  /** Most recent reported position, when tracking is enabled (TZ §25). */
  lastLocation: CourierLocation | null;
  wallet?: CourierWallet;
  activeDeliveryCount?: number;
}

export interface CourierLocation {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  headingDeg: number | null;
  speedMps: number | null;
  recordedAt: string;
}

/** Running totals for one courier (TZ §26). */
export interface CourierWallet extends BaseEntity {
  courierId: string;
  /** Cash collected from customers and still held by the courier. */
  cashReceived: number;
  /** The courier's own earnings from deliveries. */
  deliveryIncome: number;
  expenses: number;
  cashHandedOver: number;
  /** `cashReceived - cashHandedOver - expenses`: what the courier still owes. */
  balance: number;
}

export interface CourierTransaction extends BaseEntity {
  tenantId: string;
  walletId: string;
  courierId: string;
  type: CourierTransactionType;
  amount: number;
  orderId: string | null;
  comment: string | null;
  createdByUserId: string | null;
}

/** Courier → cashier cash hand-off, confirmed by both sides (TZ §28). */
export interface CashHandover extends BaseEntity {
  tenantId: string;
  branchId: string;
  courierId: string;
  courierName: string;
  cashierUserId: string | null;
  cashierName: string | null;
  amount: number;
  status: HandoverStatus;
  /** Set when the courier declares the hand-off. */
  declaredAt: string;
  /** Set when the cashier confirms receipt; until then the money is in limbo. */
  confirmedAt: string | null;
  cashShiftId: string | null;
  comment: string | null;
}

export interface Delivery extends BaseEntity {
  tenantId: string;
  branchId: string;
  orderId: string;
  courierId: string | null;
  status: DeliveryStatus;
  assignedAt: string | null;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  distanceM: number | null;
  /** What the courier earns for this job. */
  courierFee: number;
  /** What the customer was charged for delivery. */
  customerFee: number;
}

/** The courier app's job card (TZ §24). */
export interface CourierJob {
  deliveryId: string;
  orderId: string;
  displayNumber: string;
  status: DeliveryStatus;
  branchName: string;
  branchAddress: string;
  branchLatitude: number | null;
  branchLongitude: number | null;
  customerName: string | null;
  customerPhone: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** Amount the courier must collect; zero when the order is already paid. */
  amountToCollect: number;
  orderTotal: number;
  isPaid: boolean;
  itemsSummary: string;
  comment: string | null;
  assignedAt: string | null;
}

export interface ReportLocationRequest {
  latitude: number;
  longitude: number;
  accuracyM?: number;
  headingDeg?: number;
  speedMps?: number;
  recordedAt?: string;
}
