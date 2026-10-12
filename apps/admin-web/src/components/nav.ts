import type { ComponentType } from 'react';
import { Permission } from '@restor/shared-types';
import {
  IconBadge,
  IconBox,
  IconBranch,
  IconChart,
  IconCourier,
  IconDashboard,
  IconMenu,
  IconOrders,
  IconTable,
  IconTag,
  IconTelegram,
  IconUsers,
  type IconProps,
} from '@restor/ui';

export type NavBadgeKey = 'orders' | 'couriers' | 'inventory' | 'tables';

export interface NavItem {
  to: string;
  label: string;
  /** Shown in the breadcrumb and the command palette. */
  title: string;
  Icon: ComponentType<IconProps>;
  /** Hidden unless the user holds this permission (TZ §5). */
  permission?: Permission;
  badge?: NavBadgeKey;
  /** Extra words the command palette matches on. */
  keywords?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The restaurant panel's navigation.
 *
 * One table drives the sidebar, the breadcrumbs and the command palette, so a
 * page added here shows up in all three — and a permission set here hides it
 * from all three.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Asosiy',
    items: [
      { to: '/', label: 'Dashboard', title: 'Boshqaruv markazi', Icon: IconDashboard },
      {
        to: '/orders',
        label: 'Buyurtmalar',
        title: 'Buyurtmalar',
        Icon: IconOrders,
        permission: Permission.ORDERS_VIEW,
        badge: 'orders',
        keywords: 'zakaz dispatch',
      },
      {
        to: '/menu',
        label: 'Menyu',
        title: 'Menyu',
        Icon: IconMenu,
        permission: Permission.PRODUCTS_VIEW,
        keywords: 'taom mahsulot kategoriya stop-list',
      },
    ],
  },
  {
    label: 'Boshqaruv',
    items: [
      {
        to: '/branches',
        label: 'Filiallar',
        title: 'Filiallar',
        Icon: IconBranch,
        permission: Permission.BRANCHES_VIEW,
        keywords: 'filial zona ish vaqti',
      },
      {
        to: '/employees',
        label: 'Xodimlar',
        title: 'Xodimlar',
        Icon: IconBadge,
        permission: Permission.EMPLOYEES_VIEW,
        keywords: 'xodim rol huquq',
      },
      {
        to: '/couriers',
        label: 'Kuryerlar',
        title: 'Kuryerlar va dispetcher',
        Icon: IconCourier,
        permission: Permission.COURIERS_VIEW,
        badge: 'couriers',
        keywords: 'dispatch inkassatsiya yetkazish',
      },
      {
        to: '/customers',
        label: 'Mijozlar CRM',
        title: 'Mijozlar va sodiqlik',
        Icon: IconUsers,
        permission: Permission.CUSTOMERS_VIEW,
        keywords: 'mijoz sodiqlik ball keshbek',
      },
      {
        to: '/marketing',
        label: 'Aksiyalar',
        title: 'Aksiyalar va promokodlar',
        Icon: IconTag,
        permission: Permission.PROMOTIONS_VIEW,
        keywords: 'promokod chegirma',
      },
      {
        to: '/tables',
        label: 'Stollar va QR',
        title: 'Stollar va QR xizmat',
        Icon: IconTable,
        permission: Permission.TABLES_VIEW,
        badge: 'tables',
        keywords: 'stol qr bron zal',
      },
    ],
  },
  {
    label: 'Tizim va moliya',
    items: [
      {
        to: '/inventory',
        label: 'Ombor va taʼminot',
        title: 'Ombor va taʼminot',
        Icon: IconBox,
        permission: Permission.INVENTORY_VIEW,
        badge: 'inventory',
        keywords: 'ombor xomashyo taminotchi retsept',
      },
      {
        to: '/reports',
        label: 'Hisobotlar',
        title: 'Hisobotlar',
        Icon: IconChart,
        permission: Permission.REPORTS_VIEW,
        keywords: 'hisobot moliya kassa abc',
      },
      {
        to: '/telegram',
        label: 'Telegram bot',
        title: 'Telegram bot',
        Icon: IconTelegram,
        permission: Permission.TELEGRAM_VIEW,
        keywords: 'bot guruh mini app',
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) =>
    item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
}
