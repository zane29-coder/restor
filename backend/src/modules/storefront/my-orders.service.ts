import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  PaymentMethod,
  PaymentTransactionStatus,
  type MyOrderDetail,
  type MyOrderSummary,
  type OnlineCheckoutLink,
  type Paginated,
  type PublicPromoCode,
} from '@restor/shared-types';
import { normalizePagination, paginated } from '@restor/shared-utils';
import { runUnscoped } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../database/prisma.service';
import { ORDER_INCLUDE, toOrder } from '../orders/order.mapper';
import { SuboService } from '../payments/subo.service';
import { requireCustomerSession } from './customer-session';
import { canRetryPayment, promoUsesLeft } from './storefront.math';

/** How many line names a history row previews. */
const PREVIEW_ITEMS = 3;

/**
 * The customer's own orders and promo codes (TZ 48 §15, §18, §22.3).
 *
 * Order history spans restaurants — it is the person's history, not one
 * restaurant's — so it reads across tenants, restricted to the restaurant
 * records linked to the session's account. Paying, on the other hand, only
 * ever happens in the restaurant of the session: the merchant key is that
 * restaurant's, and money must land with whoever cooked the food.
 */
@Injectable()
export class MyOrdersService {
  private readonly logger = new Logger(MyOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subo: SuboService,
  ) {}

  async list(query: { page?: number; limit?: number }): Promise<Paginated<MyOrderSummary>> {
    const session = await requireCustomerSession(this.prisma);
    const page = normalizePagination(query);
    const customerIds = await this.customerIdsOf(session.accountId);

    const where = { customerId: { in: customerIds } };

    const [rows, total] = await runUnscoped(() =>
      Promise.all([
        this.prisma.db.order.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: page.skip,
          take: page.take,
          select: {
            id: true,
            tenantId: true,
            displayNumber: true,
            type: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
            paymentProvider: true,
            total: true,
            createdAt: true,
            tenant: { select: { name: true, companyName: true, slug: true } },
            branch: { select: { name: true } },
            items: { select: { name: true, quantity: true }, orderBy: { createdAt: 'asc' } },
          },
        }),
        this.prisma.db.order.count({ where }),
      ]),
    );

    return paginated(
      rows.map((row) => ({
        id: row.id,
        displayNumber: row.displayNumber,
        restaurantName: row.tenant.companyName || row.tenant.name,
        restaurantSlug: row.tenant.slug,
        isCurrentRestaurant: row.tenantId === session.tenantId,
        branchName: row.branch?.name ?? null,
        type: row.type,
        status: row.status,
        paymentStatus: row.paymentStatus,
        paymentMethod: row.paymentMethod,
        paymentProvider: row.paymentProvider,
        total: row.total,
        itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
        itemsPreview: row.items.slice(0, PREVIEW_ITEMS).map((item) => item.name),
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
    );
  }

  async detail(orderId: string): Promise<MyOrderDetail> {
    const session = await requireCustomerSession(this.prisma);
    const customerIds = await this.customerIdsOf(session.accountId);

    const row = await runUnscoped(() =>
      this.prisma.db.order.findFirst({
        where: { id: orderId, customerId: { in: customerIds } },
        include: {
          ...ORDER_INCLUDE,
          tenant: { select: { name: true, companyName: true, slug: true } },
        },
      }),
    );
    // Someone else's order is "not found", not "forbidden": confirming it
    // exists would itself leak something.
    if (!row) throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);

    const isCurrentRestaurant = row.tenantId === session.tenantId;

    return {
      order: toOrder(row),
      restaurantName: row.tenant.companyName || row.tenant.name,
      restaurantSlug: row.tenant.slug,
      isCurrentRestaurant,
      canRetryPayment: isCurrentRestaurant && canRetryPayment(row),
    };
  }

  /**
   * Sends the customer back to pay an online order.
   *
   * Never creates an order, and never a second live charge: Subo's open
   * session is resumed when there is one (see `SuboService.startCheckout`).
   */
  async retryPayment(orderId: string, returnUrl?: string): Promise<OnlineCheckoutLink> {
    const session = await requireCustomerSession(this.prisma);

    // Scoped to this restaurant AND this customer's own record.
    const order = await this.prisma.db.order.findFirst({
      where: { id: orderId, customerId: session.customerId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentProvider: true,
        total: true,
        paidTotal: true,
      },
    });
    if (!order) throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);

    if (!canRetryPayment(order)) {
      throw new AppException(
        ErrorCode.PAYMENT_ALREADY_PROCESSED,
        'Bu buyurtma uchun onlayn toʻlov talab qilinmaydi',
        409,
      );
    }

    const checkout = await this.subo.startCheckout({
      orderId: order.id,
      provider: (order.paymentProvider as 'ATMOS' | 'CLICK' | 'PAYME' | null) ?? undefined,
      ...(returnUrl ? { returnUrl } : {}),
    });

    return { checkoutUrl: checkout.checkoutUrl, expiresAt: checkout.expiresAt, amount: checkout.amount };
  }

  /**
   * Asks Subo what happened to this order's pending payments.
   *
   * For a customer back from the payment page whose callback has not landed
   * yet. The answer comes from Subo's API through the same `reconcile` the
   * webhook uses — the customer returning is never itself taken as proof of
   * payment.
   */
  async refreshPayment(orderId: string): Promise<MyOrderDetail> {
    const session = await requireCustomerSession(this.prisma);

    const order = await this.prisma.db.order.findFirst({
      where: { id: orderId, customerId: session.customerId },
      select: {
        id: true,
        payments: {
          where: { method: PaymentMethod.SUBO, status: PaymentTransactionStatus.PENDING },
          select: { id: true },
        },
      },
    });
    if (!order) throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);

    for (const payment of order.payments) {
      try {
        await this.subo.reconcile(payment.id, session.tenantId);
      } catch (error) {
        // Subo unreachable: the webhook or the next check will settle it.
        this.logger.warn({ err: error, orderId }, 'Payment status check failed');
      }
    }

    return this.detail(orderId);
  }

  /**
   * The restaurant's public promo codes, with how many uses this customer has
   * left. Only this restaurant's: a code works only where it was issued.
   */
  async promoCodes(): Promise<PublicPromoCode[]> {
    const session = await requireCustomerSession(this.prisma);
    const now = new Date();

    const codes = await this.prisma.db.promoCode.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        isPublic: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // A code someone has fully redeemed is not "available" to anybody.
    const live = codes.filter((code) => code.usageLimit == null || code.usedCount < code.usageLimit);
    if (live.length === 0) return [];

    const [usages, branches] = await Promise.all([
      this.prisma.db.promoCodeUsage.groupBy({
        by: ['promoCodeId'],
        where: { customerId: session.customerId, promoCodeId: { in: live.map((code) => code.id) } },
        _count: { _all: true },
      }),
      this.prisma.db.branch.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    const usedBy = new Map(usages.map((usage) => [usage.promoCodeId, usage._count._all]));
    const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));

    return live
      .map((code) => ({
        id: code.id,
        code: code.code,
        type: code.type,
        discount: code.discount,
        maxDiscount: code.maxDiscount,
        minOrderAmount: code.minOrderAmount,
        startsAt: code.startsAt?.toISOString() ?? null,
        endsAt: code.endsAt?.toISOString() ?? null,
        description: code.description,
        branchNames: code.branchIds.flatMap((id) => {
          const name = branchName.get(id);
          return name ? [name] : [];
        }),
        usesLeft: promoUsesLeft(code.userLimit, usedBy.get(code.id) ?? 0),
      }))
      .filter((code) => code.usesLeft !== 0);
  }

  /** Every restaurant record of this person, across restaurants. */
  private async customerIdsOf(accountId: string): Promise<string[]> {
    const rows = await runUnscoped(() =>
      this.prisma.db.customer.findMany({ where: { accountId }, select: { id: true } }),
    );
    return rows.map((row) => row.id);
  }
}
