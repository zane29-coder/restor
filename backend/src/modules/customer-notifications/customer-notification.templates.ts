import {
  CampaignKind,
  CustomerNotificationType,
  NotificationCategory,
  OrderStatus,
  OrderType,
} from '@restor/shared-types';
import { escapeHtml, formatMoney } from '@restor/shared-utils';

/**
 * What a customer is told, in words (TZ 48).
 *
 * Rendered ONCE per event. The same title and body are stored in the
 * customer's inbox and sent through the restaurant's bot, which is the whole
 * point: the Mini App and Telegram can never disagree about an order, because
 * there is only one sentence.
 *
 * The inbox text carries no emoji — the Mini App draws its own icons. The
 * Telegram copy adds one leading marker per message, the same deliberate
 * exception `message.builder.ts` makes for staff groups.
 */

export interface RenderedNotification {
  type: CustomerNotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  /** Delivered without a sound: things the customer is not waiting on. */
  silent: boolean;
}

export interface OrderNotificationContext {
  displayNumber: string;
  orderType: OrderType;
  total: number;
  /** ISO; shown as a time when the restaurant accepts. */
  estimatedReadyAt?: string | null;
  cancelReason?: string | null;
  /** For payment messages. */
  amount?: number;
}

/** Which order statuses a customer hears about. The rest are internal steps. */
export function notificationTypeForStatus(status: OrderStatus): CustomerNotificationType | null {
  switch (status) {
    case OrderStatus.ACCEPTED:
      return CustomerNotificationType.ORDER_ACCEPTED;
    case OrderStatus.PREPARING:
      return CustomerNotificationType.ORDER_PREPARING;
    case OrderStatus.READY:
      return CustomerNotificationType.ORDER_READY;
    case OrderStatus.ON_DELIVERY:
      return CustomerNotificationType.ORDER_ON_DELIVERY;
    case OrderStatus.DELIVERED:
      return CustomerNotificationType.ORDER_DELIVERED;
    case OrderStatus.CANCELLED:
      return CustomerNotificationType.ORDER_CANCELLED;
    // Courier hand-offs and refunds are staff business; a customer told
    // "waiting for courier" then "courier assigned" learns nothing useful.
    default:
      return null;
  }
}

/** The customer-facing sentence for an order event. */
export function renderOrderNotification(
  type: CustomerNotificationType,
  context: OrderNotificationContext,
): RenderedNotification {
  const number = context.displayNumber;
  const transactional = (title: string, body: string, silent = false): RenderedNotification => ({
    type,
    category: NotificationCategory.TRANSACTIONAL,
    title,
    body,
    silent,
  });

  switch (type) {
    case CustomerNotificationType.ORDER_RECEIVED:
      return transactional(
        'Buyurtma yuborildi',
        `${number} buyurtmangiz restoranga yuborildi. Tasdiqlanishini kuting.`,
        true,
      );

    case CustomerNotificationType.ORDER_ACCEPTED: {
      const eta = context.estimatedReadyAt ? formatClock(context.estimatedReadyAt) : null;
      return transactional(
        'Buyurtma qabul qilindi',
        eta
          ? `${number} buyurtmangizni restoran qabul qildi. Taxminan ${eta} da tayyor boʻladi.`
          : `${number} buyurtmangizni restoran qabul qildi.`,
      );
    }

    case CustomerNotificationType.ORDER_PREPARING:
      return transactional('Buyurtma tayyorlanmoqda', `${number} buyurtmangiz tayyorlanmoqda.`, true);

    case CustomerNotificationType.ORDER_READY:
      return transactional(
        'Buyurtma tayyor',
        context.orderType === OrderType.DELIVERY
          ? `${number} buyurtmangiz tayyor va kuryerga topshirilmoqda.`
          : context.orderType === OrderType.PICKUP
            ? `${number} buyurtmangiz tayyor — olib ketishingiz mumkin.`
            : `${number} buyurtmangiz tayyor.`,
      );

    case CustomerNotificationType.ORDER_ON_DELIVERY:
      return transactional('Buyurtma yoʻlda', `Kuryer ${number} buyurtmangizni olib kelmoqda.`);

    case CustomerNotificationType.ORDER_DELIVERED:
      return transactional(
        context.orderType === OrderType.DELIVERY ? 'Buyurtma yetkazildi' : 'Buyurtma topshirildi',
        `${number} buyurtmangiz ${
          context.orderType === OrderType.DELIVERY ? 'yetkazildi' : 'topshirildi'
        }. Yoqimli ishtaha!`,
      );

    case CustomerNotificationType.ORDER_CANCELLED: {
      const reason = context.cancelReason?.trim();
      return transactional(
        'Buyurtma bekor qilindi',
        reason ? `${number} buyurtmangiz bekor qilindi. Sabab: ${reason}` : `${number} buyurtmangiz bekor qilindi.`,
      );
    }

    case CustomerNotificationType.PAYMENT_RECEIVED:
      return transactional(
        'Toʻlov qabul qilindi',
        `${number} buyurtma uchun ${formatSom(context.amount ?? context.total)} toʻlandi.`,
      );

    case CustomerNotificationType.PAYMENT_FAILED:
      return transactional(
        'Toʻlov amalga oshmadi',
        `${number} buyurtma uchun toʻlov oʻtmadi. Buyurtma sahifasidan qayta urinib koʻrishingiz mumkin.`,
      );

    default:
      return transactional('Buyurtma', `${number} buyurtmangiz holati oʻzgardi.`);
  }
}

/** Campaign kind → inbox type. */
export function notificationTypeForCampaign(kind: CampaignKind): CustomerNotificationType {
  switch (kind) {
    case CampaignKind.NEW_PRODUCT:
      return CustomerNotificationType.NEW_PRODUCT;
    case CampaignKind.PROMO_CODE:
      return CustomerNotificationType.PROMO_CODE;
    case CampaignKind.PROMOTION:
      return CustomerNotificationType.PROMOTION;
    default:
      return CustomerNotificationType.SERVICE;
  }
}

const TELEGRAM_MARKERS: Record<CustomerNotificationType, string> = {
  ORDER_RECEIVED: '🧾',
  ORDER_ACCEPTED: '✅',
  ORDER_PREPARING: '🍳',
  ORDER_READY: '🔔',
  ORDER_ON_DELIVERY: '🛵',
  ORDER_DELIVERED: '📦',
  ORDER_CANCELLED: '❌',
  PAYMENT_RECEIVED: '💳',
  PAYMENT_FAILED: '⚠️',
  NEW_PRODUCT: '🆕',
  PROMOTION: '🎁',
  PROMO_CODE: '🏷',
  SERVICE: 'ℹ️',
};

/**
 * The Telegram copy of an inbox entry: the same title and body, escaped, with
 * the restaurant's name so a customer who orders from several knows which
 * one is talking. Marketing carries the way out, because consent that cannot
 * be withdrawn is not consent.
 */
export function renderTelegramText(
  notification: Pick<RenderedNotification, 'type' | 'category' | 'title' | 'body'>,
  restaurantName: string | null,
): string {
  const lines = [
    `${TELEGRAM_MARKERS[notification.type] ?? '•'} <b>${escapeHtml(notification.title)}</b>`,
    escapeHtml(notification.body),
  ];

  if (restaurantName) {
    lines.push('', `<i>${escapeHtml(restaurantName)}</i>`);
  }

  if (notification.category === NotificationCategory.MARKETING) {
    lines.push(
      '',
      '<i>Bunday xabarlarni Mini App → Profil → Sozlamalar boʻlimida oʻchirishingiz mumkin.</i>',
    );
  }

  return lines.join('\n');
}

/** `54 000 soʻm` — how the storefront writes money. */
export function formatSom(amount: number): string {
  return `${formatMoney(amount, 'UZS', { withCurrency: false })} soʻm`;
}

/** `14:35` in Tashkent time — the restaurant's clock, not the server's. */
function formatClock(iso: string): string {
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
