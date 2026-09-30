import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvent,
  ErrorCode,
  LoyaltyTransactionType,
  OrderStatus,
  type Customer,
  type CustomerAddress,
  type LoyaltyAccount,
  type LoyaltyProgram,
  type LoyaltyTransaction,
  type Order,
  type Paginated,
} from '@restor/shared-types';
import { normalizePagination, paginated } from '@restor/shared-utils';
import { AppException } from '../../common/errors/app-exception';
import { getContext, runUnscoped } from '../../common/context/request-context';
import { PrismaService, type PrismaTransaction } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { maxRedeemable, pointsEarned, redeem, type Redemption } from './loyalty.math';

/**
 * A customer with their loyalty standing and addresses attached.
 *
 * `Customer` declares both as optional because most list endpoints omit them;
 * here they are always loaded, so the detail view can rely on them.
 */
export interface CustomerDetail extends Customer {
  loyalty?: LoyaltyAccount;
  addresses: CustomerAddress[];
}

/**
 * Customers and loyalty (TZ §10).
 *
 * Customer rows have existed since orders did — every phone order creates or
 * matches one — so this is the surface over data that was already accumulating
 * rather than a new store.
 *
 * The aggregates (`ordersCount`, `totalSpent`, `averageCheck`) are
 * denormalised onto the row and updated when an order completes. That is a
 * deliberate trade: a customer list that aggregated orders per page would do a
 * table scan on every search, and a restaurant with three years of history
 * would wait seconds for a lookup they do while the customer is on the phone.
 */
@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Customers                                                          */
  /* ------------------------------------------------------------------ */

  async list(query: {
    page?: number;
    limit?: number;
    search?: string;
    isBlocked?: boolean;
  }): Promise<Paginated<Customer>> {
    const page = normalizePagination(query);
    const search = query.search?.trim();

    // A phone is matched on its digits alone.
    //
    // People type a number in every shape it appears on: "+998 90 123 45 67",
    // "998901234567", or just the last digits they remember. Stripping the
    // separators and matching the remainder finds all of them, because phones
    // are stored normalised to E.164 with no separators of their own — the
    // digits sit contiguously inside `+998901234567`.
    //
    // It also sidesteps a sharp edge in URLs: a raw `+` in a query string
    // decodes as a space, so even an exactly-correct number can arrive
    // mangled. Digits survive that.
    const digits = search?.replace(/\D/g, '') ?? '';

    const where = {
      deletedAt: null,
      ...(query.isBlocked !== undefined ? { isBlocked: query.isBlocked } : {}),
      ...(search
        ? {
            OR: [
              { phone: { contains: digits.length >= 3 ? digits : search } },
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { telegramUsername: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.customer.findMany({
        where,
        // Most recent customers first: the person a manager is looking for is
        // usually the one who just called.
        orderBy: [{ lastOrderAt: 'desc' }, { createdAt: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.customer.count({ where }),
    ]);

    return paginated(rows.map(toCustomer), total, page);
  }

  async get(id: string): Promise<CustomerDetail> {
    const row = await this.prisma.db.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        addresses: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        loyaltyAccount: true,
      },
    });
    if (!row) throw AppException.notFound('Customer');

    return {
      ...toCustomer(row),
      addresses: row.addresses.map(toAddress),
      ...(row.loyaltyAccount ? { loyalty: toAccount(row.loyaltyAccount) } : {}),
    };
  }

  /** A customer's order history — what a manager checks before a goodwill call. */
  async orders(
    customerId: string,
    query: { page?: number; limit?: number },
  ): Promise<Paginated<Pick<Order, 'id' | 'displayNumber' | 'status' | 'total' | 'createdAt'>>> {
    await this.get(customerId);
    const page = normalizePagination(query);

    const [rows, total] = await Promise.all([
      this.prisma.db.order.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: { id: true, displayNumber: true, status: true, total: true, createdAt: true },
      }),
      this.prisma.db.order.count({ where: { customerId } }),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        displayNumber: row.displayNumber,
        status: row.status as OrderStatus,
        total: row.total,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
    );
  }

  async update(
    id: string,
    input: { fullName?: string | null; email?: string | null; birthDate?: string | null; language?: string },
  ): Promise<CustomerDetail> {
    const before = await this.get(id);

    await this.prisma.db.customer.update({
      where: { id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email ?? null } : {}),
        ...(input.birthDate !== undefined
          ? { birthDate: input.birthDate ? new Date(input.birthDate) : null }
          : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
      },
    });

    const after = await this.get(id);
    await this.audit.recordChange(
      'CUSTOMER_UPDATED',
      'Customer',
      id,
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );

    return after;
  }

  /**
   * Blocks or unblocks a customer.
   *
   * A blocked customer keeps their history and their points — this stops them
   * ordering, it is not a deletion. Wiping the record would also erase the
   * reason they were blocked.
   */
  async setBlocked(id: string, isBlocked: boolean, reason?: string): Promise<CustomerDetail> {
    await this.get(id);

    await this.prisma.db.customer.update({ where: { id }, data: { isBlocked } });

    await this.audit.record({
      action: isBlocked ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED',
      entity: 'Customer',
      entityId: id,
      newValue: { isBlocked, reason: reason ?? null },
    });

    return this.get(id);
  }

  /* ------------------------------------------------------------------ */
  /* Loyalty programme                                                  */
  /* ------------------------------------------------------------------ */

  async getProgram(): Promise<LoyaltyProgram> {
    const tenantId = this.requireTenant();

    const row = await this.prisma.db.loyaltyProgram.findFirst({ where: { tenantId } });
    if (row) return toProgram(row);

    // A tenant with no row has a programme that is simply off. Returning a
    // default rather than 404 means the settings screen has something to show.
    return {
      id: '',
      tenantId,
      isActive: false,
      cashbackPercent: 0,
      pointValue: 1,
      maxRedeemPercent: 50,
      expiryDays: null,
      referralBonus: 0,
      levels: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async updateProgram(input: {
    isActive?: boolean;
    cashbackPercent?: number;
    pointValue?: number;
    maxRedeemPercent?: number;
    expiryDays?: number | null;
    referralBonus?: number;
  }): Promise<LoyaltyProgram> {
    const tenantId = this.requireTenant();

    const row = await this.prisma.db.loyaltyProgram.upsert({
      where: { tenantId },
      create: { tenantId, ...stripUndefined(input) },
      update: stripUndefined(input),
    });

    await this.audit.record({
      action: 'LOYALTY_PROGRAM_UPDATED',
      entity: 'LoyaltyProgram',
      entityId: row.id,
      newValue: input as Record<string, unknown>,
    });

    return toProgram(row);
  }

  /* ------------------------------------------------------------------ */
  /* Points                                                             */
  /* ------------------------------------------------------------------ */

  async getAccount(customerId: string): Promise<LoyaltyAccount> {
    return toAccount(await this.ensureAccount(customerId));
  }

  async listTransactions(
    customerId: string,
    query: { page?: number; limit?: number },
  ): Promise<Paginated<LoyaltyTransaction>> {
    const account = await this.ensureAccount(customerId);
    const page = normalizePagination(query);

    const [rows, total] = await Promise.all([
      this.prisma.db.loyaltyTransaction.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.loyaltyTransaction.count({ where: { accountId: account.id } }),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        type: row.type as LoyaltyTransactionType,
        points: row.points,
        orderId: row.orderId,
        comment: row.comment,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        // A ledger entry is never edited, so it was created and updated at
        // the same instant. The field exists only to satisfy BaseEntity.
        updatedAt: row.createdAt.toISOString(),
      })),
      total,
      page,
    );
  }

  /** What this customer could pay with points on a bill of `orderTotal`. */
  async quoteRedemption(customerId: string, orderTotal: number): Promise<Redemption> {
    const [program, account] = await Promise.all([
      this.getProgram(),
      this.ensureAccount(customerId),
    ]);
    if (!program.isActive) return { points: 0, amount: 0 };

    return maxRedeemable({
      points: account.points,
      pointValue: program.pointValue,
      orderTotal,
      maxRedeemPercent: program.maxRedeemPercent,
    });
  }

  /**
   * Spends points against an order, inside the caller's transaction.
   *
   * Clamped rather than rejected when the request exceeds what is allowed: a
   * stale balance in a client is not a reason to fail an order at the till.
   * The caller is told what was actually spent and prices accordingly.
   */
  async spendPoints(
    tx: PrismaTransaction,
    params: { customerId: string; orderId: string; orderTotal: number; requestedPoints: number },
  ): Promise<Redemption> {
    const [program, account] = await Promise.all([
      this.getProgram(),
      this.ensureAccount(params.customerId),
    ]);
    if (!program.isActive) return { points: 0, amount: 0 };

    const spent = redeem(
      {
        points: account.points,
        pointValue: program.pointValue,
        orderTotal: params.orderTotal,
        maxRedeemPercent: program.maxRedeemPercent,
      },
      params.requestedPoints,
    );
    if (spent.points <= 0) return spent;

    await tx.loyaltyAccount.update({
      where: { id: account.id },
      data: { points: { decrement: spent.points } },
    });

    await tx.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        type: LoyaltyTransactionType.REDEEM,
        // Stored negative: the sign IS the direction, so a sum over the
        // ledger reproduces the balance without knowing the type rules.
        points: -spent.points,
        orderId: params.orderId,
        comment: `${spent.points} ball ishlatildi`,
      },
    });

    return spent;
  }

  /**
   * Credits points and refreshes the customer's aggregates when an order
   * completes.
   *
   * Driven by the domain event rather than called from the order service, so
   * the ordering path does not grow a dependency on loyalty — an order must
   * complete whether or not the points land.
   */
  @OnEvent(DomainEvent.ORDER_STATUS_CHANGED, { async: true })
  async onOrderStatusChanged(event: {
    tenantId: string;
    orderId: string;
    toStatus: OrderStatus;
  }): Promise<void> {
    // DELIVERED is the terminal success state for every order type here —
    // a pickup order is marked DELIVERED when the customer walks away with it.
    if (event.toStatus !== OrderStatus.DELIVERED) return;

    try {
      await runUnscoped(() => this.creditForOrder(event.tenantId, event.orderId));
    } catch (error) {
      // Points are a courtesy; an order must not be held up by them.
      this.logger.warn(
        { orderId: event.orderId, error: String(error) },
        'Could not credit loyalty points',
      );
    }
  }

  private async creditForOrder(tenantId: string, orderId: string): Promise<void> {
    const order = await this.prisma.db.order.findFirst({
      where: { id: orderId },
      select: { id: true, customerId: true, total: true, tenantId: true },
    });
    if (!order?.customerId) return;

    const program = await this.prisma.db.loyaltyProgram.findFirst({ where: { tenantId } });

    await this.prisma.transaction(async (tx) => {
      // Aggregates move whether or not a loyalty programme is running: they
      // are the customer's history, not a reward.
      const customer = await tx.customer.findUnique({
        where: { id: order.customerId! },
        select: { ordersCount: true, totalSpent: true },
      });
      if (!customer) return;

      const ordersCount = customer.ordersCount + 1;
      const totalSpent = customer.totalSpent + order.total;

      await tx.customer.update({
        where: { id: order.customerId! },
        data: {
          ordersCount,
          totalSpent,
          averageCheck: Math.floor(totalSpent / ordersCount),
          lastOrderAt: new Date(),
        },
      });

      if (!program?.isActive) return;

      const earned = pointsEarned(order.total, program.cashbackPercent);
      if (earned <= 0) return;

      const account = await this.ensureAccountIn(tx, tenantId, order.customerId!);

      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: {
          points: { increment: earned },
          lifetimePoints: { increment: earned },
        },
      });

      await tx.loyaltyTransaction.create({
        data: {
          accountId: account.id,
          type: LoyaltyTransactionType.EARN,
          points: earned,
          orderId: order.id,
          comment: `${program.cashbackPercent}% keshbek`,
          expiresAt: program.expiryDays
            ? new Date(Date.now() + program.expiryDays * 86_400_000)
            : null,
        },
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  private async ensureAccount(customerId: string) {
    const existing = await this.prisma.db.loyaltyAccount.findFirst({ where: { customerId } });
    if (existing) return existing;

    const customer = await this.prisma.db.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!customer) throw AppException.notFound('Customer');

    return this.prisma.db.loyaltyAccount.create({
      data: {
        tenantId: customer.tenantId,
        customerId,
        referralCode: referralCode(),
      },
    });
  }

  /** The same, inside an open transaction. */
  private async ensureAccountIn(tx: PrismaTransaction, tenantId: string, customerId: string) {
    const existing = await tx.loyaltyAccount.findFirst({ where: { customerId } });
    if (existing) return existing;

    return tx.loyaltyAccount.create({
      data: { tenantId, customerId, referralCode: referralCode() },
    });
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');
    return tenantId;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * A short referral code.
 *
 * Deliberately excludes 0/O and 1/I/L: these get read off a phone screen and
 * typed by someone else, and those pairs are where that goes wrong.
 */
function referralCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function stripUndefined<T extends object>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

function toCustomer(row: {
  id: string;
  tenantId: string;
  phone: string;
  fullName: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  email: string | null;
  birthDate: Date | null;
  language: string;
  isBlocked: boolean;
  ordersCount: number;
  totalSpent: number;
  averageCheck: number;
  lastOrderAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Customer {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phone: row.phone,
    fullName: row.fullName,
    telegramId: row.telegramId,
    telegramUsername: row.telegramUsername,
    email: row.email,
    birthDate: row.birthDate?.toISOString().slice(0, 10) ?? null,
    language: row.language,
    isBlocked: row.isBlocked,
    ordersCount: row.ordersCount,
    totalSpent: row.totalSpent,
    averageCheck: row.averageCheck,
    lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAddress(row: {
  id: string;
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
  createdAt: Date;
  updatedAt: Date;
}): CustomerAddress {
  return {
    id: row.id,
    customerId: row.customerId,
    label: row.label,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    entrance: row.entrance,
    floor: row.floor,
    apartment: row.apartment,
    landmark: row.landmark,
    comment: row.comment,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAccount(row: {
  id: string;
  tenantId: string;
  customerId: string;
  points: number;
  lifetimePoints: number;
  levelId: string | null;
  referralCode: string;
  referredByCustomerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LoyaltyAccount {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    points: row.points,
    lifetimePoints: row.lifetimePoints,
    levelId: row.levelId,
    // Levels are a later addition to the programme; until one is configured
    // every account sits outside the ladder rather than on its bottom rung.
    levelName: null,
    referralCode: row.referralCode,
    referredByCustomerId: row.referredByCustomerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProgram(row: {
  id: string;
  tenantId: string;
  isActive: boolean;
  cashbackPercent: number;
  pointValue: number;
  maxRedeemPercent: number;
  expiryDays: number | null;
  referralBonus: number;
  createdAt: Date;
  updatedAt: Date;
}): LoyaltyProgram {
  return {
    id: row.id,
    tenantId: row.tenantId,
    isActive: row.isActive,
    cashbackPercent: row.cashbackPercent,
    pointValue: row.pointValue,
    maxRedeemPercent: row.maxRedeemPercent,
    expiryDays: row.expiryDays,
    referralBonus: row.referralBonus,
    levels: [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
