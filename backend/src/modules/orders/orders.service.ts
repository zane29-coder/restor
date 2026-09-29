import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  DomainEvent,
  ErrorCode,
  OrderSource,
  OrderStatus,
  OrderType,
  canTransitionOrderStatus,
  type Order,
  type OrderPricePreview,
  type OrderStatusHistoryEntry,
  type Paginated,
} from '@restor/shared-types';
import { normalizePagination, normalizePhone, paginated } from '@restor/shared-utils';
import type { CreateOrderInput, UpdateOrderStatusInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrderNumberService } from './order-number.service';
import { OrderPricingService, type PricingResult } from './order-pricing.service';
import { toOrder, ORDER_INCLUDE, type OrderRow } from './order.mapper';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: OrderPricingService,
    private readonly numbers: OrderNumberService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly branchScope: BranchScope,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Reads                                                              */
  /* ------------------------------------------------------------------ */

  async list(query: {
    page?: number;
    limit?: number;
    branchId?: string;
    status?: OrderStatus | OrderStatus[];
    type?: OrderType;
    source?: OrderSource;
    courierId?: string;
    customerId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }): Promise<Paginated<Order>> {
    const page = normalizePagination(query);
    const branchFilter = this.branchScope.filterFor(query.branchId);

    const statuses = query.status
      ? Array.isArray(query.status)
        ? query.status
        : [query.status]
      : undefined;

    const where: Prisma.OrderWhereInput = {
      ...(branchFilter ? { branchId: branchFilter as Prisma.OrderWhereInput['branchId'] } : {}),
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.courierId ? { courierId: query.courierId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { displayNumber: { contains: query.search, mode: 'insensitive' } },
              { customerPhone: { contains: query.search } },
              { customerName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.order.count({ where }),
    ]);

    return paginated(rows.map(toOrder), total, page);
  }

  async get(id: string): Promise<Order> {
    const row = await this.findRow(id);
    return toOrder(row);
  }

  /** Order timeline (TZ §13). */
  async timeline(id: string): Promise<OrderStatusHistoryEntry[]> {
    await this.findRow(id);

    const rows = await this.prisma.db.orderStatusHistory.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { fullName: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      userId: row.userId,
      userName: row.user?.fullName ?? null,
      comment: row.comment,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Prices a cart without persisting anything. */
  async preview(input: CreateOrderInput): Promise<OrderPricePreview> {
    const result = await this.pricing.price({
      branchId: input.branchId,
      type: input.type,
      items: input.items,
      // The API accepts `null` here because a client building this from a form
      // naturally sends `promoCode: value || null`. Pricing draws no
      // distinction between absent and null, so normalise at the boundary.
      promoCode: input.promoCode ?? undefined,
      customerId: input.customer?.id,
      deliveryLatitude: input.deliveryAddress?.latitude ?? null,
      deliveryLongitude: input.deliveryAddress?.longitude ?? null,
    });

    return this.pricing.toPreview(result);
  }

  /* ------------------------------------------------------------------ */
  /* Create                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Creates an order.
   *
   * Idempotent on `clientUuid`: a POS replaying a queued offline order gets
   * back the original instead of creating a duplicate (TZ §18). The check is
   * belt-and-braces — a pre-check for the common case, plus the unique index
   * on `(tenantId, clientUuid)` to close the race between two concurrent
   * replays.
   */
  async create(input: CreateOrderInput): Promise<Order> {
    if (input.clientUuid) {
      const existing = await this.prisma.db.order.findFirst({
        where: { clientUuid: input.clientUuid },
        include: ORDER_INCLUDE,
      });
      if (existing) {
        this.logger.log({ clientUuid: input.clientUuid }, 'Replayed order returned as-is');
        return toOrder(existing);
      }
    }

    this.branchScope.assertCanAccess(input.branchId);

    const branch = await this.prisma.db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, isActive: true },
    });
    if (!branch) throw AppException.notFound('Branch', ErrorCode.BRANCH_NOT_FOUND);

    const address = await this.resolveAddress(input);
    const customer = await this.resolveCustomer(input);

    const priced = await this.pricing.price({
      branchId: input.branchId,
      type: input.type,
      items: input.items,
      // The API accepts `null` here because a client building this from a form
      // naturally sends `promoCode: value || null`. Pricing draws no
      // distinction between absent and null, so normalise at the boundary.
      promoCode: input.promoCode ?? undefined,
      customerId: customer?.id,
      deliveryLatitude: address?.latitude ?? null,
      deliveryLongitude: address?.longitude ?? null,
    });

    if (input.type === OrderType.DELIVERY && priced.subtotal < branch.minOrderAmount) {
      throw new AppException(
        ErrorCode.MIN_ORDER_NOT_REACHED,
        `The minimum delivery order at this branch is ${branch.minOrderAmount}`,
        422,
      );
    }

    const table = input.tableId ? await this.resolveTable(input.tableId, input.branchId) : null;
    const ctx = getContext();

    try {
      const row = await this.prisma.transaction(async (tx) => {
        const number = await this.numbers.next(tx, branch.id);
        const displayNumber = this.numbers.format(number, branch.orderPrefix);

        const created = await tx.order.create({
          data: {
            tenantId: branch.tenantId,
            branchId: branch.id,
            number,
            displayNumber,
            type: input.type,
            source: input.source ?? OrderSource.WEB,
            status: OrderStatus.NEW,
            customerId: customer?.id ?? null,
            customerName: input.customer?.name ?? customer?.fullName ?? null,
            customerPhone: input.customer?.phone ?? customer?.phone ?? null,

            subtotal: priced.subtotal,
            discountTotal: priced.discountTotal,
            deliveryFee: priced.deliveryFee,
            serviceFee: priced.serviceFee,
            total: priced.total,

            ...(address
              ? {
                  addressLabel: address.label,
                  addressText: address.address,
                  addressLatitude: address.latitude,
                  addressLongitude: address.longitude,
                  addressEntrance: address.entrance,
                  addressFloor: address.floor,
                  addressApartment: address.apartment,
                  addressLandmark: address.landmark,
                  addressComment: address.comment,
                }
              : {}),

            tableId: table?.id ?? null,
            tableNumber: table?.number ?? null,
            promoCodeId: priced.promoCodeId,
            comment: input.comment ?? null,
            scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
            estimatedReadyAt: new Date(Date.now() + priced.estimatedPrepMinutes * 60_000),
            createdByUserId: ctx?.userId ?? null,
            clientUuid: input.clientUuid ?? null,

            items: {
              create: priced.items.map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                name: item.name,
                variantName: item.variantName,
                unitPrice: item.unitPrice,
                quantity: item.quantity,
                total: item.total,
                comment: item.comment,
                modifiers: {
                  create: item.modifiers.map((modifier) => ({
                    modifierId: modifier.modifierId,
                    name: modifier.name,
                    price: modifier.price,
                  })),
                },
              })),
            },

            statusHistory: {
              create: { toStatus: OrderStatus.NEW, userId: ctx?.userId ?? null },
            },

            ...(priced.appliedPromotions.length
              ? {
                  appliedPromotions: {
                    create: priced.appliedPromotions
                      .filter((promotion) => promotion.promotionId)
                      .map((promotion) => ({
                        promotionId: promotion.promotionId,
                        name: promotion.name,
                        amount: promotion.amount,
                      })),
                  },
                }
              : {}),
          },
          include: ORDER_INCLUDE,
        });

        // Redeeming the code and bumping its counter must be atomic with the
        // order, or a rolled-back order would still consume a redemption.
        if (priced.promoCodeId) {
          await tx.promoCodeUsage.create({
            data: {
              promoCodeId: priced.promoCodeId,
              customerId: customer?.id ?? null,
              orderId: created.id,
              discountAmount:
                priced.appliedPromotions.find((p) => p.promoCodeId)?.amount ?? 0,
            },
          });
          await tx.promoCode.update({
            where: { id: priced.promoCodeId },
            data: { usedCount: { increment: 1 } },
          });
        }

        if (input.type === OrderType.DELIVERY) {
          await tx.delivery.create({
            data: {
              tenantId: branch.tenantId,
              branchId: branch.id,
              orderId: created.id,
              customerFee: priced.deliveryFee,
            },
          });
        }

        return created;
      });

      await this.emitCreated(row);

      await this.audit.record({
        action: AuditAction.ORDER_CREATED,
        entity: 'Order',
        entityId: row.id,
        newValue: { displayNumber: row.displayNumber, total: row.total, type: row.type },
      });

      return toOrder(row);
    } catch (error) {
      // The unique index caught a concurrent replay of the same clientUuid.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        input.clientUuid
      ) {
        const existing = await this.prisma.db.order.findFirst({
          where: { clientUuid: input.clientUuid },
          include: ORDER_INCLUDE,
        });
        if (existing) return toOrder(existing);
      }
      throw error;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Status transitions                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Moves an order along its lifecycle (TZ §12).
   *
   * The allowed transitions live in `@restor/shared-types`, so the KDS, POS
   * and admin panel all agree on what is legal — and a client cannot jump an
   * order straight from NEW to DELIVERED.
   */
  async updateStatus(id: string, input: UpdateOrderStatusInput): Promise<Order> {
    const order = await this.findRow(id);

    if (order.status === input.status) {
      return toOrder(order);
    }

    if (!canTransitionOrderStatus(order.status, input.status)) {
      throw new AppException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `An order cannot go from ${order.status} to ${input.status}`,
        409,
      );
    }

    const ctx = getContext();
    const now = new Date();

    const row = await this.prisma.transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.status === OrderStatus.ACCEPTED ? { acceptedAt: now } : {}),
          ...(input.status === OrderStatus.READY ? { readyAt: now } : {}),
          ...(input.status === OrderStatus.DELIVERED ? { deliveredAt: now } : {}),
          ...(input.status === OrderStatus.CANCELLED
            ? { cancelledAt: now, cancelReason: input.cancelReason ?? null }
            : {}),
          statusHistory: {
            create: {
              fromStatus: order.status,
              toStatus: input.status,
              userId: ctx?.userId ?? null,
              comment: input.comment ?? input.cancelReason ?? null,
            },
          },
        },
        include: ORDER_INCLUDE,
      });

      // Delivered orders update the customer's CRM aggregates so the customer
      // list does not have to aggregate orders on every page load.
      if (input.status === OrderStatus.DELIVERED && updated.customerId) {
        await tx.customer.update({
          where: { id: updated.customerId },
          data: {
            ordersCount: { increment: 1 },
            totalSpent: { increment: updated.total },
            lastOrderAt: now,
          },
        });
        await tx.$executeRaw`
          UPDATE customers
          SET "averageCheck" = CASE WHEN "ordersCount" > 0
            THEN "totalSpent" / "ordersCount" ELSE 0 END
          WHERE id = ${updated.customerId}::uuid
        `;
      }

      // A cancelled order releases its promo-code redemption.
      if (input.status === OrderStatus.CANCELLED && updated.promoCodeId) {
        await tx.promoCode.update({
          where: { id: updated.promoCodeId },
          data: { usedCount: { decrement: 1 } },
        });
        await tx.promoCodeUsage.deleteMany({ where: { orderId: id } });
      }

      return updated;
    });

    await this.emitStatusChanged(row, order.status, input.comment ?? null);

    await this.audit.record({
      action:
        input.status === OrderStatus.CANCELLED
          ? AuditAction.ORDER_CANCELLED
          : AuditAction.ORDER_STATUS_CHANGED,
      entity: 'Order',
      entityId: id,
      oldValue: { status: order.status },
      newValue: { status: input.status, reason: input.cancelReason },
    });

    return toOrder(row);
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  private async findRow(id: string): Promise<OrderRow> {
    const row = await this.prisma.db.order.findFirst({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!row) throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);

    this.branchScope.assertCanAccess(row.branchId);
    return row;
  }

  /** Resolves a saved address id or an inline address into one shape. */
  private async resolveAddress(input: CreateOrderInput) {
    if (input.type !== OrderType.DELIVERY) return null;

    if (input.addressId) {
      const saved = await this.prisma.db.customerAddress.findFirst({
        where: { id: input.addressId, deletedAt: null },
      });
      if (!saved) throw AppException.notFound('Address');

      return {
        label: saved.label,
        address: saved.address,
        latitude: saved.latitude,
        longitude: saved.longitude,
        entrance: saved.entrance,
        floor: saved.floor,
        apartment: saved.apartment,
        landmark: saved.landmark,
        comment: saved.comment,
      };
    }

    const inline = input.deliveryAddress;
    if (!inline) throw AppException.badRequest('A delivery order needs an address');

    return {
      label: inline.label ?? null,
      address: inline.address,
      latitude: inline.latitude ?? null,
      longitude: inline.longitude ?? null,
      entrance: inline.entrance ?? null,
      floor: inline.floor ?? null,
      apartment: inline.apartment ?? null,
      landmark: inline.landmark ?? null,
      comment: inline.comment ?? null,
    };
  }

  /**
   * Finds or creates the customer.
   *
   * Phone is the natural key, so a repeat caller is recognised and their CRM
   * history keeps accumulating rather than fragmenting across records.
   */
  private async resolveCustomer(input: CreateOrderInput) {
    if (input.customer?.id) {
      return this.prisma.db.customer.findFirst({ where: { id: input.customer.id } });
    }

    const phone = input.customer?.phone ? normalizePhone(input.customer.phone) : null;
    if (!phone) return null;

    const tenantId = getContext()?.tenantId;
    if (!tenantId) {
      throw AppException.badRequest('No restaurant is in scope for this order');
    }

    return this.prisma.db.customer.upsert({
      where: { tenantId_phone: { tenantId, phone } },
      create: { tenantId, phone, fullName: input.customer?.name ?? null },
      update: input.customer?.name ? { fullName: input.customer.name } : {},
    });
  }

  private async resolveTable(tableId: string, branchId: string) {
    const table = await this.prisma.db.restaurantTable.findFirst({
      where: { id: tableId, branchId, deletedAt: null, isActive: true },
      select: { id: true, number: true },
    });
    if (!table) throw AppException.notFound('Table');
    return table;
  }

  private async emitCreated(row: OrderRow): Promise<void> {
    const ctx = getContext();

    this.events.emit(DomainEvent.ORDER_CREATED, {
      tenantId: row.tenantId,
      branchId: row.branchId,
      requestId: ctx?.requestId ?? null,
      actorUserId: ctx?.userId ?? null,
      occurredAt: new Date().toISOString(),
      orderId: row.id,
      displayNumber: row.displayNumber,
      type: row.type,
      source: row.source,
      total: row.total,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      itemsSummary: row.items.map((item) => ({ name: item.name, quantity: item.quantity })),
    });
  }

  private async emitStatusChanged(
    row: OrderRow,
    fromStatus: OrderStatus,
    comment: string | null,
  ): Promise<void> {
    const ctx = getContext();

    const payload = {
      tenantId: row.tenantId,
      branchId: row.branchId,
      requestId: ctx?.requestId ?? null,
      actorUserId: ctx?.userId ?? null,
      occurredAt: new Date().toISOString(),
      orderId: row.id,
      displayNumber: row.displayNumber,
      fromStatus,
      toStatus: row.status,
      comment,
    };

    this.events.emit(DomainEvent.ORDER_STATUS_CHANGED, payload);

    // Also emit the specific event so listeners can subscribe narrowly instead
    // of filtering every status change.
    const specific: Partial<Record<OrderStatus, string>> = {
      [OrderStatus.ACCEPTED]: DomainEvent.ORDER_ACCEPTED,
      [OrderStatus.PREPARING]: DomainEvent.ORDER_PREPARING,
      [OrderStatus.READY]: DomainEvent.ORDER_READY,
      [OrderStatus.DELIVERED]: DomainEvent.ORDER_DELIVERED,
      [OrderStatus.CANCELLED]: DomainEvent.ORDER_CANCELLED,
    };

    const event = specific[row.status];
    if (event) this.events.emit(event, payload);
  }
}

export type { PricingResult };
