import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CustomerNotificationType,
  DomainEvent,
  NotificationCategory,
  NotificationChannel,
  PaymentMethod,
  type CampaignKind,
  type CustomerNotificationItem,
  type OrderCreatedPayload,
  type OrderStatusChangedPayload,
  type Paginated,
  type PaymentReceivedPayload,
} from '@restor/shared-types';
import { normalizePagination, paginated } from '@restor/shared-utils';
import { runAsTenant } from '../../common/context/request-context';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { miniAppUrlFor } from '../../integrations/telegram/bot-reply.builder';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import {
  notificationTypeForCampaign,
  notificationTypeForStatus,
  renderOrderNotification,
  renderTelegramText,
  type RenderedNotification,
} from './customer-notification.templates';

/** Where a notification's "Ochish" button takes the customer in the Mini App. */
interface DeepLink {
  order?: string;
  product?: string;
}

/**
 * The customer's notification centre (TZ 48 §16).
 *
 * One domain event becomes ONE inbox row, and the Telegram message is a side
 * effect that points back at it (`deliveryId`). There is no second path that
 * writes to Telegram for customers — so the bot and the Mini App always say
 * the same thing about the same order.
 *
 * Two independent switches on the account decide the channels:
 *   - `notifyTelegram` — whether anything is sent through the bot at all;
 *   - `marketingOptIn` — whether marketing is produced for this person.
 * Order updates never depend on marketing consent.
 *
 * Like the staff notifier, nothing here may fail the action that caused it:
 * every listener swallows and logs its own errors.
 */
@Injectable()
export class CustomerNotificationsService {
  private readonly logger = new Logger(CustomerNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Order events                                                       */
  /* ------------------------------------------------------------------ */

  @OnEvent(DomainEvent.ORDER_CREATED, { async: true })
  async onOrderCreated(payload: OrderCreatedPayload): Promise<void> {
    await this.forOrder(payload.tenantId, payload.orderId, CustomerNotificationType.ORDER_RECEIVED, payload.requestId);
  }

  @OnEvent(DomainEvent.ORDER_STATUS_CHANGED, { async: true })
  async onStatusChanged(payload: OrderStatusChangedPayload): Promise<void> {
    const type = notificationTypeForStatus(payload.toStatus);
    if (!type) return;
    await this.forOrder(payload.tenantId, payload.orderId, type, payload.requestId);
  }

  /** Online payments only — cash handed to a courier is not news to the payer. */
  @OnEvent(DomainEvent.PAYMENT_RECEIVED, { async: true })
  async onPaymentReceived(payload: PaymentReceivedPayload): Promise<void> {
    if (payload.method !== PaymentMethod.SUBO) return;
    await this.forOrder(
      payload.tenantId,
      payload.orderId,
      CustomerNotificationType.PAYMENT_RECEIVED,
      payload.requestId,
      payload.amount,
    );
  }

  @OnEvent(DomainEvent.PAYMENT_FAILED, { async: true })
  async onPaymentFailed(payload: PaymentReceivedPayload): Promise<void> {
    await this.forOrder(
      payload.tenantId,
      payload.orderId,
      CustomerNotificationType.PAYMENT_FAILED,
      payload.requestId,
      payload.amount,
    );
  }

  private async forOrder(
    tenantId: string,
    orderId: string,
    type: CustomerNotificationType,
    requestId: string | null,
    amount?: number,
  ): Promise<void> {
    try {
      const order = await runAsTenant(tenantId, () =>
        this.prisma.db.order.findFirst({
          where: { id: orderId },
          select: {
            id: true,
            displayNumber: true,
            type: true,
            total: true,
            estimatedReadyAt: true,
            cancelReason: true,
            tenant: { select: { name: true, slug: true } },
            customer: {
              select: {
                telegramId: true,
                account: { select: { id: true, notifyTelegram: true, deletedAt: true } },
              },
            },
          },
        }),
      );

      // Only people with a RESTOR account have an inbox: a walk-in at the till
      // or a phone order has nowhere to receive this.
      const account = order?.customer?.account;
      if (!order || !account || account.deletedAt) return;

      const rendered = renderOrderNotification(type, {
        displayNumber: order.displayNumber,
        orderType: order.type,
        total: order.total,
        estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
        cancelReason: order.cancelReason,
        amount,
      });

      await this.deliver({
        tenantId,
        accountId: account.id,
        rendered,
        orderId: order.id,
        restaurant: order.tenant,
        telegramChatId: account.notifyTelegram ? order.customer?.telegramId ?? null : null,
        link: { order: order.id },
        requestId,
      });
    } catch (error) {
      this.logger.error({ err: error, tenantId, orderId, type }, 'Customer notification failed');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Marketing                                                          */
  /* ------------------------------------------------------------------ */

  /** Customers of this restaurant who opted in — who a campaign would reach. */
  async countOptedIn(tenantId: string): Promise<number> {
    return runAsTenant(tenantId, () =>
      this.prisma.db.customer.count({ where: this.marketingAudience() }),
    );
  }

  /**
   * Writes a campaign into every opted-in customer's inbox and queues the
   * Telegram copies.
   *
   * The inbox rows are written before returning; the Telegram enqueueing runs
   * after the response, because a restaurant with thousands of customers must
   * not hold an admin's request open while every job is queued.
   */
  async sendCampaign(params: {
    tenantId: string;
    campaignId: string;
    kind: CampaignKind;
    title: string;
    body: string;
    productId: string | null;
    requestId: string | null;
  }): Promise<{ recipients: number; telegramQueued: number }> {
    const { tenantId } = params;

    const [recipients, tenant] = await runAsTenant(tenantId, () =>
      Promise.all([
        this.prisma.db.customer.findMany({
          where: this.marketingAudience(),
          select: {
            telegramId: true,
            account: { select: { id: true, notifyTelegram: true } },
          },
        }),
        this.prisma.db.tenant.findFirst({ select: { name: true, slug: true } }),
      ]),
    );

    // A person linked twice would otherwise get the message twice.
    const byAccount = new Map<string, { telegramId: string | null; notifyTelegram: boolean }>();
    for (const row of recipients) {
      if (row.account) {
        byAccount.set(row.account.id, {
          telegramId: row.telegramId,
          notifyTelegram: row.account.notifyTelegram,
        });
      }
    }
    if (byAccount.size === 0) return { recipients: 0, telegramQueued: 0 };

    const rendered: RenderedNotification = {
      type: notificationTypeForCampaign(params.kind),
      category: NotificationCategory.MARKETING,
      title: params.title,
      body: params.body,
      silent: true,
    };

    const rows = await this.prisma.db.customerNotification.createManyAndReturn({
      data: [...byAccount.keys()].map((accountId) => ({
        accountId,
        tenantId,
        type: rendered.type,
        category: rendered.category,
        title: rendered.title,
        body: rendered.body,
        productId: params.productId,
        campaignId: params.campaignId,
      })),
      select: { id: true, accountId: true },
    });

    const botToken = await this.telegram.resolveBotToken(tenantId, null);
    const telegramTargets = botToken
      ? rows.flatMap((row) => {
          const person = byAccount.get(row.accountId);
          return person?.telegramId && person.notifyTelegram
            ? [{ notificationId: row.id, chatId: person.telegramId }]
            : [];
        })
      : [];

    if (botToken && telegramTargets.length > 0) {
      const text = renderTelegramText(rendered, tenant?.name ?? null);
      const replyMarkup = this.openButton(
        tenant?.slug ?? null,
        params.productId ? { product: params.productId } : {},
        'Menyuni ochish',
      );

      // Deliberately not awaited — see the method comment. Each job still
      // lands in `notifications` with its own status, so nothing is lost
      // silently; the worker's rate limiter paces Telegram.
      void (async () => {
        for (const target of telegramTargets) {
          try {
            const deliveryId = await this.notifications.dispatch({
              tenantId,
              channel: NotificationChannel.TELEGRAM,
              recipient: target.chatId,
              text,
              template: 'customer.campaign',
              event: rendered.type,
              botToken,
              requestId: params.requestId,
              entity: { type: 'CustomerNotification', id: target.notificationId },
              silent: true,
              replyMarkup,
            });
            if (deliveryId) await this.linkDelivery(target.notificationId, deliveryId);
          } catch (error) {
            this.logger.warn({ err: error, campaignId: params.campaignId }, 'Campaign delivery not queued');
          }
        }
      })();
    }

    return { recipients: rows.length, telegramQueued: telegramTargets.length };
  }

  /* ------------------------------------------------------------------ */
  /* The customer's own inbox                                           */
  /* ------------------------------------------------------------------ */

  async list(
    accountId: string,
    query: { page?: number; limit?: number },
  ): Promise<Paginated<CustomerNotificationItem>> {
    const page = normalizePagination(query);
    const where = { accountId };

    const [rows, total] = await Promise.all([
      this.prisma.db.customerNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: { tenant: { select: { name: true } } },
      }),
      this.prisma.db.customerNotification.count({ where }),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        category: row.category,
        title: row.title,
        body: row.body,
        restaurantName: row.tenant?.name ?? null,
        orderId: row.orderId,
        productId: row.productId,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
    );
  }

  async unreadCount(accountId: string): Promise<number> {
    return this.prisma.db.customerNotification.count({ where: { accountId, readAt: null } });
  }

  /** Marks the given entries (or all of them) read. Someone else's ids match nothing. */
  async markRead(accountId: string, ids?: string[]): Promise<number> {
    const result = await this.prisma.db.customerNotification.updateMany({
      where: { accountId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  /** Who may receive marketing from this restaurant. */
  private marketingAudience() {
    return {
      deletedAt: null,
      isBlocked: false,
      account: { marketingOptIn: true, deletedAt: null },
    };
  }

  private async deliver(params: {
    tenantId: string;
    accountId: string;
    rendered: RenderedNotification;
    orderId?: string | null;
    productId?: string | null;
    restaurant: { name: string; slug: string } | null;
    telegramChatId: string | null;
    link: DeepLink;
    requestId: string | null;
  }): Promise<void> {
    const { rendered } = params;

    const row = await this.prisma.db.customerNotification.create({
      data: {
        accountId: params.accountId,
        tenantId: params.tenantId,
        type: rendered.type,
        category: rendered.category,
        title: rendered.title,
        body: rendered.body,
        orderId: params.orderId ?? null,
        productId: params.productId ?? null,
      },
      select: { id: true },
    });

    if (!params.telegramChatId) return;

    // The restaurant-wide bot: the one the customer opened the Mini App from.
    const botToken = await this.telegram.resolveBotToken(params.tenantId, null);
    if (!botToken) return;

    const deliveryId = await this.notifications.dispatch({
      tenantId: params.tenantId,
      channel: NotificationChannel.TELEGRAM,
      recipient: params.telegramChatId,
      text: renderTelegramText(rendered, params.restaurant?.name ?? null),
      template: `customer.${rendered.type.toLowerCase()}`,
      event: rendered.type,
      botToken,
      requestId: params.requestId,
      entity: { type: 'CustomerNotification', id: row.id },
      silent: rendered.silent,
      replyMarkup: this.openButton(params.restaurant?.slug ?? null, params.link, 'Buyurtmani ochish'),
    });

    if (deliveryId) await this.linkDelivery(row.id, deliveryId);
  }

  private async linkDelivery(notificationId: string, deliveryId: string): Promise<void> {
    await this.prisma.db.customerNotification
      .update({ where: { id: notificationId }, data: { deliveryId } })
      .catch(() => undefined);
  }

  /**
   * An inline button opening the Mini App on the right screen.
   *
   * Dropped without TLS for the reason the bot's own keyboard is: Telegram
   * refuses the whole message over one non-HTTPS `web_app` URL.
   */
  private openButton(slug: string | null, link: DeepLink, label: string): unknown {
    const base = this.config.telegram.miniAppUrl;
    if (!slug || !base.startsWith('https://')) return undefined;

    const url = new URL(miniAppUrlFor(base, slug));
    if (link.order) url.searchParams.set('order', link.order);
    if (link.product) url.searchParams.set('product', link.product);

    return { inline_keyboard: [[{ text: label, web_app: { url: url.toString() } }]] };
  }
}
