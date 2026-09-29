import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvent,
  NotificationChannel,
  OrderStatus,
  TelegramEvent,
  type OrderCreatedPayload,
  type OrderStatusChangedPayload,
  type PaymentReceivedPayload,
} from '@restor/shared-types';
import { runAsTenant } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  buildNewOrderMessage,
  buildPaymentMessage,
  buildStatusMessage,
  type OrderMessageContext,
} from '../../integrations/telegram/message.builder';
import { TelegramService } from './telegram.service';

/** Which domain events produce which routable Telegram event. */
const STATUS_TO_EVENT: Partial<Record<OrderStatus, TelegramEvent>> = {
  [OrderStatus.ACCEPTED]: TelegramEvent.ORDER_ACCEPTED,
  [OrderStatus.READY]: TelegramEvent.KITCHEN_READY,
  [OrderStatus.COURIER_ASSIGNED]: TelegramEvent.COURIER_ASSIGNED,
  [OrderStatus.DELIVERED]: TelegramEvent.ORDER_DELIVERED,
  [OrderStatus.CANCELLED]: TelegramEvent.ORDER_CANCELLED,
};

/**
 * Turns domain events into routed Telegram notifications (TZ §15, §58).
 *
 * The order service knows nothing about Telegram; it emits `order.created` and
 * this listener decides whether anyone wants to hear about it. That is what
 * lets a Telegram outage leave order-taking untouched.
 *
 * Listeners run outside an HTTP request, so each re-establishes the tenant
 * with `runAsTenant` — without it the Prisma scoping extension would (rightly)
 * refuse the queries.
 */
@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(DomainEvent.ORDER_CREATED, { async: true })
  async onOrderCreated(payload: OrderCreatedPayload): Promise<void> {
    await this.safely('order.new', payload.tenantId, async () => {
      const context = await this.loadOrderContext(payload.tenantId, payload.orderId);

      await this.send({
        tenantId: payload.tenantId,
        branchId: payload.branchId,
        event: TelegramEvent.NEW_ORDER,
        template: 'order.new',
        text: buildNewOrderMessage(payload, context),
        requestId: payload.requestId,
        entity: { type: 'Order', id: payload.orderId },
      });
    });
  }

  @OnEvent(DomainEvent.ORDER_STATUS_CHANGED, { async: true })
  async onStatusChanged(payload: OrderStatusChangedPayload): Promise<void> {
    const event = STATUS_TO_EVENT[payload.toStatus];
    // Not every transition is worth a message — PREPARING is noise in a group.
    if (!event) return;

    await this.safely('order.status', payload.tenantId, async () => {
      const context = await this.loadOrderContext(payload.tenantId, payload.orderId);

      await this.send({
        tenantId: payload.tenantId,
        branchId: payload.branchId,
        event,
        template: 'order.status',
        text: buildStatusMessage(payload, context),
        requestId: payload.requestId,
        entity: { type: 'Order', id: payload.orderId },
        // A status update should not buzz every phone in the group at 2am.
        silent: true,
      });
    });
  }

  @OnEvent(DomainEvent.PAYMENT_RECEIVED, { async: true })
  async onPaymentReceived(payload: PaymentReceivedPayload): Promise<void> {
    await this.safely('payment.received', payload.tenantId, async () => {
      const context = await this.loadOrderContext(payload.tenantId, payload.orderId);

      await this.send({
        tenantId: payload.tenantId,
        branchId: payload.branchId,
        event: TelegramEvent.PAYMENT_RECEIVED,
        template: 'payment.received',
        text: buildPaymentMessage(payload, context),
        requestId: payload.requestId,
        entity: { type: 'Order', id: payload.orderId },
      });
    });
  }

  /* ------------------------------------------------------------------ */

  /**
   * Resolves where an event should go and queues it.
   *
   * Routing precedence, most specific first:
   *   1. a route for this event AND this branch
   *   2. a route for this event with no branch (tenant-wide)
   *   3. the config's `defaultChatId`
   *
   * Nothing configured is a normal state, not an error — a restaurant that has
   * not set up Telegram should not fill the log with warnings.
   */
  private async send(params: {
    tenantId: string;
    branchId: string | null;
    event: TelegramEvent;
    template: string;
    text: string;
    requestId: string | null;
    entity: { type: string; id: string };
    silent?: boolean;
  }): Promise<void> {
    const destination = await this.resolveDestination(
      params.tenantId,
      params.branchId,
      params.event,
    );

    if (!destination) {
      await this.notifications.recordSkipped(
        params.tenantId,
        params.template,
        `No Telegram route for ${params.event}`,
      );
      return;
    }

    const botToken = await this.telegram.resolveBotToken(params.tenantId, params.branchId);
    if (!botToken) {
      await this.notifications.recordSkipped(
        params.tenantId,
        params.template,
        'No bot token configured',
      );
      return;
    }

    await this.notifications.dispatch({
      tenantId: params.tenantId,
      channel: NotificationChannel.TELEGRAM,
      recipient: destination.chatId,
      topicId: destination.topicId,
      text: params.text,
      template: params.template,
      event: params.event,
      botToken,
      requestId: params.requestId,
      entity: params.entity,
      silent: params.silent,
    });
  }

  private async resolveDestination(
    tenantId: string,
    branchId: string | null,
    event: TelegramEvent,
  ): Promise<{ chatId: string; topicId: number | null } | null> {
    return runAsTenant(tenantId, async () => {
      const routes = await this.prisma.db.telegramRoute.findMany({
        where: {
          event,
          isActive: true,
          config: { tenantId, isActive: true },
          OR: [{ branchId }, { branchId: null }],
        },
        select: { branchId: true, chatId: true, topicId: true },
      });

      const match =
        routes.find((route) => route.branchId === branchId) ??
        routes.find((route) => route.branchId === null);

      if (match) return { chatId: match.chatId, topicId: match.topicId };

      // Fall back to the config's default chat, preferring the branch's own.
      const configs = await this.prisma.db.telegramConfig.findMany({
        where: {
          tenantId,
          isActive: true,
          defaultChatId: { not: null },
          OR: [{ branchId }, { branchId: null }],
        },
        select: { branchId: true, defaultChatId: true },
      });

      const fallback =
        configs.find((config) => config.branchId === branchId) ??
        configs.find((config) => config.branchId === null);

      return fallback?.defaultChatId ? { chatId: fallback.defaultChatId, topicId: null } : null;
    });
  }

  /** Details the event payload does not carry but the message wants. */
  private async loadOrderContext(
    tenantId: string,
    orderId: string,
  ): Promise<OrderMessageContext> {
    return runAsTenant(tenantId, async () => {
      const order = await this.prisma.db.order.findFirst({
        where: { id: orderId },
        select: {
          subtotal: true,
          deliveryFee: true,
          discountTotal: true,
          addressText: true,
          addressApartment: true,
          comment: true,
          tableNumber: true,
          paymentStatus: true,
          estimatedReadyAt: true,
          branch: { select: { name: true } },
          payments: { select: { method: true }, take: 1 },
        },
      });

      if (!order) return {};

      const address = order.addressText
        ? order.addressApartment
          ? `${order.addressText}, ${order.addressApartment}-xonadon`
          : order.addressText
        : null;

      return {
        branchName: order.branch?.name ?? null,
        address,
        comment: order.comment,
        tableNumber: order.tableNumber,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        discountTotal: order.discountTotal,
        paymentLabel: order.payments[0]?.method ?? null,
        paymentStatus: order.paymentStatus,
        estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * Runs a listener without letting it break the emitter.
   *
   * An unhandled rejection in an `@OnEvent` handler would surface as an
   * unhandled promise rejection in the process, far from its cause.
   */
  private async safely(
    template: string,
    tenantId: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error({ err: error, template, tenantId }, 'Telegram notification failed');
    }
  }
}
