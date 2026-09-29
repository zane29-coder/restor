import {
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  TelegramEvent,
  type OrderCreatedPayload,
  type OrderStatusChangedPayload,
  type PaymentReceivedPayload,
} from '@restor/shared-types';
import { escapeHtml, formatMoney, formatPhone } from '@restor/shared-utils';

/**
 * Telegram message templates (TZ §16).
 *
 * HTML parse mode rather than MarkdownV2: MarkdownV2 requires escaping
 * eighteen characters, and an order comment or a customer name is
 * attacker-controlled text. One unescaped `_` in "Umid_" would break the whole
 * message — with HTML there are only three characters to escape, and
 * `escapeHtml` handles them.
 *
 * Every interpolated value passes through `escapeHtml`. That is the only rule
 * that matters here.
 */

const ORDER_TYPE_LABELS: Record<string, string> = {
  [OrderType.DELIVERY]: 'Yetkazib berish',
  [OrderType.PICKUP]: 'Olib ketish',
  [OrderType.DINE_IN]: 'Zalda',
  [OrderType.TABLE]: 'Stol (QR)',
};

const SOURCE_LABELS: Record<string, string> = {
  [OrderSource.TELEGRAM_MINI_APP]: 'Telegram Mini App',
  [OrderSource.TELEGRAM_BOT]: 'Telegram bot',
  [OrderSource.WEB]: 'Sayt',
  [OrderSource.POS]: 'POS',
  [OrderSource.QR_TABLE]: 'QR stol',
  [OrderSource.CALL_CENTER]: 'Call-markaz',
  [OrderSource.ADMIN]: 'Admin panel',
};

const STATUS_LABELS: Record<string, string> = {
  [OrderStatus.NEW]: 'Yangi',
  [OrderStatus.ACCEPTED]: 'Qabul qilindi',
  [OrderStatus.PREPARING]: 'Tayyorlanmoqda',
  [OrderStatus.READY]: 'Tayyor',
  [OrderStatus.WAITING_COURIER]: 'Kuryer kutilmoqda',
  [OrderStatus.COURIER_ASSIGNED]: 'Kuryer biriktirildi',
  [OrderStatus.ON_DELIVERY]: 'Yoʻlda',
  [OrderStatus.DELIVERED]: 'Yetkazildi',
  [OrderStatus.CANCELLED]: 'Bekor qilindi',
  [OrderStatus.REFUNDED]: 'Qaytarildi',
};

const PAYMENT_LABELS: Record<string, string> = {
  [PaymentMethod.CASH]: 'Naqd',
  [PaymentMethod.CARD]: 'Karta',
  [PaymentMethod.TERMINAL]: 'Terminal',
  [PaymentMethod.CLICK]: 'Click',
  [PaymentMethod.PAYME]: 'Payme',
  [PaymentMethod.QR]: 'QR',
  [PaymentMethod.BONUS]: 'Bonus',
};

/** Extra context the event payload does not carry but the message needs. */
export interface OrderMessageContext {
  branchName?: string | null;
  address?: string | null;
  comment?: string | null;
  paymentLabel?: string | null;
  paymentStatus?: string | null;
  subtotal?: number;
  deliveryFee?: number;
  discountTotal?: number;
  tableNumber?: string | null;
}

/**
 * New-order notification.
 *
 * Laid out so the two things a kitchen actually reads — the number and the
 * items — are scannable without opening the message.
 */
export function buildNewOrderMessage(
  payload: OrderCreatedPayload,
  context: OrderMessageContext = {},
): string {
  const lines: string[] = [];

  lines.push(`<b>YANGI BUYURTMA ${escapeHtml(payload.displayNumber)}</b>`);
  lines.push('');

  if (context.branchName) {
    lines.push(`<b>Filial:</b> ${escapeHtml(context.branchName)}`);
  }
  lines.push(`<b>Turi:</b> ${ORDER_TYPE_LABELS[payload.type] ?? payload.type}`);
  if (context.tableNumber) {
    lines.push(`<b>Stol:</b> ${escapeHtml(context.tableNumber)}`);
  }

  if (payload.customerName || payload.customerPhone) {
    lines.push('');
    if (payload.customerName) {
      lines.push(`<b>Mijoz:</b> ${escapeHtml(payload.customerName)}`);
    }
    if (payload.customerPhone) {
      // Rendered as a tel: link so a dispatcher can call with one tap.
      const formatted = escapeHtml(formatPhone(payload.customerPhone));
      lines.push(`<b>Tel:</b> <a href="tel:${escapeHtml(payload.customerPhone)}">${formatted}</a>`);
    }
  }

  if (context.address) {
    lines.push(`<b>Manzil:</b> ${escapeHtml(context.address)}`);
  }

  lines.push('');
  lines.push('<b>Tarkibi:</b>');
  for (const item of payload.itemsSummary) {
    lines.push(`• ${item.quantity} × ${escapeHtml(item.name)}`);
  }

  lines.push('');
  if (context.subtotal !== undefined && context.subtotal !== payload.total) {
    lines.push(`Mahsulotlar: ${formatMoney(context.subtotal)}`);
    if (context.discountTotal) {
      lines.push(`Chegirma: −${formatMoney(context.discountTotal)}`);
    }
    if (context.deliveryFee) {
      lines.push(`Yetkazish: ${formatMoney(context.deliveryFee)}`);
    }
  }
  lines.push(`<b>JAMI: ${formatMoney(payload.total)}</b>`);

  if (context.paymentLabel) {
    lines.push('');
    lines.push(
      `<b>Toʻlov:</b> ${escapeHtml(context.paymentLabel)}` +
        (context.paymentStatus ? ` · ${escapeHtml(context.paymentStatus)}` : ''),
    );
  }

  if (context.comment) {
    lines.push('');
    lines.push(`<b>Izoh:</b> ${escapeHtml(context.comment)}`);
  }

  lines.push('');
  lines.push(
    `<i>${SOURCE_LABELS[payload.source] ?? payload.source} · ${formatTime(payload.occurredAt)}</i>`,
  );

  return lines.join('\n');
}

/** Status change. Short on purpose — it is a follow-up, not the whole order. */
export function buildStatusMessage(
  payload: OrderStatusChangedPayload,
  context: OrderMessageContext = {},
): string {
  const to = STATUS_LABELS[payload.toStatus] ?? payload.toStatus;
  const from = payload.fromStatus ? STATUS_LABELS[payload.fromStatus] : null;

  const lines = [`<b>${escapeHtml(payload.displayNumber)}</b> — ${escapeHtml(to)}`];

  if (from) lines.push(`<i>${escapeHtml(from)} → ${escapeHtml(to)}</i>`);
  if (context.branchName) lines.push(`Filial: ${escapeHtml(context.branchName)}`);
  if (payload.comment) lines.push(`Izoh: ${escapeHtml(payload.comment)}`);

  lines.push(`<i>${formatTime(payload.occurredAt)}</i>`);
  return lines.join('\n');
}

export function buildPaymentMessage(
  payload: PaymentReceivedPayload,
  context: OrderMessageContext = {},
): string {
  const lines = [
    `<b>TOʻLOV QABUL QILINDI</b>`,
    '',
    `Buyurtma: <b>${escapeHtml(payload.displayNumber)}</b>`,
    `Summa: <b>${formatMoney(payload.amount)}</b>`,
    `Usul: ${PAYMENT_LABELS[payload.method] ?? payload.method}`,
  ];

  if (context.branchName) lines.push(`Filial: ${escapeHtml(context.branchName)}`);
  lines.push(payload.isFullyPaid ? 'Holati: <b>Toʻliq toʻlangan</b>' : 'Holati: Qisman toʻlangan');
  lines.push('');
  lines.push(`<i>${formatTime(payload.occurredAt)}</i>`);

  return lines.join('\n');
}

/** The probe sent by the "test this route" button in admin settings. */
export function buildTestMessage(event: TelegramEvent, branchName?: string | null): string {
  return [
    '<b>RESTOR — sinov xabari</b>',
    '',
    `Hodisa: <code>${escapeHtml(event)}</code>`,
    branchName ? `Filial: ${escapeHtml(branchName)}` : null,
    '',
    '<i>Ushbu xabarni koʻrgan boʻlsangiz, marshrut toʻgʻri sozlangan.</i>',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** Maps a domain event to the template that renders it. */
export const EVENT_TEMPLATES: Record<string, string> = {
  [TelegramEvent.NEW_ORDER]: 'order.new',
  [TelegramEvent.ORDER_ACCEPTED]: 'order.status',
  [TelegramEvent.ORDER_CANCELLED]: 'order.status',
  [TelegramEvent.KITCHEN_READY]: 'order.status',
  [TelegramEvent.ORDER_DELIVERED]: 'order.status',
  [TelegramEvent.COURIER_ASSIGNED]: 'order.status',
  [TelegramEvent.PAYMENT_RECEIVED]: 'payment.received',
  [TelegramEvent.PAYMENT_FAILED]: 'payment.received',
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso));
}
