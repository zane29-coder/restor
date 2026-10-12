/**
 * What staff read instead of enum codes ("WAITING_COURIER").
 *
 * One table per enum, shared by every screen, so an order is "Kuryer
 * kutilmoqda" on the dashboard and on the orders board alike.
 */

/** System role codes as carried in the token. Custom roles show their own name. */
export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Kompaniya rahbari',
  COMPANY_ADMIN: 'Administrator',
  BRANCH_MANAGER: 'Filial menejeri',
  CASHIER: 'Kassir',
  KITCHEN: 'Oshxona',
  COURIER: 'Kuryer',
  FINANCE: 'Moliya',
  OPERATOR: 'Operator',
  MARKETING: 'Marketing',
  SUPPORT: 'Qoʻllab-quvvatlash',
};

export const STATUS_LABELS: Record<string, string> = {
  NEW: 'Yangi',
  ACCEPTED: 'Qabul qilindi',
  PREPARING: 'Tayyorlanmoqda',
  READY: 'Tayyor',
  WAITING_COURIER: 'Kuryer kutilmoqda',
  COURIER_ASSIGNED: 'Kuryer biriktirildi',
  ON_DELIVERY: 'Yoʻlda',
  DELIVERED: 'Topshirildi',
  CANCELLED: 'Bekor qilindi',
  REFUNDED: 'Qaytarildi',
};

/** Tone classes from `styles.css` for each order status. */
export const STATUS_TONES: Record<string, string> = {
  NEW: 'tone-info',
  ACCEPTED: 'tone-violet',
  PREPARING: 'tone-warning',
  READY: 'tone-success',
  WAITING_COURIER: 'tone-primary',
  COURIER_ASSIGNED: 'tone-primary',
  ON_DELIVERY: 'tone-info',
  DELIVERED: 'tone-success',
  CANCELLED: 'tone-danger',
  REFUNDED: 'tone-neutral',
};

export const ORDER_TYPE_LABELS: Record<string, string> = {
  DELIVERY: 'Yetkazish',
  PICKUP: 'Olib ketish',
  DINE_IN: 'Zalda',
  TABLE: 'Stol (QR)',
};

export const SOURCE_LABELS: Record<string, string> = {
  TELEGRAM_MINI_APP: 'Telegram Mini App',
  TELEGRAM_BOT: 'Telegram bot',
  WEB: 'Sayt',
  POS: 'Kassa (POS)',
  QR_TABLE: 'QR stol',
  CALL_CENTER: 'Call-markaz',
  ADMIN: 'Admin panel',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Naqd',
  CARD: 'Karta',
  TERMINAL: 'Terminal',
  CLICK: 'Click',
  PAYME: 'Payme',
  QR: 'QR toʻlov',
  BONUS: 'Bonus ball',
  SUBO: 'Onlayn (Subo)',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Toʻlanmagan',
  PARTIALLY_PAID: 'Qisman toʻlangan',
  PAID: 'Toʻlangan',
  REFUNDED: 'Qaytarilgan',
  PARTIALLY_REFUNDED: 'Qisman qaytarilgan',
};

export const PAYMENT_STATUS_TONES: Record<string, string> = {
  UNPAID: 'tone-warning',
  PARTIALLY_PAID: 'tone-warning',
  PAID: 'tone-success',
  REFUNDED: 'tone-neutral',
  PARTIALLY_REFUNDED: 'tone-neutral',
};

export const COURIER_STATUS_LABELS: Record<string, string> = {
  OFFLINE: 'Smenada emas',
  AVAILABLE: 'Boʻsh',
  ON_DELIVERY: 'Yoʻlda',
  BREAK: 'Tanaffusda',
};

export const COURIER_STATUS_TONES: Record<string, string> = {
  OFFLINE: 'tone-neutral',
  AVAILABLE: 'tone-success',
  ON_DELIVERY: 'tone-info',
  BREAK: 'tone-warning',
};

export const VEHICLE_LABELS: Record<string, string> = {
  FOOT: 'Piyoda',
  BICYCLE: 'Velosiped',
  SCOOTER: 'Skuter',
  MOTORCYCLE: 'Mototsikl',
  CAR: 'Avtomobil',
};

export const STOCK_UNIT_LABELS: Record<string, string> = {
  KG: 'kg',
  G: 'g',
  L: 'l',
  ML: 'ml',
  PCS: 'dona',
};

export const WEEKDAY_SHORT: Record<number, string> = {
  1: 'Du',
  2: 'Se',
  3: 'Ch',
  4: 'Pa',
  5: 'Ju',
  6: 'Sh',
  7: 'Ya',
};
