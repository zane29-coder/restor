import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvent,
  KitchenTicketStatus,
  OrderStatus,
  type KitchenTicket,
  type OrderCreatedPayload,
} from '@restor/shared-types';
import { secondsSince } from '@restor/shared-utils';
import { AppException } from '../../common/errors/app-exception';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { runAsTenant } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { OrdersService } from '../orders/orders.service';

const TICKET_INCLUDE = {
  order: { select: { id: true, displayNumber: true, branchId: true, comment: true, source: true } },
  items: {
    include: {
      orderItem: { include: { modifiers: true } },
    },
  },
} as const;

/**
 * Kitchen Display System (TZ §21, §22).
 *
 * Tickets are created by reacting to `order.created` rather than being written
 * inline by the order service: the kitchen is a consumer of orders, not part
 * of placing one, and a KDS problem must never fail a sale (TZ §58).
 *
 * Items are split across stations when the branch has any configured; with no
 * stations the whole order becomes one ticket, which is what a small fast food
 * kitchen wants.
 */
@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly branchScope: BranchScope,
  ) {}

  /** Open tickets for one branch, newest last so the oldest is worked first. */
  async tickets(branchId: string, stationId?: string): Promise<KitchenTicket[]> {
    this.branchScope.assertCanAccess(branchId);

    const rows = await this.prisma.db.kitchenTicket.findMany({
      where: {
        branchId,
        ...(stationId ? { stationId } : {}),
        status: { in: [KitchenTicketStatus.QUEUED, KitchenTicketStatus.IN_PROGRESS] },
      },
      include: TICKET_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    return rows.map(toTicket);
  }

  async start(ticketId: string): Promise<KitchenTicket> {
    const ticket = await this.findTicket(ticketId);

    if (ticket.status !== KitchenTicketStatus.QUEUED) {
      throw AppException.conflict('This ticket is already being prepared');
    }

    const row = await this.prisma.db.kitchenTicket.update({
      where: { id: ticketId },
      data: { status: KitchenTicketStatus.IN_PROGRESS, startedAt: new Date() },
      include: TICKET_INCLUDE,
    });

    // The first station to start moves the whole order to PREPARING.
    await this.syncOrderStatus(row.orderId, OrderStatus.PREPARING);

    return toTicket(row);
  }

  async ready(ticketId: string): Promise<KitchenTicket> {
    const ticket = await this.findTicket(ticketId);

    if (ticket.status === KitchenTicketStatus.READY) {
      return toTicket(ticket);
    }

    const row = await this.prisma.db.kitchenTicket.update({
      where: { id: ticketId },
      data: { status: KitchenTicketStatus.READY, readyAt: new Date() },
      include: TICKET_INCLUDE,
    });

    // The order is only READY once EVERY station has finished its part.
    const outstanding = await this.prisma.db.kitchenTicket.count({
      where: {
        orderId: row.orderId,
        status: { in: [KitchenTicketStatus.QUEUED, KitchenTicketStatus.IN_PROGRESS] },
      },
    });

    if (outstanding === 0) {
      await this.syncOrderStatus(row.orderId, OrderStatus.READY);
    }

    return toTicket(row);
  }

  /**
   * Creates tickets for a newly placed order.
   *
   * Runs in the tenant's scope explicitly: an event listener has no HTTP
   * request behind it, so the tenant must be re-established from the payload
   * or the Prisma extension would refuse the query.
   */
  @OnEvent(DomainEvent.ORDER_CREATED, { async: true })
  async onOrderCreated(payload: OrderCreatedPayload): Promise<void> {
    await runAsTenant(payload.tenantId, async () => {
      const order = await this.prisma.db.order.findFirst({
        where: { id: payload.orderId },
        include: { items: { select: { id: true, productId: true } } },
      });
      if (!order) return;

      const stations = await this.prisma.db.kitchenStation.findMany({
        where: { branchId: order.branchId, isActive: true },
        include: { categories: { select: { categoryId: true } } },
      });

      // No stations configured: one ticket for the whole order.
      if (stations.length === 0) {
        await this.prisma.db.kitchenTicket.create({
          data: {
            orderId: order.id,
            branchId: order.branchId,
            items: { create: order.items.map((item) => ({ orderItemId: item.id })) },
          },
        });
        return;
      }

      const productIds = order.items
        .map((item) => item.productId)
        .filter((id): id is string => Boolean(id));

      const products = await this.prisma.db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, categoryId: true },
      });
      const categoryByProduct = new Map(products.map((p) => [p.id, p.categoryId]));

      // Group items by the station that prepares their category.
      const byStation = new Map<string | null, string[]>();

      for (const item of order.items) {
        const categoryId = item.productId ? categoryByProduct.get(item.productId) : undefined;
        const station = stations.find((candidate) =>
          candidate.categories.some((link) => link.categoryId === categoryId),
        );

        // An item whose category maps to no station still has to be cooked, so
        // it goes to an unassigned ticket rather than vanishing.
        const key = station?.id ?? null;
        byStation.set(key, [...(byStation.get(key) ?? []), item.id]);
      }

      await this.prisma.transaction(async (tx) => {
        for (const [stationId, itemIds] of byStation) {
          await tx.kitchenTicket.create({
            data: {
              orderId: order.id,
              branchId: order.branchId,
              stationId,
              items: { create: itemIds.map((orderItemId) => ({ orderItemId })) },
            },
          });
        }
      });
    });
  }

  /** Cancels outstanding tickets when the order is cancelled. */
  @OnEvent(DomainEvent.ORDER_CANCELLED, { async: true })
  async onOrderCancelled(payload: { tenantId: string; orderId: string }): Promise<void> {
    await runAsTenant(payload.tenantId, () =>
      this.prisma.db.kitchenTicket.updateMany({
        where: {
          orderId: payload.orderId,
          status: { in: [KitchenTicketStatus.QUEUED, KitchenTicketStatus.IN_PROGRESS] },
        },
        data: { status: KitchenTicketStatus.CANCELLED },
      }),
    );
  }

  private async findTicket(id: string) {
    const ticket = await this.prisma.db.kitchenTicket.findFirst({
      where: { id },
      include: TICKET_INCLUDE,
    });
    if (!ticket) throw AppException.notFound('Kitchen ticket');

    this.branchScope.assertCanAccess(ticket.branchId);
    return ticket;
  }

  /**
   * Nudges the order's status, ignoring an illegal transition.
   *
   * The kitchen should not be able to fail because an operator cancelled the
   * order a second earlier — the order's own state machine remains the
   * authority.
   */
  private async syncOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    try {
      await this.orders.updateStatus(orderId, { status });
    } catch {
      // Transition no longer legal; the order moved on without the kitchen.
    }
  }
}

type TicketRow = {
  id: string;
  orderId: string;
  branchId: string;
  stationId: string | null;
  status: KitchenTicketStatus;
  createdAt: Date;
  startedAt: Date | null;
  readyAt: Date | null;
  order: { id: string; displayNumber: string; branchId: string; comment: string | null; source: string };
  items: Array<{
    orderItem: {
      id: string;
      name: string;
      variantName: string | null;
      quantity: number;
      comment: string | null;
      modifiers: Array<{ name: string }>;
    };
  }>;
};

function toTicket(row: TicketRow): KitchenTicket {
  return {
    id: row.id,
    orderId: row.orderId,
    displayNumber: row.order.displayNumber,
    branchId: row.branchId,
    stationId: row.stationId,
    status: row.status,
    source: row.order.source as KitchenTicket['source'],
    items: row.items.map((link) => ({
      id: link.orderItem.id,
      name: link.orderItem.name,
      variantName: link.orderItem.variantName,
      quantity: link.orderItem.quantity,
      modifiers: link.orderItem.modifiers.map((modifier) => modifier.name),
      comment: link.orderItem.comment,
    })),
    comment: row.order.comment,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    readyAt: row.readyAt?.toISOString() ?? null,
    // Computed server-side so every KDS screen agrees on the colour band even
    // if a tablet's clock has drifted.
    elapsedSeconds: secondsSince(row.createdAt),
  };
}
