import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CashShiftStatus,
  CashTransactionType,
  DomainEvent,
  ErrorCode,
  ONLINE_PAYMENT_METHODS,
  PaymentMethod,
  type CashRegister,
  type CashShift,
  type CashTransaction,
  type Paginated,
  type ShiftSummary,
} from '@restor/shared-types';
import { normalizePagination, paginated } from '@restor/shared-utils';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService, type PrismaTransaction } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/** How one movement changes a shift's running totals. */
export interface ShiftDelta {
  /** The physical drawer. Only cash movements touch it. */
  expectedCash: number;
  cashTotal: number;
  cardTotal: number;
  onlineTotal: number;
  refundTotal: number;
  orderCount: number;
}

const NO_CHANGE: ShiftDelta = {
  expectedCash: 0,
  cashTotal: 0,
  cardTotal: 0,
  onlineTotal: 0,
  refundTotal: 0,
  orderCount: 0,
};

/**
 * What one movement does to a shift (TZ §19).
 *
 * Extracted and pure because this is the arithmetic a cashier is held
 * accountable for at the end of a shift. A sign error here crashes nothing —
 * it just makes the drawer disagree with the system, and the cashier is the
 * one who has to explain the difference.
 *
 * Two distinctions that are easy to collapse and must not be:
 *
 *  - **Drawer versus takings.** A card sale is revenue but never enters the
 *    drawer, so it adds to `cardTotal` and leaves `expectedCash` alone.
 *    Getting this wrong makes every shift look short by the day's card sales.
 *  - **Courier cash.** A delivery paid in cash at the door is a sale the
 *    moment it is paid, but it reaches this drawer only when the courier hands
 *    it over. The handover therefore moves `expectedCash` WITHOUT touching
 *    `cashTotal` — that sale was already counted, by whoever recorded the
 *    payment. Counting it twice would inflate the day's takings.
 *
 * The invariant:
 *
 *     expectedCash = openingCash + cash sales − cash refunds
 *                    + cashIn − cashOut + handovers − withdrawals
 */
export function shiftDeltaFor(
  type: CashTransactionType,
  method: PaymentMethod,
  amount: number,
): ShiftDelta {
  const isCash = method === PaymentMethod.CASH;
  const isCard = method === PaymentMethod.CARD || method === PaymentMethod.TERMINAL;
  const isOnline = ONLINE_PAYMENT_METHODS.includes(method);

  switch (type) {
    case CashTransactionType.SALE:
      return {
        ...NO_CHANGE,
        orderCount: 1,
        expectedCash: isCash ? amount : 0,
        cashTotal: isCash ? amount : 0,
        cardTotal: isCard ? amount : 0,
        onlineTotal: isOnline ? amount : 0,
        // BONUS deliberately reaches none of the three: loyalty points are not
        // money taken, and adding them to takings would overstate revenue.
      };

    case CashTransactionType.REFUND:
      return {
        ...NO_CHANGE,
        refundTotal: amount,
        expectedCash: isCash ? -amount : 0,
      };

    case CashTransactionType.CASH_IN:
    case CashTransactionType.OPENING_FLOAT:
      return { ...NO_CHANGE, expectedCash: amount };

    case CashTransactionType.CASH_OUT:
    case CashTransactionType.WITHDRAWAL:
      return { ...NO_CHANGE, expectedCash: -amount };

    case CashTransactionType.COURIER_HANDOVER:
      // Drawer only. The sale was counted when the customer paid the courier.
      return { ...NO_CHANGE, expectedCash: amount };

    default:
      return { ...NO_CHANGE };
  }
}

const SHIFT_INCLUDE = {
  cashRegister: { select: { name: true } },
  openedBy: { select: { fullName: true } },
  closedBy: { select: { fullName: true } },
} as const;

/**
 * Cash register and shifts (TZ §19).
 *
 * The shift is what makes cash accountable: every tender taken at a till
 * belongs to exactly one shift, and closing one forces a physical count
 * against what the system expected. The difference is recorded, never
 * silently corrected — an unexplained shortage is precisely the signal a
 * manager needs.
 */
@Injectable()
export class CashService {
  private readonly logger = new Logger(CashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Registers                                                          */
  /* ------------------------------------------------------------------ */

  async listRegisters(branchId?: string): Promise<CashRegister[]> {
    const rows = await this.prisma.db.cashRegister.findMany({
      where: { ...(branchId ? { branchId } : {}), isActive: true },
      orderBy: { name: 'asc' },
      include: {
        shifts: {
          where: { status: CashShiftStatus.OPEN },
          select: { id: true },
          take: 1,
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      branchId: row.branchId,
      name: row.name,
      deviceId: row.deviceId,
      isActive: row.isActive,
      currentShiftId: row.shifts[0]?.id ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async createRegister(input: {
    branchId: string;
    name: string;
    deviceId?: string | null;
  }): Promise<CashRegister> {
    const tenantId = this.requireTenant();

    const row = await this.prisma.db.cashRegister.create({
      data: {
        tenantId,
        branchId: input.branchId,
        name: input.name,
        deviceId: input.deviceId ?? null,
      },
    });

    await this.audit.record({
      action: 'CASH_REGISTER_CREATED',
      entity: 'CashRegister',
      entityId: row.id,
      newValue: { name: input.name, branchId: input.branchId },
    });

    return {
      id: row.id,
      tenantId: row.tenantId,
      branchId: row.branchId,
      name: row.name,
      deviceId: row.deviceId,
      isActive: row.isActive,
      currentShiftId: null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Shifts                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Opens a shift and counts the float into the drawer.
   *
   * One open shift per register: two would make it ambiguous which one a sale
   * belongs to, and the whole point of a shift is that the question has one
   * answer.
   */
  async openShift(input: {
    branchId: string;
    cashRegisterId?: string;
    openingCash: number;
  }): Promise<CashShift> {
    const tenantId = this.requireTenant();
    const userId = this.requireUser();

    const registerId = await this.resolveRegister(tenantId, input.branchId, input.cashRegisterId);

    const existing = await this.prisma.db.cashShift.findFirst({
      where: { cashRegisterId: registerId, status: CashShiftStatus.OPEN },
      select: { id: true },
    });
    if (existing) {
      throw new AppException(
        ErrorCode.SHIFT_ALREADY_OPEN,
        'Bu kassada ochiq smena bor — avval uni yoping',
        409,
      );
    }

    const row = await this.prisma.transaction(async (tx) => {
      const shift = await tx.cashShift.create({
        data: {
          tenantId,
          branchId: input.branchId,
          cashRegisterId: registerId,
          openedByUserId: userId,
          openingCash: input.openingCash,
          expectedCash: input.openingCash,
        },
        include: SHIFT_INCLUDE,
      });

      // The float is a movement like any other, so the drawer's history is
      // complete from the first tiyin rather than starting at a bare number.
      if (input.openingCash > 0) {
        await tx.cashTransaction.create({
          data: {
            tenantId,
            branchId: input.branchId,
            cashShiftId: shift.id,
            type: CashTransactionType.OPENING_FLOAT,
            method: PaymentMethod.CASH,
            amount: input.openingCash,
            createdByUserId: userId,
            comment: 'Smena boshidagi qoldiq',
          },
        });
      }

      return shift;
    });

    this.events.emit(DomainEvent.CASH_SHIFT_OPENED, {
      tenantId,
      branchId: input.branchId,
      requestId: getContext()?.requestId ?? null,
      actorUserId: userId,
      occurredAt: new Date().toISOString(),
      shiftId: row.id,
      openingCash: input.openingCash,
    });

    await this.audit.record({
      action: 'CASH_SHIFT_OPENED',
      entity: 'CashShift',
      entityId: row.id,
      newValue: { openingCash: input.openingCash, cashRegisterId: registerId },
    });

    return toShift(row);
  }

  /**
   * Closes a shift against a physical count.
   *
   * `actualCash` is what the cashier counted. The difference is stored as-is,
   * including a shortage: correcting the expected figure to match the count
   * would erase exactly the information this exists to surface.
   */
  async closeShift(shiftId: string, input: { actualCash: number; comment?: string }): Promise<CashShift> {
    const userId = this.requireUser();

    const shift = await this.prisma.db.cashShift.findFirst({ where: { id: shiftId } });
    if (!shift) throw AppException.notFound('CashShift');

    if (shift.status !== CashShiftStatus.OPEN) {
      throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'Bu smena allaqachon yopilgan', 409);
    }

    const difference = input.actualCash - shift.expectedCash;

    const row = await this.prisma.db.cashShift.update({
      where: { id: shiftId },
      data: {
        status: CashShiftStatus.CLOSED,
        closedByUserId: userId,
        closedAt: new Date(),
        actualCash: input.actualCash,
        difference,
        comment: input.comment ?? null,
      },
      include: SHIFT_INCLUDE,
    });

    this.events.emit(DomainEvent.CASH_SHIFT_CLOSED, {
      tenantId: shift.tenantId,
      branchId: shift.branchId,
      requestId: getContext()?.requestId ?? null,
      actorUserId: userId,
      occurredAt: new Date().toISOString(),
      shiftId,
      expectedCash: shift.expectedCash,
      actualCash: input.actualCash,
      difference,
    });

    await this.audit.record({
      action: 'CASH_SHIFT_CLOSED',
      entity: 'CashShift',
      entityId: shiftId,
      newValue: { expectedCash: shift.expectedCash, actualCash: input.actualCash, difference },
    });

    if (difference !== 0) {
      this.logger.warn(
        { shiftId, expected: shift.expectedCash, actual: input.actualCash, difference },
        'Shift closed with a cash difference',
      );
    }

    return toShift(row);
  }

  /** The shift currently open on a branch's register, if any. */
  async currentShift(branchId: string): Promise<CashShift | null> {
    const row = await this.prisma.db.cashShift.findFirst({
      where: { branchId, status: CashShiftStatus.OPEN },
      orderBy: { openedAt: 'desc' },
      include: SHIFT_INCLUDE,
    });

    return row ? toShift(row) : null;
  }

  async getShift(shiftId: string): Promise<CashShift> {
    const row = await this.prisma.db.cashShift.findFirst({
      where: { id: shiftId },
      include: SHIFT_INCLUDE,
    });
    if (!row) throw AppException.notFound('CashShift');
    return toShift(row);
  }

  async listShifts(query: {
    page?: number;
    limit?: number;
    branchId?: string;
    status?: CashShiftStatus;
  }): Promise<Paginated<CashShift>> {
    const page = normalizePagination(query);

    const where = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.cashShift.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: SHIFT_INCLUDE,
      }),
      this.prisma.db.cashShift.count({ where }),
    ]);

    return paginated(rows.map(toShift), total, page);
  }

  /**
   * X-report: the shift's figures without closing it (TZ §19).
   *
   * Built by summing the transactions rather than reading the running totals,
   * so it doubles as a check on them. If the two ever disagree, the movements
   * are the truth — they are what actually happened.
   */
  async summary(shiftId: string): Promise<ShiftSummary> {
    const shift = await this.prisma.db.cashShift.findFirst({ where: { id: shiftId } });
    if (!shift) throw AppException.notFound('CashShift');

    const grouped = await this.prisma.db.cashTransaction.groupBy({
      by: ['type', 'method'],
      where: { cashShiftId: shiftId },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const total = (
      type: CashTransactionType,
      predicate: (method: PaymentMethod) => boolean = () => true,
    ): number =>
      grouped
        .filter((row) => row.type === type && predicate(row.method as PaymentMethod))
        .reduce((sum, row) => sum + (row._sum.amount ?? 0), 0);

    const isCash = (method: PaymentMethod) => method === PaymentMethod.CASH;
    const isCard = (method: PaymentMethod) =>
      method === PaymentMethod.CARD || method === PaymentMethod.TERMINAL;
    const isOnline = (method: PaymentMethod) => ONLINE_PAYMENT_METHODS.includes(method);

    const orderCount = grouped
      .filter((row) => row.type === CashTransactionType.SALE)
      .reduce((sum, row) => sum + row._count._all, 0);

    return {
      shiftId,
      openedAt: shift.openedAt.toISOString(),
      openingCash: shift.openingCash,
      cashSales: total(CashTransactionType.SALE, isCash),
      cardSales: total(CashTransactionType.SALE, isCard),
      onlineSales: total(CashTransactionType.SALE, isOnline),
      refunds: total(CashTransactionType.REFUND),
      cashIn: total(CashTransactionType.CASH_IN),
      cashOut: total(CashTransactionType.CASH_OUT),
      courierHandovers: total(CashTransactionType.COURIER_HANDOVER),
      expectedCash: shift.expectedCash,
      orderCount,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Transactions                                                       */
  /* ------------------------------------------------------------------ */

  async listTransactions(
    shiftId: string,
    query: { page?: number; limit?: number },
  ): Promise<Paginated<CashTransaction>> {
    const page = normalizePagination(query);

    const [rows, total] = await Promise.all([
      this.prisma.db.cashTransaction.findMany({
        where: { cashShiftId: shiftId },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.cashTransaction.count({ where: { cashShiftId: shiftId } }),
    ]);

    return paginated(rows.map(toTransaction), total, page);
  }

  /** Manual cash in or out — a float top-up, a supplier paid from the drawer. */
  async addTransaction(input: {
    shiftId: string;
    type: CashTransactionType;
    amount: number;
    comment?: string;
  }): Promise<CashTransaction> {
    const shift = await this.requireOpenShift(input.shiftId);

    const row = await this.prisma.transaction((tx) =>
      this.record(tx, {
        tenantId: shift.tenantId,
        branchId: shift.branchId,
        cashShiftId: shift.id,
        type: input.type,
        method: PaymentMethod.CASH,
        amount: input.amount,
        comment: input.comment,
      }),
    );

    await this.audit.record({
      action: 'CASH_TRANSACTION_CREATED',
      entity: 'CashTransaction',
      entityId: row.id,
      newValue: { type: input.type, amount: input.amount, shiftId: input.shiftId },
    });

    return toTransaction(row);
  }

  /**
   * Records a movement and moves the shift's totals in the same transaction.
   *
   * Takes the `tx` handle because every caller is already mid-transaction:
   * taking a payment writes the payment, the movement and the shift totals, or
   * none of them. A movement that landed without updating the totals would
   * make the drawer disagree with its own history.
   */
  async record(
    tx: PrismaTransaction,
    params: {
      tenantId: string;
      branchId: string;
      cashShiftId: string;
      type: CashTransactionType;
      method: PaymentMethod;
      amount: number;
      orderId?: string | null;
      courierId?: string | null;
      comment?: string | null;
      createdByUserId?: string | null;
    },
  ) {
    if (params.amount <= 0) {
      throw AppException.badRequest('Summa noldan katta boʻlishi kerak');
    }

    const delta = shiftDeltaFor(params.type, params.method, params.amount);

    const row = await tx.cashTransaction.create({
      data: {
        tenantId: params.tenantId,
        branchId: params.branchId,
        cashShiftId: params.cashShiftId,
        type: params.type,
        method: params.method,
        amount: params.amount,
        orderId: params.orderId ?? null,
        courierId: params.courierId ?? null,
        comment: params.comment ?? null,
        createdByUserId:
          params.createdByUserId ?? getContext()?.userId ?? this.requireUser(),
      },
    });

    await tx.cashShift.update({
      where: { id: params.cashShiftId },
      data: {
        expectedCash: { increment: delta.expectedCash },
        cashTotal: { increment: delta.cashTotal },
        cardTotal: { increment: delta.cardTotal },
        onlineTotal: { increment: delta.onlineTotal },
        refundTotal: { increment: delta.refundTotal },
        orderCount: { increment: delta.orderCount },
      },
    });

    return row;
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  async requireOpenShift(shiftId: string) {
    const shift = await this.prisma.db.cashShift.findFirst({ where: { id: shiftId } });
    if (!shift) throw AppException.notFound('CashShift');
    if (shift.status !== CashShiftStatus.OPEN) {
      throw new AppException(ErrorCode.SHIFT_NOT_OPEN, 'Smena yopilgan', 409);
    }
    return shift;
  }

  /**
   * The register a shift should open on.
   *
   * A branch with no register row gets one created rather than a 404. The
   * alternative is a cashier unable to start their day because nobody ran a
   * setup step — a worse failure than an auto-named register they can rename.
   */
  private async resolveRegister(
    tenantId: string,
    branchId: string,
    requested?: string,
  ): Promise<string> {
    if (requested) {
      const found = await this.prisma.db.cashRegister.findFirst({
        where: { id: requested, branchId, isActive: true },
        select: { id: true },
      });
      if (!found) {
        throw AppException.notFound('CashRegister', ErrorCode.CASH_REGISTER_NOT_FOUND);
      }
      return found.id;
    }

    const existing = await this.prisma.db.cashRegister.findFirst({
      where: { branchId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.db.cashRegister.create({
      data: { tenantId, branchId, name: 'Asosiy kassa' },
      select: { id: true },
    });
    this.logger.log({ branchId, registerId: created.id }, 'Created a default cash register');
    return created.id;
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');
    return tenantId;
  }

  private requireUser(): string {
    const userId = getContext()?.userId;
    if (!userId) throw AppException.forbidden();
    return userId;
  }
}

/* -------------------------------------------------------------------------- */

type ShiftRow = {
  id: string;
  tenantId: string;
  branchId: string;
  cashRegisterId: string;
  status: string;
  openedByUserId: string;
  closedByUserId: string | null;
  openedAt: Date;
  closedAt: Date | null;
  openingCash: number;
  expectedCash: number;
  actualCash: number | null;
  difference: number | null;
  cashTotal: number;
  cardTotal: number;
  onlineTotal: number;
  refundTotal: number;
  orderCount: number;
  createdAt: Date;
  updatedAt: Date;
};

function toShift(row: ShiftRow): CashShift {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    cashRegisterId: row.cashRegisterId,
    status: row.status as CashShiftStatus,
    openedByUserId: row.openedByUserId,
    closedByUserId: row.closedByUserId,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    openingCash: row.openingCash,
    expectedCash: row.expectedCash,
    actualCash: row.actualCash,
    difference: row.difference,
    cashTotal: row.cashTotal,
    cardTotal: row.cardTotal,
    onlineTotal: row.onlineTotal,
    refundTotal: row.refundTotal,
    orderCount: row.orderCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTransaction(row: {
  id: string;
  tenantId: string;
  branchId: string;
  cashShiftId: string;
  type: string;
  method: string;
  amount: number;
  orderId: string | null;
  courierId: string | null;
  comment: string | null;
  createdByUserId: string;
  createdAt: Date;
}): CashTransaction {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    cashShiftId: row.cashShiftId,
    type: row.type as CashTransactionType,
    method: row.method as PaymentMethod,
    amount: row.amount,
    orderId: row.orderId,
    courierId: row.courierId,
    comment: row.comment,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
  };
}
