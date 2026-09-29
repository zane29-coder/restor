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
 * ---------------------------------------------------------------------------
 * WHY EMOJI HERE, AND NOT IN THE UI
 *
 * The web apps use drawn SVG icons: they inherit `currentColor`, render
 * identically everywhere, and sit in a design system.
 *
 * Telegram has none of that — no CSS, no icons, no colour, and only <b>, <i>
 * and <code> for emphasis. Emoji are its native visual vocabulary, and a
 * notification without them is a wall of text that nobody scans at a glance
 * during a lunch rush.
 *
 * The rule applied below: one emoji per line AT MOST, always as a field
 * marker or a status signal, never as decoration. The same concept always
 * gets the same emoji, so staff learn to read the shape rather than the words.
 * ---------------------------------------------------------------------------
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

/** Order type — the emoji says how the food leaves the building. */
const ORDER_TYPES: Record<string, { emoji: string; label: string }> = {
  [OrderType.DELIVERY]: { emoji: '🚚', label: 'Yetkazib berish' },
  [OrderType.PICKUP]: { emoji: '🛍', label: 'Olib ketish' },
  [OrderType.DINE_IN]: { emoji: '🍽', label: 'Zalda' },
  [OrderType.TABLE]: { emoji: '🪑', label: 'Stol (QR)' },
};

/** Where the order came from. */
const SOURCES: Record<string, { emoji: string; label: string }> = {
  [OrderSource.TELEGRAM_MINI_APP]: { emoji: '📱', label: 'Telegram Mini App' },
  [OrderSource.TELEGRAM_BOT]: { emoji: '🤖', label: 'Telegram bot' },
  [OrderSource.WEB]: { emoji: '🌐', label: 'Sayt' },
  [OrderSource.POS]: { emoji: '🖥', label: 'POS' },
  [OrderSource.QR_TABLE]: { emoji: '🪑', label: 'QR stol' },
  [OrderSource.CALL_CENTER]: { emoji: '☎️', label: 'Call-markaz' },
  [OrderSource.ADMIN]: { emoji: '⚙️', label: 'Admin panel' },
};

/**
 * Status — the emoji is the whole message at a glance.
 *
 * Green/red carry the two that matter most: ✅ accepted, ❌ cancelled. The
 * rest are literal (🍳 cooking, 🛵 courier) so they need no learning.
 */
const STATUSES: Record<string, { emoji: string; label: string }> = {
  [OrderStatus.NEW]: { emoji: '🆕', label: 'Yangi' },
  [OrderStatus.ACCEPTED]: { emoji: '✅', label: 'Qabul qilindi' },
  [OrderStatus.PREPARING]: { emoji: '🍳', label: 'Tayyorlanmoqda' },
  [OrderStatus.READY]: { emoji: '🔔', label: 'Tayyor' },
  [OrderStatus.WAITING_COURIER]: { emoji: '⏳', label: 'Kuryer kutilmoqda' },
  [OrderStatus.COURIER_ASSIGNED]: { emoji: '🛵', label: 'Kuryer biriktirildi' },
  [OrderStatus.ON_DELIVERY]: { emoji: '🚗', label: 'Yoʻlda' },
  [OrderStatus.DELIVERED]: { emoji: '📦', label: 'Yetkazildi' },
  [OrderStatus.CANCELLED]: { emoji: '❌', label: 'Bekor qilindi' },
  [OrderStatus.REFUNDED]: { emoji: '↩️', label: 'Qaytarildi' },
};

const PAYMENTS: Record<string, { emoji: string; label: string }> = {
  [PaymentMethod.CASH]: { emoji: '💵', label: 'Naqd' },
  [PaymentMethod.CARD]: { emoji: '💳', label: 'Karta' },
  [PaymentMethod.TERMINAL]: { emoji: '💳', label: 'Terminal' },
  [PaymentMethod.CLICK]: { emoji: '📲', label: 'Click' },
  [PaymentMethod.PAYME]: { emoji: '📲', label: 'Payme' },
  [PaymentMethod.QR]: { emoji: '📱', label: 'QR' },
  [PaymentMethod.BONUS]: { emoji: '🎁', label: 'Bonus' },
};

const PAYMENT_STATUSES: Record<string, string> = {
  UNPAID: 'Toʻlanmagan',
  PARTIALLY_PAID: 'Qisman toʻlangan',
  PAID: 'Toʻlangan',
  REFUNDED: 'Qaytarilgan',
  PARTIALLY_REFUNDED: 'Qisman qaytarilgan',
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
  estimatedReadyAt?: string | null;
}

/**
 * New-order notification.
 *
 * Grouped so each reader finds their part without opening the message: the
 * kitchen reads the number and the items, the dispatcher the address and
 * phone, the till the money.
 */
export function buildNewOrderMessage(
  payload: OrderCreatedPayload,
  context: OrderMessageContext = {},
): string {
  const type = ORDER_TYPES[payload.type] ?? { emoji: '📋', label: payload.type };
  const source = SOURCES[payload.source] ?? { emoji: '•', label: payload.source };

  const lines: string[] = [];

  lines.push(`🛒 <b>YANGI BUYURTMA ${escapeHtml(payload.displayNumber)}</b>`);
  lines.push('');

  if (context.branchName) lines.push(`🏪 <b>Filial:</b> ${escapeHtml(context.branchName)}`);
  lines.push(`${type.emoji} <b>Turi:</b> ${type.label}`);
  if (context.tableNumber) lines.push(`🪑 <b>Stol:</b> ${escapeHtml(context.tableNumber)}`);

  if (payload.customerName || payload.customerPhone) {
    lines.push('');
    if (payload.customerName) {
      lines.push(`👤 <b>Mijoz:</b> ${escapeHtml(payload.customerName)}`);
    }
    if (payload.customerPhone) {
      // A tel: link so a dispatcher can call with one tap.
      const shown = escapeHtml(formatPhone(payload.customerPhone));
      lines.push(`📞 <b>Tel:</b> <a href="tel:${escapeHtml(payload.customerPhone)}">${shown}</a>`);
    }
  }

  if (context.address) lines.push(`📍 <b>Manzil:</b> ${escapeHtml(context.address)}`);

  lines.push('');
  lines.push('🧾 <b>Tarkibi:</b>');
  for (const item of payload.itemsSummary) {
    lines.push(`   <b>${item.quantity}</b> × ${escapeHtml(item.name)}`);
  }

  lines.push('');
  // The breakdown is noise when it just repeats the total.
  if (context.subtotal !== undefined && context.subtotal !== payload.total) {
    lines.push(`Mahsulotlar: ${formatMoney(context.subtotal)}`);
    if (context.discountTotal) {
      lines.push(`🎁 Chegirma: −${formatMoney(context.discountTotal)}`);
    }
    if (context.deliveryFee) {
      lines.push(`🚚 Yetkazish: ${formatMoney(context.deliveryFee)}`);
    }
  }
  lines.push(`💰 <b>JAMI: ${formatMoney(payload.total)}</b>`);

  if (context.paymentLabel) {
    const payment = PAYMENTS[context.paymentLabel] ?? {
      emoji: '💳',
      label: context.paymentLabel,
    };
    const status = context.paymentStatus
      ? ` · ${PAYMENT_STATUSES[context.paymentStatus] ?? escapeHtml(context.paymentStatus)}`
      : '';
    lines.push('');
    lines.push(`${payment.emoji} <b>Toʻlov:</b> ${escapeHtml(payment.label)}${status}`);
  }

  if (context.comment) {
    lines.push('');
    lines.push(`📝 <b>Izoh:</b> ${escapeHtml(context.comment)}`);
  }

  if (context.estimatedReadyAt) {
    lines.push(`⏰ <b>Tayyor boʻladi:</b> ${formatTime(context.estimatedReadyAt, false)}`);
  }

  lines.push('');
  lines.push(`<i>${source.emoji} ${source.label} · ${formatTime(payload.occurredAt)}</i>`);

  return lines.join('\n');
}

/**
 * Status change. Short on purpose — a follow-up, not the whole order again.
 * The leading emoji is what makes it readable in a scrolling group.
 */
export function buildStatusMessage(
  payload: OrderStatusChangedPayload,
  context: OrderMessageContext = {},
): string {
  const to = STATUSES[payload.toStatus] ?? { emoji: '•', label: payload.toStatus };
  const from = payload.fromStatus ? STATUSES[payload.fromStatus] : null;

  const lines = [
    `${to.emoji} <b>${escapeHtml(payload.displayNumber)}</b> — ${escapeHtml(to.label)}`,
  ];

  if (from) lines.push(`<i>${escapeHtml(from.label)} → ${escapeHtml(to.label)}</i>`);
  if (context.branchName) lines.push(`🏪 ${escapeHtml(context.branchName)}`);
  if (payload.comment) lines.push(`📝 ${escapeHtml(payload.comment)}`);

  lines.push(`<i>🕒 ${formatTime(payload.occurredAt)}</i>`);
  return lines.join('\n');
}

export function buildPaymentMessage(
  payload: PaymentReceivedPayload,
  context: OrderMessageContext = {},
): string {
  const payment = PAYMENTS[payload.method] ?? { emoji: '💳', label: payload.method };

  const lines = [
    '💰 <b>TOʻLOV QABUL QILINDI</b>',
    '',
    `🧾 <b>Buyurtma:</b> ${escapeHtml(payload.displayNumber)}`,
    `💵 <b>Summa:</b> ${formatMoney(payload.amount)}`,
    `${payment.emoji} <b>Usul:</b> ${escapeHtml(payment.label)}`,
  ];

  if (context.branchName) lines.push(`🏪 <b>Filial:</b> ${escapeHtml(context.branchName)}`);

  lines.push(
    payload.isFullyPaid
      ? '✅ <b>Holati:</b> Toʻliq toʻlangan'
      : '⏳ <b>Holati:</b> Qisman toʻlangan',
  );
  lines.push('');
  lines.push(`<i>🕒 ${formatTime(payload.occurredAt)}</i>`);

  return lines.join('\n');
}

/** The probe sent by the "test this route" button in admin settings. */
export function buildTestMessage(event: TelegramEvent, branchName?: string | null): string {
  return [
    '🔔 <b>RESTOR — sinov xabari</b>',
    '',
    `📋 Hodisa: <code>${escapeHtml(event)}</code>`,
    branchName ? `🏪 Filial: ${escapeHtml(branchName)}` : null,
    '',
    '<i>✅ Ushbu xabarni koʻrgan boʻlsangiz, marshrut toʻgʻri sozlangan.</i>',
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

/** Formatted in the restaurant's timezone, not the server's. */
function formatTime(iso: string, withDate = true): string {
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit',
    ...(withDate ? { day: '2-digit', month: '2-digit' } : {}),
  }).format(new Date(iso));
}
