import { Injectable } from '@nestjs/common';
import {
  CashTransactionType,
  ONLINE_PAYMENT_METHODS,
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentTransactionStatus,
  type BranchReportRow,
  type DashboardStats,
  type FinanceReport,
  type PaymentBreakdownRow,
  type PromotionStats,
  type RevenuePoint,
  type SalesReport,
  type TopProductRow,
} from '@restor/shared-types';
import { startOfDayInZone } from '@restor/shared-utils';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { PrismaService } from '../../database/prisma.service';

export type Granularity = 'hour' | 'day' | 'week' | 'month';

export interface ReportRange {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Reporting (TZ §7, §37).
 *
 * Every figure here is derived from orders, payments and shifts that already
 * exist — there is no reporting store and nothing is written. That keeps
 * reports honest by construction: they cannot drift from the operational data,
 * because they ARE the operational data.
 *
 * Two rules applied consistently, because getting them inconsistent is how two
 * screens show two different revenues for the same day:
 *
 *  - **Revenue counts DELIVERED orders only.** An order in the kitchen is not
 *    money, and a cancelled one never was. DELIVERED is the terminal success
 *    state for every order type, pickup included.
 *  - **Refunds are subtracted, never hidden.** A day with a large refund
 *    should look like one.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScope,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                          */
  /* ------------------------------------------------------------------ */

  async dashboard(range: ReportRange): Promise<DashboardStats> {
    const { from, to, branchId } = await this.resolveRange(range);

    // The preceding window of equal length, for the change percentages.
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);

    const scope = { ...(branchId ? { branchId } : {}) };
    const delivered = { status: OrderStatus.DELIVERED };

    const [current, previous, cancelled, byType, bySource, customers, newCustomers] =
      await Promise.all([
        this.prisma.db.order.aggregate({
          where: { ...scope, ...delivered, createdAt: { gte: from, lte: to } },
          _sum: { total: true, refundedTotal: true },
          _count: { _all: true },
        }),
        this.prisma.db.order.aggregate({
          where: { ...scope, ...delivered, createdAt: { gte: prevFrom, lt: from } },
          _sum: { total: true, refundedTotal: true },
          _count: { _all: true },
        }),
        this.prisma.db.order.count({
          where: { ...scope, status: OrderStatus.CANCELLED, createdAt: { gte: from, lte: to } },
        }),
        this.prisma.db.order.groupBy({
          by: ['type'],
          where: { ...scope, ...delivered, createdAt: { gte: from, lte: to } },
          _count: { _all: true },
        }),
        this.prisma.db.order.groupBy({
          by: ['source'],
          where: { ...scope, ...delivered, createdAt: { gte: from, lte: to } },
          _count: { _all: true },
        }),
        this.prisma.db.order.findMany({
          where: {
            ...scope,
            ...delivered,
            createdAt: { gte: from, lte: to },
            customerId: { not: null },
          },
          select: { customerId: true },
          distinct: ['customerId'],
        }),
        this.prisma.db.customer.count({
          where: { createdAt: { gte: from, lte: to }, deletedAt: null },
        }),
      ]);

    const revenue = net(current._sum.total, current._sum.refundedTotal);
    const previousRevenue = net(previous._sum.total, previous._sum.refundedTotal);
    const ordersCount = current._count._all;

    const countFor = <T extends { _count: { _all: number } }>(
      rows: T[],
      match: (row: T) => boolean,
    ): number => rows.filter(match).reduce((sum, row) => sum + row._count._all, 0);

    return {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      branchId: branchId ?? null,
      revenue,
      ordersCount,
      averageCheck: ordersCount > 0 ? Math.round(revenue / ordersCount) : 0,
      customersCount: customers.length,
      newCustomersCount: newCustomers,
      cancelledOrders: cancelled,
      deliveryOrders: countFor(byType, (row) => row.type === OrderType.DELIVERY),
      posOrders: countFor(bySource, (row) => row.source === OrderSource.POS),
      // "Online" is everything a customer placed themselves, as opposed to a
      // till or a call taken by staff.
      onlineOrders: countFor(
        bySource,
        (row) =>
          row.source === OrderSource.WEB ||
          row.source === OrderSource.TELEGRAM_BOT ||
          row.source === OrderSource.TELEGRAM_MINI_APP ||
          row.source === OrderSource.QR_TABLE,
      ),
      revenueChangePercent: changePercent(revenue, previousRevenue),
      ordersChangePercent: changePercent(ordersCount, previous._count._all),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Sales                                                              */
  /* ------------------------------------------------------------------ */

  async sales(range: ReportRange, granularity: Granularity): Promise<SalesReport> {
    const { from, to, branchId } = await this.resolveRange(range);
    const scope = {
      ...(branchId ? { branchId } : {}),
      status: OrderStatus.DELIVERED,
      createdAt: { gte: from, lte: to },
    };

    const [totals, byType, bySource, payments, orders] = await Promise.all([
      this.prisma.db.order.aggregate({
        where: scope,
        _sum: { total: true, refundedTotal: true, discountTotal: true, deliveryFee: true },
        _count: { _all: true },
      }),
      this.prisma.db.order.groupBy({
        by: ['type'],
        where: scope,
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.db.order.groupBy({
        by: ['source'],
        where: scope,
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.db.payment.groupBy({
        by: ['method'],
        where: {
          ...(branchId ? { branchId } : {}),
          status: PaymentTransactionStatus.SUCCESS,
          paidAt: { gte: from, lte: to },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Pulled rather than grouped in SQL: bucketing by the branch's own
      // timezone is not something a `groupBy` can express, and a day that
      // starts at 05:00 because the server runs UTC is a wrong report.
      this.prisma.db.order.findMany({
        where: scope,
        select: { createdAt: true, total: true, refundedTotal: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const revenue = net(totals._sum.total, totals._sum.refundedTotal);
    const ordersCount = totals._count._all;
    const paymentTotal = payments.reduce((sum, row) => sum + (row._sum.amount ?? 0), 0);
    const timezone = await this.timezoneFor(branchId);

    return {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      branchId: branchId ?? null,
      revenue,
      refunds: totals._sum.refundedTotal ?? 0,
      ordersCount,
      averageCheck: ordersCount > 0 ? Math.round(revenue / ordersCount) : 0,
      discountTotal: totals._sum.discountTotal ?? 0,
      deliveryFees: totals._sum.deliveryFee ?? 0,
      byType: byType.map((row) => ({
        type: row.type as OrderType,
        count: row._count._all,
        revenue: row._sum.total ?? 0,
      })),
      bySource: bySource.map((row) => ({
        source: row.source as OrderSource,
        count: row._count._all,
        revenue: row._sum.total ?? 0,
      })),
      byPayment: payments
        .map(
          (row): PaymentBreakdownRow => ({
            method: row.method as PaymentMethod,
            amount: row._sum.amount ?? 0,
            count: row._count._all,
            sharePercent:
              paymentTotal > 0
                ? Math.round(((row._sum.amount ?? 0) / paymentTotal) * 1000) / 10
                : 0,
          }),
        )
        .sort((a, b) => b.amount - a.amount),
      timeline: bucket(orders, granularity, timezone),
    };
  }

  /**
   * Products ranked by revenue, with an ABC split.
   *
   * A is the top 80% of revenue, B the next 15%, C the tail. The split is
   * what a kitchen plans around: A items must never run out, C items are what
   * a menu can afford to drop.
   */
  async products(range: ReportRange, limit = 50): Promise<TopProductRow[]> {
    const { from, to, branchId } = await this.resolveRange(range);

    const rows = await this.prisma.db.orderItem.groupBy({
      by: ['productId', 'name'],
      where: {
        order: {
          ...(branchId ? { branchId } : {}),
          status: OrderStatus.DELIVERED,
          createdAt: { gte: from, lte: to },
        },
      },
      _sum: { quantity: true, total: true },
    });

    const ranked = rows
      .map((row) => ({
        productId: row.productId ?? '',
        name: row.name,
        quantity: row._sum.quantity ?? 0,
        revenue: row._sum.total ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const total = ranked.reduce((sum, row) => sum + row.revenue, 0);

    let running = 0;
    return ranked.slice(0, limit).map((row) => {
      running += row.revenue;
      const cumulative = total > 0 ? running / total : 0;

      return {
        ...row,
        abcClass: cumulative <= 0.8 ? 'A' : cumulative <= 0.95 ? 'B' : 'C',
        revenueSharePercent:
          total > 0 ? Math.round((row.revenue / total) * 1000) / 10 : 0,
      } satisfies TopProductRow;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Branches                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Every branch's trading side by side, best first.
   *
   * Two grouped queries rather than one dashboard call per branch, so the
   * ranking costs the same with two branches as with twenty. A branch-scoped
   * user sees only their own branches; a branch with no trade still appears,
   * with zeros, because "nothing sold" is itself the finding.
   */
  async branches(range: ReportRange): Promise<BranchReportRow[]> {
    const { from, to } = await this.resolveRange({ ...range, branchId: undefined });
    const allowed = this.branchScope.filterFor();
    const branchFilter = allowed ? { branchId: allowed } : {};
    const window = { ...branchFilter, createdAt: { gte: from, lte: to } };

    const [branches, delivered, cancelled] = await Promise.all([
      this.prisma.db.branch.findMany({
        where: { deletedAt: null, ...(allowed ? { id: allowed } : {}) },
        select: { id: true, name: true, isActive: true, dailyRevenueTarget: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.order.groupBy({
        by: ['branchId'],
        where: { ...window, status: OrderStatus.DELIVERED },
        _sum: { total: true, refundedTotal: true, discountTotal: true },
        _count: { _all: true },
      }),
      this.prisma.db.order.groupBy({
        by: ['branchId'],
        where: { ...window, status: OrderStatus.CANCELLED },
        _count: { _all: true },
      }),
    ]);

    return branches
      .map((branch): BranchReportRow => {
        const sold = delivered.find((row) => row.branchId === branch.id);
        const revenue = net(sold?._sum.total ?? null, sold?._sum.refundedTotal ?? null);
        const ordersCount = sold?._count._all ?? 0;
        return {
          branchId: branch.id,
          branchName: branch.name,
          isActive: branch.isActive,
          revenue,
          ordersCount,
          averageCheck: ordersCount > 0 ? Math.round(revenue / ordersCount) : 0,
          cancelledOrders: cancelled.find((row) => row.branchId === branch.id)?._count._all ?? 0,
          discountTotal: sold?._sum.discountTotal ?? 0,
          dailyRevenueTarget: branch.dailyRevenueTarget,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }

  /* ------------------------------------------------------------------ */
  /* Promotions                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * What each offer did: uses, the discount it cost, and the revenue of the
   * orders it was on — plus the same per branch.
   *
   * Read through ORDERS (tenant-scoped by the extension) rather than
   * `order_promotions` directly: that table has no tenant column of its own,
   * so querying it at the top level would not be scoped. Same revenue rule
   * as every report — DELIVERED orders, net of refunds.
   */
  async promotions(range: ReportRange): Promise<PromotionStats> {
    const { from, to, branchId } = await this.resolveRange(range);
    const allowed = this.branchScope.filterFor(branchId);

    const orders = await this.prisma.db.order.findMany({
      where: {
        ...(allowed ? { branchId: allowed } : {}),
        status: OrderStatus.DELIVERED,
        createdAt: { gte: from, lte: to },
      },
      select: {
        branchId: true,
        total: true,
        refundedTotal: true,
        discountTotal: true,
        promoCodeId: true,
        customerId: true,
        appliedPromotions: { select: { promotionId: true, amount: true } },
        promoCodeUsage: { select: { discountAmount: true } },
        branch: { select: { name: true } },
      },
    });

    const promoMap = new Map<string, { uses: number; discountTotal: number; revenue: number }>();
    const codeMap = new Map<string, { uses: number; discountTotal: number; revenue: number; customers: Set<string> }>();
    const branchMap = new Map<string, { branchName: string; ordersWithDiscount: number; discountTotal: number; revenue: number }>();
    let ordersWithDiscount = 0;
    let discountTotal = 0;
    let discountedRevenue = 0;
    let revenueTotal = 0;

    for (const order of orders) {
      const revenue = order.total - order.refundedTotal;
      revenueTotal += revenue;
      if (order.discountTotal <= 0) continue;

      ordersWithDiscount++;
      discountTotal += order.discountTotal;
      discountedRevenue += revenue;

      const branch = branchMap.get(order.branchId) ?? { branchName: order.branch.name, ordersWithDiscount: 0, discountTotal: 0, revenue: 0 };
      branch.ordersWithDiscount++;
      branch.discountTotal += order.discountTotal;
      branch.revenue += revenue;
      branchMap.set(order.branchId, branch);

      for (const applied of order.appliedPromotions) {
        if (!applied.promotionId) continue;
        const entry = promoMap.get(applied.promotionId) ?? { uses: 0, discountTotal: 0, revenue: 0 };
        entry.uses++;
        entry.discountTotal += applied.amount;
        entry.revenue += revenue;
        promoMap.set(applied.promotionId, entry);
      }

      if (order.promoCodeId) {
        const entry = codeMap.get(order.promoCodeId) ?? { uses: 0, discountTotal: 0, revenue: 0, customers: new Set<string>() };
        entry.uses++;
        entry.discountTotal += order.promoCodeUsage?.discountAmount ?? 0;
        entry.revenue += revenue;
        if (order.customerId) entry.customers.add(order.customerId);
        codeMap.set(order.promoCodeId, entry);
      }
    }

    // "New customers" for a code: people whose FIRST completed order used it.
    const codeCustomerIds = [...new Set([...codeMap.values()].flatMap((e) => [...e.customers]))];
    const firstOrders =
      codeCustomerIds.length > 0
        ? await this.prisma.db.order.findMany({
            where: { customerId: { in: codeCustomerIds }, status: OrderStatus.DELIVERED },
            orderBy: { createdAt: 'asc' },
            distinct: ['customerId'],
            select: { customerId: true, promoCodeId: true },
          })
        : [];
    const firstCodeOf = new Map(firstOrders.map((o) => [o.customerId, o.promoCodeId]));

    return {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      ordersWithDiscount,
      ordersTotal: orders.length,
      discountTotal,
      discountedRevenue,
      revenueTotal,
      promotions: [...promoMap.entries()].map(([promotionId, e]) => ({ promotionId, ...e })),
      promoCodes: [...codeMap.entries()].map(([promoCodeId, e]) => ({
        promoCodeId,
        uses: e.uses,
        discountTotal: e.discountTotal,
        revenue: e.revenue,
        newCustomers: [...e.customers].filter((id) => firstCodeOf.get(id) === promoCodeId).length,
      })),
      byBranch: [...branchMap.entries()]
        .map(([id, e]) => ({ branchId: id, ...e }))
        .sort((a, b) => b.revenue - a.revenue),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Finance                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Cash accountability across the period's shifts (TZ §19).
   *
   * The discrepancy list is the point of this report. Totals tell an owner
   * how the month went; the list tells them which evening to ask about.
   */
  async finance(range: ReportRange): Promise<FinanceReport> {
    const { from, to, branchId } = await this.resolveRange(range);

    const shifts = await this.prisma.db.cashShift.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        openedAt: { gte: from, lte: to },
      },
      include: { closedBy: { select: { fullName: true } } },
      orderBy: { openedAt: 'desc' },
    });

    const shiftIds = shifts.map((shift) => shift.id);

    const movements =
      shiftIds.length > 0
        ? await this.prisma.db.cashTransaction.groupBy({
            by: ['type'],
            where: { cashShiftId: { in: shiftIds } },
            _sum: { amount: true },
          })
        : [];

    const movementTotal = (type: CashTransactionType): number =>
      movements.find((row) => row.type === type)?._sum.amount ?? 0;

    const sum = (pick: (shift: (typeof shifts)[number]) => number): number =>
      shifts.reduce((total, shift) => total + pick(shift), 0);

    // Trading totals cover every shift in the window; the reconciliation
    // triple covers only CLOSED ones.
    //
    // An open shift has nothing counted yet. Summing its expected balance
    // against a counted figure of zero would show a shortage the size of the
    // drawer, and a reader comparing expected to counted would get a number
    // that disagrees with `difference` for no visible reason.
    const closed = shifts.filter((shift) => shift.closedAt !== null);
    const open = shifts.filter((shift) => shift.closedAt === null);
    const sumOf = (
      rows: typeof shifts,
      pick: (shift: (typeof shifts)[number]) => number,
    ): number => rows.reduce((total, shift) => total + pick(shift), 0);

    return {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      branchId: branchId ?? null,
      shiftsCount: shifts.length,
      openShiftsCount: open.length,
      openingCash: sum((shift) => shift.openingCash),
      cashSales: sum((shift) => shift.cashTotal),
      cardSales: sum((shift) => shift.cardTotal),
      onlineSales: sum((shift) => shift.onlineTotal),
      refunds: sum((shift) => shift.refundTotal),
      cashIn: movementTotal(CashTransactionType.CASH_IN),
      cashOut: movementTotal(CashTransactionType.CASH_OUT),
      courierHandovers: movementTotal(CashTransactionType.COURIER_HANDOVER),
      expectedCash: sumOf(closed, (shift) => shift.expectedCash),
      countedCash: sumOf(closed, (shift) => shift.actualCash ?? 0),
      difference: sumOf(closed, (shift) => shift.difference ?? 0),
      cashInOpenShifts: sumOf(open, (shift) => shift.expectedCash),
      discrepancies: shifts
        .filter((shift) => (shift.difference ?? 0) !== 0)
        .map((shift) => ({
          shiftId: shift.id,
          branchId: shift.branchId,
          closedAt: shift.closedAt?.toISOString() ?? null,
          expectedCash: shift.expectedCash,
          actualCash: shift.actualCash,
          difference: shift.difference ?? 0,
          closedByName: shift.closedBy?.fullName ?? null,
          comment: shift.comment,
        })),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Resolves a date range, defaulting to the last 30 days.
   *
   * Boundaries land on midnight in the BRANCH's timezone, not the server's.
   * A report that starts at 05:00 because the container runs UTC silently
   * moves five hours of trade into the wrong day.
   */
  private async resolveRange(range: ReportRange) {
    const timezone = await this.timezoneFor(range.branchId);

    const to = range.dateTo ? endOfDay(new Date(range.dateTo), timezone) : new Date();
    const from = range.dateFrom
      ? startOfDayInZone(new Date(range.dateFrom), timezone)
      : startOfDayInZone(new Date(to.getTime() - 29 * 86_400_000), timezone);

    if (from > to) {
      throw AppException.badRequest('Boshlanish sanasi tugashdan keyin boʻlishi mumkin emas');
    }

    return { from, to, branchId: range.branchId, timezone };
  }

  private async timezoneFor(branchId?: string): Promise<string> {
    if (branchId) {
      const branch = await this.prisma.db.branch.findFirst({
        where: { id: branchId },
        select: { timezone: true },
      });
      if (branch) return branch.timezone;
    }

    const tenantId = getContext()?.tenantId;
    if (!tenantId) return 'Asia/Tashkent';

    const tenant = await this.prisma.db.tenant.findFirst({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone ?? 'Asia/Tashkent';
  }
}

/* -------------------------------------------------------------------------- */

/** Revenue net of refunds. Both come back as `null` when nothing matched. */
function net(total: number | null, refunded: number | null): number {
  return (total ?? 0) - (refunded ?? 0);
}

/** Percentage change, or `null` when there is no baseline to compare against. */
function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** End of the given day in `timeZone`, as a UTC instant. */
function endOfDay(date: Date, timeZone: string): Date {
  return new Date(startOfDayInZone(date, timeZone).getTime() + 86_400_000 - 1);
}

/**
 * Buckets orders into a timeline.
 *
 * Done in JavaScript against the branch's timezone rather than in SQL: Postgres
 * can group by a truncated timestamp, but not by a per-branch zone without
 * threading the zone into the query, and a wrong day boundary is a wrong
 * report rather than a slow one.
 */
function bucket(
  orders: Array<{ createdAt: Date; total: number; refundedTotal: number }>,
  granularity: Granularity,
  timeZone: string,
): RevenuePoint[] {
  const buckets = new Map<string, { revenue: number; orders: number }>();

  for (const order of orders) {
    const key = bucketKey(order.createdAt, granularity, timeZone);
    const entry = buckets.get(key) ?? { revenue: 0, orders: 0 };
    entry.revenue += order.total - order.refundedTotal;
    entry.orders += 1;
    buckets.set(key, entry);
  }

  return [...buckets.entries()]
    .map(([at, value]) => ({ at, revenue: value.revenue, orders: value.orders }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

function bucketKey(date: Date, granularity: Granularity, timeZone: string): string {
  const local = new Date(date.toLocaleString('en-US', { timeZone }));
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');

  switch (granularity) {
    case 'hour':
      return `${yyyy}-${mm}-${dd}T${String(local.getHours()).padStart(2, '0')}:00`;
    case 'month':
      return `${yyyy}-${mm}`;
    case 'week': {
      // ISO week starts Monday; `getDay()` puts Sunday at 0.
      const monday = new Date(local);
      const offset = (local.getDay() + 6) % 7;
      monday.setDate(local.getDate() - offset);
      return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(
        monday.getDate(),
      ).padStart(2, '0')}`;
    }
    default:
      return `${yyyy}-${mm}-${dd}`;
  }
}
