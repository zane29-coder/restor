import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CashTransactionType,
  DomainEvent,
  ErrorCode,
  ONLINE_PAYMENT_METHODS,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentTransactionStatus,
  type Payment,
} from '@restor/shared-types';
import { addMoney } from '@restor/shared-utils';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService, type PrismaTransaction } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';

/**
 * Where an order's payment stands after a given amount has been settled.
 *
 * Pure, because getting this wrong is how an order ends up shipped unpaid or
 * a customer is asked to pay twice. The rounding-free comparison matters: UZS
 * has no subunit, so these are exact integer comparisons and "close enough"
 * is not a state this can be in.
 */
export function paymentStatusFor(
  total: number,
  paidTotal: number,
  refundedTotal: number,
): PaymentStatus {
  if (refundedTotal > 0) {
    // A full refund is REFUNDED regardless of how it was paid; a partial one
    // keeps the order distinguishable from an untouched paid order.
    return refundedTotal >= paidTotal
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;
  }
  // Nothing owed is settled, not unpaid. A fully discounted order left UNPAID
  // would have the POS demand a payment of zero before letting the food go.
  if (total <= 0) return PaymentStatus.PAID;

  if (paidTotal <= 0) return PaymentStatus.UNPAID;
  // `>=` not `===`: a customer who overpaid in cash has still paid, and the
  // change owed is the cashier's business, not the order's status.
  return paidTotal >= total ? PaymentStatus.PAID : PaymentStatus.PARTIALLY_PAID;
}

/** A tender in a mixed payment (TZ §17). */
export interface PaymentPart {
  method: PaymentMethod;
  amount: number;
}

const ORDER_SELECT = {
  id: true,
  tenantId: true,
  branchId: true,
  displayNumber: true,
  total: true,
  paidTotal: true,
  refundedTotal: true,
  paymentStatus: true,
  status: true,
} as const;

/**
 * Taking money for an order (TZ §17, §35, §36).
 *
 * The rule that shapes everything here: **an order's `paidTotal` is derived
 * from its payment rows, never set directly**. Every increment happens in the
 * same transaction as the Payment row that justifies it, so the two can never
 * drift — and a reconciliation that sums payments will always match the order.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cash: CashService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Taking payment                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Settles part or all of an order at the till.
   *
   * `tendered` is what the customer handed over, used only to compute change —
   * the order is credited with `amount`, never with the banknote.
   */
  async take(input: {
    orderId: string;
    method: PaymentMethod;
    amount: number;
    tendered?: number;
    cashShiftId?: string;
  }): Promise<Payment> {
    return this.settle(input.orderId, [{ method: input.method, amount: input.amount }], {
      cashShiftId: input.cashShiftId,
    }).then((payments) => payments[0]);
  }

  /**
   * Mixed payment: several tenders settling one order at once (TZ §17).
   *
   * 100 000 cash plus 56 000 card is two payment rows and one atomic write.
   * Splitting it into two separate calls would leave a window where the order
   * is half paid and a crash loses the second half.
   */
  async takeMixed(input: {
    orderId: string;
    parts: PaymentPart[];
    cashShiftId?: string;
  }): Promise<Payment[]> {
    return this.settle(input.orderId, input.parts, { cashShiftId: input.cashShiftId });
  }

  private async settle(
    orderId: string,
    parts: PaymentPart[],
    options: { cashShiftId?: string },
  ): Promise<Payment[]> {
    const order = await this.prisma.db.order.findFirst({
      where: { id: orderId },
      select: ORDER_SELECT,
    });
    if (!order) throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);

    if (order.status === OrderStatus.CANCELLED) {
      throw AppException.badRequest('Bekor qilingan buyurtma uchun toʻlov qabul qilinmaydi');
    }

    const total = parts.reduce((sum, part) => addMoney(sum, part.amount), 0);
    const outstanding = order.total - order.paidTotal;

    if (outstanding <= 0) {
      throw new AppException(
        ErrorCode.PAYMENT_ALREADY_PROCESSED,
        `${order.displayNumber} allaqachon toʻlangan`,
        409,
      );
    }
    if (total > outstanding) {
      throw new AppException(
        ErrorCode.PAYMENT_AMOUNT_MISMATCH,
        `Toʻlanishi kerak ${outstanding}, ${total} emas`,
        422,
      );
    }

    // Cash taken at a till must belong to a shift, or it is money nobody is
    // accountable for. Non-cash tenders do not touch the drawer, so they are
    // allowed without one (a web order paid online has no cashier).
    const shiftId = await this.resolveShift(order.branchId, parts, options.cashShiftId);

    const userId = getContext()?.userId ?? null;

    const created = await this.prisma.transaction(async (tx) => {
      const rows = [];

      for (const part of parts) {
        const payment = await tx.payment.create({
          data: {
            tenantId: order.tenantId,
            branchId: order.branchId,
            orderId: order.id,
            method: part.method,
            amount: part.amount,
            status: PaymentTransactionStatus.SUCCESS,
            paidAt: new Date(),
            cashShiftId: shiftId,
            receivedByUserId: userId,
          },
        });

        if (shiftId) {
          await this.cash.record(tx, {
            tenantId: order.tenantId,
            branchId: order.branchId,
            cashShiftId: shiftId,
            type: CashTransactionType.SALE,
            method: part.method,
            amount: part.amount,
            orderId: order.id,
            comment: order.displayNumber,
            createdByUserId: userId,
          });
        }

        rows.push(payment);
      }

      const paidTotal = addMoney(order.paidTotal, total);
      await tx.order.update({
        where: { id: order.id },
        data: {
          paidTotal,
          paymentStatus: paymentStatusFor(order.total, paidTotal, order.refundedTotal),
        },
      });

      return rows;
    });

    this.events.emit(DomainEvent.PAYMENT_RECEIVED, {
      tenantId: order.tenantId,
      branchId: order.branchId,
      requestId: getContext()?.requestId ?? null,
      actorUserId: userId,
      occurredAt: new Date().toISOString(),
      orderId: order.id,
      paymentId: created[0]!.id,
      method: parts[0]!.method,
      amount: total,
    });

    await this.audit.record({
      action: 'PAYMENT_RECEIVED',
      entity: 'Order',
      entityId: order.id,
      newValue: { parts, total, cashShiftId: shiftId },
    });

    return created.map(toPayment);
  }

  /* ------------------------------------------------------------------ */
  /* Refunds                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Refunds against an order (TZ §36).
   *
   * Refunds are recorded as their own payment rows with a negative-direction
   * transaction rather than by reducing the original payment. The original
   * charge happened; erasing it would destroy the audit trail a dispute needs.
   */
  async refund(input: {
    orderId: string;
    amount: number;
    reason: string;
    cashShiftId?: string;
  }): Promise<Payment> {
    const order = await this.prisma.db.order.findFirst({
      where: { id: input.orderId },
      select: ORDER_SELECT,
    });
    if (!order) throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);

    const refundable = order.paidTotal - order.refundedTotal;
    if (input.amount > refundable) {
      throw new AppException(
        ErrorCode.REFUND_EXCEEDS_PAID,
        `Qaytarish mumkin boʻlgan summa ${refundable}`,
        422,
      );
    }

    // Refund in the same tender it came in on where we can tell, so the
    // drawer and the card terminal each get their own money back.
    const original = await this.prisma.db.payment.findFirst({
      where: { orderId: order.id, status: PaymentTransactionStatus.SUCCESS },
      orderBy: { createdAt: 'desc' },
      select: { id: true, method: true, amount: true, refundedAmount: true, cashShiftId: true },
    });
    const method = original?.method ?? PaymentMethod.CASH;

    const shiftId = await this.resolveShift(
      order.branchId,
      [{ method: method as PaymentMethod, amount: input.amount }],
      input.cashShiftId ?? original?.cashShiftId ?? undefined,
    );

    const userId = getContext()?.userId ?? null;

    const created = await this.prisma.transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          tenantId: order.tenantId,
          branchId: order.branchId,
          orderId: order.id,
          method: method as PaymentMethod,
          // Stored positive; `status: REFUNDED` carries the direction, matching
          // how CashTransaction keeps amounts unsigned.
          amount: input.amount,
          status: PaymentTransactionStatus.REFUNDED,
          paidAt: new Date(),
          cashShiftId: shiftId,
          receivedByUserId: userId,
        },
      });

      if (original) {
        await tx.payment.update({
          where: { id: original.id },
          data: { refundedAmount: { increment: Math.min(input.amount, original.amount) } },
        });
      }

      if (shiftId) {
        await this.cash.record(tx, {
          tenantId: order.tenantId,
          branchId: order.branchId,
          cashShiftId: shiftId,
          type: CashTransactionType.REFUND,
          method: method as PaymentMethod,
          amount: input.amount,
          orderId: order.id,
          comment: `${order.displayNumber}: ${input.reason}`,
          createdByUserId: userId,
        });
      }

      const refundedTotal = addMoney(order.refundedTotal, input.amount);
      await tx.order.update({
        where: { id: order.id },
        data: {
          refundedTotal,
          paymentStatus: paymentStatusFor(order.total, order.paidTotal, refundedTotal),
        },
      });

      return payment;
    });

    await this.audit.record({
      action: 'PAYMENT_REFUNDED',
      entity: 'Order',
      entityId: order.id,
      newValue: { amount: input.amount, reason: input.reason, method },
    });

    this.logger.log(
      { orderId: order.id, amount: input.amount, method },
      'Refund recorded',
    );

    return toPayment(created);
  }

  /* ------------------------------------------------------------------ */
  /* Reads                                                              */
  /* ------------------------------------------------------------------ */

  async listForOrder(orderId: string): Promise<Payment[]> {
    const rows = await this.prisma.db.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toPayment);
  }

  /* ------------------------------------------------------------------ */
  /* Used by other modules                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Records cash a courier took at the door, inside the caller's transaction.
   *
   * No `cashShiftId`: the money is real and the order is paid, but it is in the
   * courier's pocket, not a drawer. It joins a shift later, when the courier
   * hands it over — which is a separate movement, deliberately. Attaching it to
   * a shift now would put cash in a drawer that does not contain it.
   */
  async recordCourierCollection(
    tx: PrismaTransaction,
    params: {
      tenantId: string;
      branchId: string;
      orderId: string;
      amount: number;
      receivedByUserId?: string | null;
    },
  ): Promise<void> {
    await tx.payment.create({
      data: {
        tenantId: params.tenantId,
        branchId: params.branchId,
        orderId: params.orderId,
        method: PaymentMethod.CASH,
        amount: params.amount,
        status: PaymentTransactionStatus.SUCCESS,
        paidAt: new Date(),
        cashShiftId: null,
        receivedByUserId: params.receivedByUserId ?? null,
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * The shift a tender belongs to.
   *
   * Cash needs one: untracked cash at a till is exactly what a shift exists to
   * prevent. Card and online tenders do not touch the drawer, so they are
   * recorded against the open shift when there is one and without a shift when
   * there is not — a customer paying online at midnight has no cashier.
   */
  private async resolveShift(
    branchId: string,
    parts: PaymentPart[],
    requested?: string,
  ): Promise<string | null> {
    if (requested) {
      const shift = await this.cash.requireOpenShift(requested);
      if (shift.branchId !== branchId) {
        throw AppException.badRequest('Smena boshqa filialga tegishli');
      }
      return shift.id;
    }

    const open = await this.prisma.db.cashShift.findFirst({
      where: { branchId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
      select: { id: true },
    });
    if (open) return open.id;

    const needsDrawer = parts.some((part) => part.method === PaymentMethod.CASH);
    if (needsDrawer) {
      throw new AppException(
        ErrorCode.SHIFT_NOT_OPEN,
        'Naqd toʻlov uchun kassa smenasi ochilishi kerak',
        409,
      );
    }

    return null;
  }
}

/* -------------------------------------------------------------------------- */

function toPayment(row: {
  id: string;
  tenantId: string;
  branchId: string;
  orderId: string;
  method: string;
  amount: number;
  status: string;
  externalId: string | null;
  provider: string | null;
  checkoutUrl: string | null;
  checkoutExpiresAt: Date | null;
  paidAt: Date | null;
  refundedAmount: number;
  cashShiftId: string | null;
  receivedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Payment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    orderId: row.orderId,
    method: row.method as PaymentMethod,
    amount: row.amount,
    status: row.status as PaymentTransactionStatus,
    externalId: row.externalId,
    provider: row.provider,
    checkoutUrl: row.checkoutUrl,
    checkoutExpiresAt: row.checkoutExpiresAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    refundedAmount: row.refundedAmount,
    cashShiftId: row.cashShiftId,
    receivedByUserId: row.receivedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { toPayment };

/** Kept for callers that only need to know whether a method settles online. */
export const isOnlineMethod = (method: PaymentMethod): boolean =>
  ONLINE_PAYMENT_METHODS.includes(method);
