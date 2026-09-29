import { Injectable, Logger } from '@nestjs/common';
import {
  CourierTransactionType,
  ErrorCode,
  HandoverStatus,
  type CashHandover,
  type CourierTransaction,
  type CourierWallet,
  type Paginated,
} from '@restor/shared-types';
import { normalizePagination, paginated } from '@restor/shared-utils';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService, type PrismaTransaction } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Courier wallet and cash hand-off (TZ §26, §28).
 *
 * The invariant this service exists to protect:
 *
 *     balance = cashReceived − cashHandedOver − expenses
 *
 * `balance` is what the courier physically owes the restaurant. It is NOT
 * their earnings — `deliveryIncome` tracks that separately and never touches
 * the balance, because money the courier has earned is not money they are
 * holding.
 *
 * Every mutation writes a `CourierTransaction` row AND updates the wallet in
 * the SAME transaction, so the running totals can always be rebuilt from the
 * ledger. A wallet that disagrees with its transactions is a bug that would
 * otherwise be invisible until someone counted cash.
 */
@Injectable()
export class CourierWalletService {
  private readonly logger = new Logger(CourierWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Loads a wallet THROUGH its courier.
   *
   * `courier_wallets` has no `tenantId` column, so the Prisma scoping
   * extension cannot filter it — querying the table directly would return any
   * tenant's wallet to anyone who knew a courier id. `Courier` IS scoped, so
   * going through it makes a cross-tenant read return nothing.
   *
   * This is the "child table" boundary documented at the top of
   * `tenant-scope.extension.ts`, and the reason that comment exists.
   */
  async getWallet(courierId: string): Promise<CourierWallet> {
    const courier = await this.prisma.db.courier.findFirst({
      where: { id: courierId, deletedAt: null },
      include: { wallet: true },
    });

    // 404 rather than 403 for a courier in another tenant: confirming that the
    // id exists elsewhere is itself a leak.
    if (!courier) throw AppException.notFound('Courier', ErrorCode.COURIER_NOT_FOUND);

    const wallet = courier.wallet ?? (await this.createWallet(courierId));
    return toWallet(wallet);
  }

  /** Creates a wallet for a courier that predates the wallet table. */
  private async createWallet(courierId: string) {
    return this.prisma.db.courierWallet.create({ data: { courierId } });
  }

  /**
   * Creates the wallet lazily, so an older courier row is not a special case.
   *
   * Callers must have already established that the courier belongs to the
   * current tenant — every one of them loads the courier first through a
   * scoped query. See {@link getWallet} for why that matters.
   */
  async ensureWallet(courierId: string, tx?: PrismaTransaction): Promise<{ id: string }> {
    const client = tx ?? this.prisma.db;

    const existing = await client.courierWallet.findFirst({
      where: { courierId },
      select: { id: true },
    });
    if (existing) return existing;

    return client.courierWallet.create({ data: { courierId }, select: { id: true } });
  }

  async listTransactions(
    courierId: string,
    query: { page?: number; limit?: number },
  ): Promise<Paginated<CourierTransaction>> {
    const page = normalizePagination(query);

    const [rows, total] = await Promise.all([
      this.prisma.db.courierTransaction.findMany({
        where: { courierId },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.courierTransaction.count({ where: { courierId } }),
    ]);

    return paginated(rows.map(toTransaction), total, page);
  }

  /**
   * Records a wallet movement inside an existing transaction.
   *
   * Takes the `tx` handle rather than opening its own, because every caller is
   * already mid-transaction — completing a delivery credits the wallet and
   * moves the order in one atomic step, or neither happens.
   */
  async recordMovement(
    tx: PrismaTransaction,
    params: {
      tenantId: string;
      courierId: string;
      walletId: string;
      type: CourierTransactionType;
      /** Always positive; `type` decides which totals move and in which direction. */
      amount: number;
      orderId?: string | null;
      comment?: string | null;
      createdByUserId?: string | null;
    },
  ): Promise<void> {
    const { amount, type } = params;

    if (amount < 0) {
      throw AppException.badRequest('Wallet amounts are positive; the type carries the sign');
    }

    await tx.courierTransaction.create({
      data: {
        tenantId: params.tenantId,
        walletId: params.walletId,
        courierId: params.courierId,
        type,
        amount,
        orderId: params.orderId ?? null,
        comment: params.comment ?? null,
        createdByUserId: params.createdByUserId ?? null,
      },
    });

    await tx.courierWallet.update({
      where: { id: params.walletId },
      data: toPrismaDelta(walletDeltaFor(type, amount)),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Cash hand-off (TZ §28)                                             */
  /* ------------------------------------------------------------------ */

  /**
   * The courier declares that they are handing cash to a cashier.
   *
   * This does NOT move the wallet. The money is in limbo until a cashier
   * confirms receipt — which is the entire reason the flow has two sides. A
   * one-sided "I handed it over" is just a claim.
   */
  async declare(params: {
    courierId: string;
    /** Falls back to the courier's own branch, which is what the app sends. */
    branchId?: string;
    amount: number;
    comment?: string;
  }): Promise<CashHandover> {
    const tenantId = this.requireTenant();

    const courier = await this.prisma.db.courier.findFirst({
      where: { id: params.courierId, deletedAt: null },
      include: { user: { select: { fullName: true } }, wallet: true },
    });
    if (!courier) throw AppException.notFound('Courier', ErrorCode.COURIER_NOT_FOUND);

    const branchId = params.branchId ?? courier.branchId;
    if (!branchId) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Kuryer filialga biriktirilmagan — qaysi kassaga topshirilishini koʻrsating',
        422,
      );
    }

    const balance = courier.wallet?.balance ?? 0;
    if (params.amount > balance) {
      throw new AppException(
        ErrorCode.INSUFFICIENT_WALLET_BALANCE,
        `Qoʻlingizda ${balance} bor, ${params.amount} topshirib boʻlmaydi`,
        422,
      );
    }

    // One open declaration at a time: two pending hand-offs make it ambiguous
    // which one the cashier is confirming.
    const pending = await this.prisma.db.cashHandover.findFirst({
      where: { courierId: params.courierId, status: HandoverStatus.PENDING },
      select: { id: true },
    });
    if (pending) {
      throw AppException.conflict('Tasdiqlanmagan topshiruv bor — avval uni yakunlang');
    }

    const row = await this.prisma.db.cashHandover.create({
      data: {
        tenantId,
        branchId,
        courierId: params.courierId,
        amount: params.amount,
        status: HandoverStatus.PENDING,
        comment: params.comment ?? null,
      },
    });

    await this.audit.record({
      action: 'CASH_HANDOVER_DECLARED',
      entity: 'CashHandover',
      entityId: row.id,
      newValue: { courierId: params.courierId, amount: params.amount },
    });

    return toHandover(row, courier.user.fullName, null);
  }

  /**
   * A cashier confirms receipt, which is what actually moves the money.
   *
   * The confirmed amount may differ from what was declared — that discrepancy
   * is recorded on the row and audited rather than hidden, because it is
   * exactly the signal a manager needs.
   */
  async confirm(
    handoverId: string,
    input: { amount?: number; cashShiftId?: string; comment?: string },
  ): Promise<CashHandover> {
    const userId = getContext()?.userId ?? null;

    const handover = await this.prisma.db.cashHandover.findFirst({
      where: { id: handoverId },
      include: { courier: { include: { user: { select: { fullName: true } }, wallet: true } } },
    });
    if (!handover) throw AppException.notFound('Cash handover');

    if (handover.status !== HandoverStatus.PENDING) {
      throw AppException.conflict(`Bu topshiruv allaqachon ${handover.status}`);
    }

    const confirmedAmount = input.amount ?? handover.amount;
    const hasDiscrepancy = confirmedAmount !== handover.amount;

    const walletId = (await this.ensureWallet(handover.courierId)).id;

    const row = await this.prisma.transaction(async (tx) => {
      await this.recordMovement(tx, {
        tenantId: handover.tenantId,
        courierId: handover.courierId,
        walletId,
        type: CourierTransactionType.HANDOVER,
        amount: confirmedAmount,
        comment: hasDiscrepancy
          ? `Eʼlon qilingan: ${handover.amount}, qabul qilingan: ${confirmedAmount}`
          : (input.comment ?? null),
        createdByUserId: userId,
      });

      // Cash entering the drawer belongs on the shift too, or the till's
      // expected total will not match what is in it at close (TZ §19).
      if (input.cashShiftId) {
        await tx.cashTransaction.create({
          data: {
            tenantId: handover.tenantId,
            branchId: handover.branchId,
            cashShiftId: input.cashShiftId,
            type: 'COURIER_HANDOVER',
            method: 'CASH',
            amount: confirmedAmount,
            courierId: handover.courierId,
            comment: `Kuryer topshirigi`,
            createdByUserId: userId!,
          },
        });
        await tx.cashShift.update({
          where: { id: input.cashShiftId },
          data: { expectedCash: { increment: confirmedAmount } },
        });
      }

      return tx.cashHandover.update({
        where: { id: handoverId },
        data: {
          status: hasDiscrepancy ? HandoverStatus.DISPUTED : HandoverStatus.CONFIRMED,
          amount: confirmedAmount,
          cashierUserId: userId,
          confirmedAt: new Date(),
          cashShiftId: input.cashShiftId ?? null,
          ...(input.comment ? { comment: input.comment } : {}),
        },
      });
    });

    await this.audit.record({
      action: 'CASH_HANDOVER_CONFIRMED',
      entity: 'CashHandover',
      entityId: handoverId,
      oldValue: { declared: handover.amount, status: HandoverStatus.PENDING },
      newValue: { confirmed: confirmedAmount, status: row.status, discrepancy: hasDiscrepancy },
    });

    return toHandover(row, handover.courier.user.fullName, null);
  }

  async listHandovers(query: {
    page?: number;
    limit?: number;
    branchId?: string;
    courierId?: string;
    status?: HandoverStatus;
  }): Promise<Paginated<CashHandover>> {
    const page = normalizePagination(query);

    const where = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.courierId ? { courierId: query.courierId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.cashHandover.findMany({
        where,
        include: {
          courier: { include: { user: { select: { fullName: true } } } },
          cashier: { select: { fullName: true } },
        },
        orderBy: { declaredAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.cashHandover.count({ where }),
    ]);

    return paginated(
      rows.map((row) => toHandover(row, row.courier.user.fullName, row.cashier?.fullName ?? null)),
      total,
      page,
    );
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('No restaurant is in scope');
    return tenantId;
  }
}

/* -------------------------------------------------------------------------- */
/* Wallet arithmetic                                                          */
/* -------------------------------------------------------------------------- */

/** Signed change to each wallet total. */
export interface WalletDelta {
  cashReceived: number;
  deliveryIncome: number;
  expenses: number;
  cashHandedOver: number;
  balance: number;
}

const NO_CHANGE: WalletDelta = {
  cashReceived: 0,
  deliveryIncome: 0,
  expenses: 0,
  cashHandedOver: 0,
  balance: 0,
};

/**
 * How each transaction type moves the wallet (TZ §26).
 *
 * Extracted as a pure function so the rule can be tested without a database.
 * Getting one of these backwards is a money bug that stays invisible until
 * someone counts cash at the end of a shift, which is exactly the kind of
 * mistake a test should catch instead.
 *
 * The invariant it maintains:
 *
 *     balance = cashReceived − cashHandedOver − expenses
 *
 * `deliveryIncome` is deliberately outside that equation: it is what the
 * courier has EARNED, not what they are HOLDING.
 */
export function walletDeltaFor(
  type: CourierTransactionType,
  amount: number,
): WalletDelta {
  switch (type) {
    // Cash taken from a customer: the courier is now holding it.
    case CourierTransactionType.CASH_RECEIVED:
      return { ...NO_CHANGE, cashReceived: amount, balance: amount };

    // Cash handed to a cashier: no longer holding it.
    case CourierTransactionType.HANDOVER:
      return { ...NO_CHANGE, cashHandedOver: amount, balance: -amount };

    // Spent on the restaurant's behalf (fuel, say): reduces what is owed.
    case CourierTransactionType.EXPENSE:
      return { ...NO_CHANGE, expenses: amount, balance: -amount };

    // Earnings. Does NOT touch the balance.
    case CourierTransactionType.DELIVERY_INCOME:
      return { ...NO_CHANGE, deliveryIncome: amount };

    // Manual correction by a manager; signed by the caller.
    case CourierTransactionType.ADJUSTMENT:
      return { ...NO_CHANGE, balance: amount };

    default:
      return NO_CHANGE;
  }
}

/** Turns a delta into Prisma's increment syntax, omitting zero fields. */
function toPrismaDelta(delta: WalletDelta): Record<string, { increment: number }> {
  const data: Record<string, { increment: number }> = {};
  for (const [field, value] of Object.entries(delta)) {
    if (value !== 0) data[field] = { increment: value };
  }
  return data;
}

/* -------------------------------------------------------------------------- */

type WalletRow = {
  id: string;
  courierId: string;
  cashReceived: number;
  deliveryIncome: number;
  expenses: number;
  cashHandedOver: number;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
};

function toWallet(row: WalletRow): CourierWallet {
  return {
    id: row.id,
    courierId: row.courierId,
    cashReceived: row.cashReceived,
    deliveryIncome: row.deliveryIncome,
    expenses: row.expenses,
    cashHandedOver: row.cashHandedOver,
    balance: row.balance,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTransaction(row: {
  id: string;
  tenantId: string;
  walletId: string;
  courierId: string;
  type: string;
  amount: number;
  orderId: string | null;
  comment: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}): CourierTransaction {
  return {
    id: row.id,
    tenantId: row.tenantId,
    walletId: row.walletId,
    courierId: row.courierId,
    type: row.type as CourierTransactionType,
    amount: row.amount,
    orderId: row.orderId,
    comment: row.comment,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
  };
}

function toHandover(
  row: {
    id: string;
    tenantId: string;
    branchId: string;
    courierId: string;
    cashierUserId: string | null;
    amount: number;
    status: string;
    declaredAt: Date;
    confirmedAt: Date | null;
    cashShiftId: string | null;
    comment: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  courierName: string,
  cashierName: string | null,
): CashHandover {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    courierId: row.courierId,
    courierName,
    cashierUserId: row.cashierUserId,
    cashierName,
    amount: row.amount,
    status: row.status as HandoverStatus,
    declaredAt: row.declaredAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cashShiftId: row.cashShiftId,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
