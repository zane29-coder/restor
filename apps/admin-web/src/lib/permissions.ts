import { PERMISSION_GROUPS, Permission } from '@restor/shared-types';

/**
 * Uzbek names for the permission catalogue, for the roles matrix and the
 * staff panel. The codes stay what the API enforces; only the reading
 * changes. The Platform group is left out: a restaurant role can never hold
 * it, the sync script strips it from custom roles.
 */
export const GROUP_LABELS: Record<string, string> = {
  Company: 'Kompaniya sozlamalari',
  Branches: 'Filiallar',
  Staff: 'Xodimlar va rollar',
  Menu: 'Menyu',
  Orders: 'Buyurtmalar',
  Kitchen: 'Oshxona (KDS)',
  'POS & Cash': 'Kassa va toʻlovlar',
  Delivery: 'Yetkazib berish',
  Customers: 'Mijozlar',
  Marketing: 'Marketing va sodiqlik',
  Tables: 'Stollar',
  Inventory: 'Ombor',
  Telegram: 'Telegram',
  Finance: 'Moliya va hisobotlar',
  Audit: 'Audit jurnali',
};

export const TENANT_GROUPS = Object.entries(PERMISSION_GROUPS).filter(([group]) => group !== 'Platform');

const SPECIFIC: Partial<Record<Permission, string>> = {
  [Permission.SETTINGS_VIEW]: 'Sozlamalarni koʻrish',
  [Permission.SETTINGS_UPDATE]: 'Sozlamalarni oʻzgartirish',
  [Permission.BRANDING_UPDATE]: 'Brend (logo, rang)',
  [Permission.PERMISSIONS_VIEW]: 'Ruxsatlar katalogini koʻrish',
  [Permission.PERMISSIONS_ASSIGN]: 'Xodimga rol biriktirish',
  [Permission.PRODUCTS_PRICE_UPDATE]: 'Narxlarni oʻzgartirish',
  [Permission.PRODUCTS_AVAILABILITY_UPDATE]: 'Stop-list',
  [Permission.MODIFIERS_VIEW]: 'Qoʻshimchalarni koʻrish',
  [Permission.MODIFIERS_MANAGE]: 'Qoʻshimchalarni boshqarish',
  [Permission.ORDERS_VIEW_ALL_BRANCHES]: 'Barcha filiallar buyurtmalari',
  [Permission.ORDERS_CANCEL]: 'Buyurtmani bekor qilish',
  [Permission.ORDERS_REFUND]: 'Pulni qaytarish',
  [Permission.ORDERS_CHANGE_STATUS]: 'Holatini oʻzgartirish',
  [Permission.ORDERS_ASSIGN_COURIER]: 'Kuryer biriktirish',
  [Permission.KITCHEN_UPDATE_STATUS]: 'Taom holatini belgilash',
  [Permission.POS_ACCESS]: 'Kassa (POS) ga kirish',
  [Permission.PAYMENTS_VIEW]: 'Toʻlovlarni koʻrish',
  [Permission.PAYMENTS_RECEIVE]: 'Toʻlov qabul qilish',
  [Permission.PAYMENTS_REFUND]: 'Toʻlovni qaytarish',
  [Permission.CASHBOX_VIEW]: 'Kassani koʻrish',
  [Permission.CASHBOX_OPEN_SHIFT]: 'Smena ochish',
  [Permission.CASHBOX_CLOSE_SHIFT]: 'Smena yopish (Z-hisobot)',
  [Permission.CASHBOX_TRANSACTION]: 'Kassaga kirim/chiqim',
  [Permission.CASHBOX_VIEW_ALL_SHIFTS]: 'Barcha smenalarni koʻrish',
  [Permission.COURIERS_TRACK]: 'Kuryerlarni xaritada kuzatish',
  [Permission.COURIER_WALLET_VIEW]: 'Kuryer hamyonini koʻrish',
  [Permission.COURIER_WALLET_SETTLE]: 'Inkassatsiyani tasdiqlash',
  [Permission.DELIVERIES_VIEW_OWN]: 'Oʻz yetkazmalarini koʻrish',
  [Permission.DELIVERIES_UPDATE_OWN]: 'Oʻz yetkazmalarini yangilash',
  [Permission.CUSTOMERS_EXPORT]: 'Mijozlarni eksport qilish',
  [Permission.PROMOTIONS_VIEW]: 'Aksiyalarni koʻrish',
  [Permission.PROMOTIONS_MANAGE]: 'Aksiyalarni boshqarish',
  [Permission.PROMO_CODES_VIEW]: 'Promokodlarni koʻrish',
  [Permission.PROMO_CODES_MANAGE]: 'Promokodlarni boshqarish',
  [Permission.LOYALTY_VIEW]: 'Sodiqlik dasturini koʻrish',
  [Permission.LOYALTY_MANAGE]: 'Sodiqlik dasturini sozlash',
  [Permission.MARKETING_BROADCAST]: 'Mijozlarga xabar yuborish',
  [Permission.WAITER_CALLS_HANDLE]: 'Ofitsiant chaqiruvlari',
  [Permission.RESERVATIONS_MANAGE]: 'Stol bronlarini qabul qilish',
  [Permission.TELEGRAM_ROUTES_MANAGE]: 'Guruh/hodisa yoʻnalishlari',
  [Permission.FINANCE_VIEW]: 'Moliya (kassa kamomadlari)',
  [Permission.FINANCE_MANAGE]: 'Moliyani boshqarish',
  [Permission.REPORTS_VIEW]: 'Hisobotlarni koʻrish',
  [Permission.REPORTS_EXPORT]: 'Hisobotlarni eksport qilish',
  [Permission.ANALYTICS_VIEW]: 'Analitika',
  [Permission.AUDIT_VIEW]: 'Audit jurnalini koʻrish',
};

const ACTIONS: Record<string, string> = {
  view: 'Koʻrish',
  create: 'Qoʻshish',
  update: 'Tahrirlash',
  delete: 'Oʻchirish',
  manage: 'Boshqarish',
};

const SUBJECTS: Record<string, string> = {
  branches: 'filiallar',
  employees: 'xodimlar',
  roles: 'rollar',
  categories: 'kategoriyalar',
  products: 'taomlar',
  orders: 'buyurtmalar',
  kitchen: 'oshxona',
  couriers: 'kuryerlar',
  customers: 'mijozlar',
  tables: 'stollar',
  inventory: 'ombor',
  telegram: 'Telegram',
};

export function permissionLabel(code: string): string {
  const specific = SPECIFIC[code as Permission];
  if (specific) return specific;
  const [subject = '', action = ''] = code.split('.');
  const verb = ACTIONS[action];
  return verb ? `${verb}: ${SUBJECTS[subject] ?? subject}` : code;
}
