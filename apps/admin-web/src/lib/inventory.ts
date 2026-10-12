import { StockMovementType, SupplierOrderStatus, type StockItem } from '@restor/shared-types';
import { qty } from './format';
import { STOCK_UNIT_LABELS } from './labels';

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  RECEIPT: 'Kirim',
  CONSUMPTION: 'Sotuvga sarf',
  WASTE: 'Hisobdan chiqarish',
  ADJUSTMENT: 'Tuzatish',
  TRANSFER_OUT: 'Koʻchirish (chiqim)',
  TRANSFER_IN: 'Koʻchirish (kirim)',
};

export const MOVEMENT_TONES: Record<StockMovementType, string> = {
  RECEIPT: 'tone-success',
  CONSUMPTION: 'tone-neutral',
  WASTE: 'tone-danger',
  ADJUSTMENT: 'tone-warning',
  TRANSFER_OUT: 'tone-info',
  TRANSFER_IN: 'tone-info',
};

export const ORDER_STATUS_LABELS: Record<SupplierOrderStatus, string> = {
  SENT: 'Yuborilgan',
  RECEIVED: 'Qabul qilingan',
  CANCELLED: 'Bekor qilingan',
};

export const ORDER_STATUS_TONES: Record<SupplierOrderStatus, string> = {
  SENT: 'tone-info',
  RECEIVED: 'tone-success',
  CANCELLED: 'tone-neutral',
};

export const unitOf = (unit: string) => STOCK_UNIT_LABELS[unit] ?? unit;

/** `14,2 kg`. */
export const amountOf = (value: string | null | undefined, unit: string) => `${qty(value)} ${unitOf(unit)}`;

export type StockLevel = 'critical' | 'low' | 'ok';

/**
 * How worried to be about an item. "Critical" is at or under half the reorder
 * threshold — the point where a dish is about to come off the menu — "low"
 * is at or under the threshold itself.
 */
export function levelOf(item: Pick<StockItem, 'quantity' | 'minQuantity'>): StockLevel {
  if (item.minQuantity === null) return 'ok';
  const q = Number(item.quantity);
  const min = Number(item.minQuantity);
  if (q <= min / 2) return 'critical';
  if (q <= min) return 'low';
  return 'ok';
}

export const LEVEL_LABELS: Record<StockLevel, string> = {
  critical: 'Shoshilinch buyurtma',
  low: 'Kam qolmoqda',
  ok: 'Yetarli',
};

export const LEVEL_TONES: Record<StockLevel, string> = {
  critical: 'tone-danger',
  low: 'tone-warning',
  ok: 'tone-success',
};

/** A decimal typed with a comma or a dot, as a number; NaN when it is not one. */
export function parseQty(value: string): number {
  return Number(value.replace(/\s/g, '').replace(',', '.'));
}

/** Local `YYYY-MM-DD` → the end of that day, the moment a use-by date ends. */
export function endOfDayIso(day: string): string | null {
  return day ? new Date(`${day}T23:59:59`).toISOString() : null;
}

export function daysLeftLabel(days: number): string {
  if (days < 0) return `${-days} kun oʻtdi`;
  if (days === 0) return 'Bugun tugaydi';
  return `${days} kun qoldi`;
}
