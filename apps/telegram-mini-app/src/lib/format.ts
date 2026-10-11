import {
  OrderStatus,
  OrderType,
  PaymentStatus,
  type CheckoutPaymentOption,
  type PromoCodeType,
} from '@restor/shared-types';
import { formatMoney, formatPhone } from '@restor/shared-utils';

/** `54 000 soʻm` — how every price in the storefront is written. */
export function som(amount: number): string {
  return `${formatMoney(amount, 'UZS', { withCurrency: false })} soʻm`;
}

export function phone(e164: string | null | undefined): string {
  return e164 ? formatPhone(e164) : '';
}

/**
 * Formats what a customer types into `+998 90 123 45 67` as they type it.
 * Only the display: the server normalises and validates the number again.
 */
export function formatPhoneInput(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('998')) digits = digits.slice(3);
  digits = digits.slice(0, 9);

  const parts = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)]
    .filter(Boolean)
    .join(' ');
  return parts ? `+998 ${parts}` : '+998 ';
}

/** True when the input holds a full Uzbek mobile number. */
export function isCompletePhone(formatted: string): boolean {
  return formatted.replace(/\D/g, '').length === 12;
}

const TASHKENT = 'Asia/Tashkent';

/** `11.10.2026, 14:35` in the restaurant's clock. */
export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: TASHKENT,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function clock(iso: string): string {
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: TASHKENT,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** "hozir", "5 daq oldin", "2 soat oldin", else the date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'hozir';
  if (minutes < 60) return `${minutes} daq oldin`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  return dateTime(iso);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  [OrderStatus.NEW]: 'Qabul qilinmoqda',
  [OrderStatus.ACCEPTED]: 'Qabul qilindi',
  [OrderStatus.PREPARING]: 'Tayyorlanmoqda',
  [OrderStatus.READY]: 'Tayyor',
  [OrderStatus.WAITING_COURIER]: 'Kuryer kutilmoqda',
  [OrderStatus.COURIER_ASSIGNED]: 'Kuryer biriktirildi',
  [OrderStatus.ON_DELIVERY]: 'Yetkazilmoqda',
  [OrderStatus.DELIVERED]: 'Yakunlandi',
  [OrderStatus.CANCELLED]: 'Bekor qilindi',
  [OrderStatus.REFUNDED]: 'Pul qaytarildi',
};

/** Tone for a status chip — colour is never the only signal; the label is. */
export function statusTone(status: OrderStatus): 'neutral' | 'progress' | 'success' | 'danger' {
  if (status === OrderStatus.CANCELLED || status === OrderStatus.REFUNDED) return 'danger';
  if (status === OrderStatus.DELIVERED) return 'success';
  if (status === OrderStatus.NEW) return 'neutral';
  return 'progress';
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PaymentStatus.UNPAID]: 'Toʻlanmagan',
  [PaymentStatus.PARTIALLY_PAID]: 'Qisman toʻlangan',
  [PaymentStatus.PAID]: 'Toʻlangan',
  [PaymentStatus.REFUNDED]: 'Qaytarilgan',
  [PaymentStatus.PARTIALLY_REFUNDED]: 'Qisman qaytarilgan',
};

export const ORDER_TYPE_LABELS: Partial<Record<OrderType, string>> = {
  [OrderType.DELIVERY]: 'Yetkazib berish',
  [OrderType.PICKUP]: 'Olib ketish',
  [OrderType.DINE_IN]: 'Zalda',
  [OrderType.TABLE]: 'Stolda',
};

export const PAYMENT_OPTION_LABELS: Record<CheckoutPaymentOption, string> = {
  ATMOS: 'Bank kartasi',
  CLICK: 'Click',
  PAYME: 'Payme',
  CASH: 'Naqd pul',
};

/** How an order says it is being paid. */
export function paymentLabel(method: string | null, provider: string | null): string {
  if (method === 'CASH') return 'Naqd pul';
  if (method === 'SUBO') {
    return provider && provider in PAYMENT_OPTION_LABELS
      ? `Onlayn · ${PAYMENT_OPTION_LABELS[provider as CheckoutPaymentOption]}`
      : 'Onlayn';
  }
  return method ? method : '—';
}

/** "10% chegirma", "15 000 soʻm chegirma", "Bepul yetkazib berish". */
export function promoValueLabel(type: PromoCodeType, discount: number, maxDiscount: number | null): string {
  if (type === 'FREE_DELIVERY') return 'Bepul yetkazib berish';
  if (type === 'PERCENTAGE') {
    return maxDiscount ? `${discount}% chegirma (${som(maxDiscount)} gacha)` : `${discount}% chegirma`;
  }
  return `${som(discount)} chegirma`;
}

/** First letters of a name, for an avatar without a photo. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]!.toUpperCase()).join('') || '?';
}

/**
 * Lower-cases and folds the apostrophe variants Uzbek is typed with, so
 * "goʻsht", "go'sht" and "gosht" all find the same dish.
 */
export function searchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ʻʼ'`’‘]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
