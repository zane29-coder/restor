/**
 * RBAC catalog (TZ §5).
 *
 * Permissions are granular, dot-separated `resource.action` strings. Roles are
 * just named bundles of them: the eleven system roles below are seeded into
 * every tenant, and admins may build custom roles on top of the same catalog
 * (e.g. "Senior Cashier" = orders.view + orders.create + orders.cancel +
 * payments.receive + cashbox.view).
 *
 * The backend authorises against PERMISSIONS ONLY — never against a role name.
 * That way a custom role behaves exactly like a system role, and adding a
 * permission to a role never requires touching a guard.
 */

/* -------------------------------------------------------------------------- */
/* Permission catalog                                                         */
/* -------------------------------------------------------------------------- */

export const Permission = {
  // --- Platform level: super admin only (TZ §6) ---
  TENANTS_VIEW: 'tenants.view',
  TENANTS_CREATE: 'tenants.create',
  TENANTS_UPDATE: 'tenants.update',
  TENANTS_BLOCK: 'tenants.block',
  TENANTS_DELETE: 'tenants.delete',
  SUBSCRIPTIONS_VIEW: 'subscriptions.view',
  SUBSCRIPTIONS_MANAGE: 'subscriptions.manage',
  PLATFORM_ANALYTICS_VIEW: 'platform.analytics.view',

  // --- Company / settings ---
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_UPDATE: 'settings.update',
  BRANDING_UPDATE: 'branding.update',

  // --- Branches (TZ §8) ---
  BRANCHES_VIEW: 'branches.view',
  BRANCHES_CREATE: 'branches.create',
  BRANCHES_UPDATE: 'branches.update',
  BRANCHES_DELETE: 'branches.delete',

  // --- Staff & access control ---
  EMPLOYEES_VIEW: 'employees.view',
  EMPLOYEES_CREATE: 'employees.create',
  EMPLOYEES_UPDATE: 'employees.update',
  EMPLOYEES_DELETE: 'employees.delete',
  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',
  ROLES_DELETE: 'roles.delete',
  PERMISSIONS_VIEW: 'permissions.view',
  PERMISSIONS_ASSIGN: 'permissions.assign',

  // --- Menu (TZ §9) ---
  CATEGORIES_VIEW: 'categories.view',
  CATEGORIES_CREATE: 'categories.create',
  CATEGORIES_UPDATE: 'categories.update',
  CATEGORIES_DELETE: 'categories.delete',
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_UPDATE: 'products.update',
  PRODUCTS_DELETE: 'products.delete',
  /** Separate from products.update: price changes are audited and sensitive. */
  PRODUCTS_PRICE_UPDATE: 'products.price.update',
  /** Toggling stop-list / availability per branch — safe for shift managers. */
  PRODUCTS_AVAILABILITY_UPDATE: 'products.availability.update',
  MODIFIERS_VIEW: 'modifiers.view',
  MODIFIERS_MANAGE: 'modifiers.manage',

  // --- Orders (TZ §12) ---
  ORDERS_VIEW: 'orders.view',
  /** See orders of every branch, not just the ones the user is assigned to. */
  ORDERS_VIEW_ALL_BRANCHES: 'orders.view.all_branches',
  ORDERS_CREATE: 'orders.create',
  ORDERS_UPDATE: 'orders.update',
  ORDERS_CANCEL: 'orders.cancel',
  ORDERS_REFUND: 'orders.refund',
  ORDERS_CHANGE_STATUS: 'orders.change_status',
  ORDERS_ASSIGN_COURIER: 'orders.assign_courier',

  // --- Kitchen (TZ §21) ---
  KITCHEN_VIEW: 'kitchen.view',
  KITCHEN_UPDATE_STATUS: 'kitchen.update_status',

  // --- POS & cash (TZ §17, §19) ---
  POS_ACCESS: 'pos.access',
  PAYMENTS_VIEW: 'payments.view',
  PAYMENTS_RECEIVE: 'payments.receive',
  PAYMENTS_REFUND: 'payments.refund',
  CASHBOX_VIEW: 'cashbox.view',
  CASHBOX_OPEN_SHIFT: 'cashbox.open_shift',
  CASHBOX_CLOSE_SHIFT: 'cashbox.close_shift',
  CASHBOX_TRANSACTION: 'cashbox.transaction',
  /** Seeing another cashier's shift totals, not only one's own. */
  CASHBOX_VIEW_ALL_SHIFTS: 'cashbox.view_all_shifts',

  // --- Couriers (TZ §23-§28) ---
  COURIERS_VIEW: 'couriers.view',
  COURIERS_CREATE: 'couriers.create',
  COURIERS_UPDATE: 'couriers.update',
  COURIERS_DELETE: 'couriers.delete',
  COURIERS_TRACK: 'couriers.track',
  COURIER_WALLET_VIEW: 'couriers.wallet.view',
  COURIER_WALLET_SETTLE: 'couriers.wallet.settle',
  /** What the courier app itself needs: read own jobs, move own delivery. */
  DELIVERIES_VIEW_OWN: 'deliveries.view_own',
  DELIVERIES_UPDATE_OWN: 'deliveries.update_own',

  // --- Customers / CRM (TZ §31, §32) ---
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_UPDATE: 'customers.update',
  CUSTOMERS_DELETE: 'customers.delete',
  CUSTOMERS_EXPORT: 'customers.export',

  // --- Marketing (TZ §10, §33, §34) ---
  PROMOTIONS_VIEW: 'promotions.view',
  PROMOTIONS_MANAGE: 'promotions.manage',
  PROMO_CODES_VIEW: 'promo_codes.view',
  PROMO_CODES_MANAGE: 'promo_codes.manage',
  LOYALTY_VIEW: 'loyalty.view',
  LOYALTY_MANAGE: 'loyalty.manage',

  // --- Tables (TZ §29, §30) ---
  TABLES_VIEW: 'tables.view',
  TABLES_MANAGE: 'tables.manage',
  WAITER_CALLS_HANDLE: 'waiter_calls.handle',

  // --- Telegram (TZ §15) ---
  TELEGRAM_VIEW: 'telegram.view',
  TELEGRAM_MANAGE: 'telegram.manage',

  // --- Finance & reporting (TZ §27) ---
  FINANCE_VIEW: 'finance.view',
  FINANCE_MANAGE: 'finance.manage',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  ANALYTICS_VIEW: 'analytics.view',

  // --- Audit (TZ §37) ---
  AUDIT_VIEW: 'audit.view',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

/**
 * Display grouping for the admin "Roles & permissions" screen. The key is the
 * group label; membership is derived from the permission's resource prefix.
 */
export const PERMISSION_GROUPS: Readonly<Record<string, readonly Permission[]>> = {
  Platform: [
    Permission.TENANTS_VIEW,
    Permission.TENANTS_CREATE,
    Permission.TENANTS_UPDATE,
    Permission.TENANTS_BLOCK,
    Permission.TENANTS_DELETE,
    Permission.SUBSCRIPTIONS_VIEW,
    Permission.SUBSCRIPTIONS_MANAGE,
    Permission.PLATFORM_ANALYTICS_VIEW,
  ],
  Company: [
    Permission.SETTINGS_VIEW,
    Permission.SETTINGS_UPDATE,
    Permission.BRANDING_UPDATE,
  ],
  Branches: [
    Permission.BRANCHES_VIEW,
    Permission.BRANCHES_CREATE,
    Permission.BRANCHES_UPDATE,
    Permission.BRANCHES_DELETE,
  ],
  Staff: [
    Permission.EMPLOYEES_VIEW,
    Permission.EMPLOYEES_CREATE,
    Permission.EMPLOYEES_UPDATE,
    Permission.EMPLOYEES_DELETE,
    Permission.ROLES_VIEW,
    Permission.ROLES_CREATE,
    Permission.ROLES_UPDATE,
    Permission.ROLES_DELETE,
    Permission.PERMISSIONS_VIEW,
    Permission.PERMISSIONS_ASSIGN,
  ],
  Menu: [
    Permission.CATEGORIES_VIEW,
    Permission.CATEGORIES_CREATE,
    Permission.CATEGORIES_UPDATE,
    Permission.CATEGORIES_DELETE,
    Permission.PRODUCTS_VIEW,
    Permission.PRODUCTS_CREATE,
    Permission.PRODUCTS_UPDATE,
    Permission.PRODUCTS_DELETE,
    Permission.PRODUCTS_PRICE_UPDATE,
    Permission.PRODUCTS_AVAILABILITY_UPDATE,
    Permission.MODIFIERS_VIEW,
    Permission.MODIFIERS_MANAGE,
  ],
  Orders: [
    Permission.ORDERS_VIEW,
    Permission.ORDERS_VIEW_ALL_BRANCHES,
    Permission.ORDERS_CREATE,
    Permission.ORDERS_UPDATE,
    Permission.ORDERS_CANCEL,
    Permission.ORDERS_REFUND,
    Permission.ORDERS_CHANGE_STATUS,
    Permission.ORDERS_ASSIGN_COURIER,
  ],
  Kitchen: [Permission.KITCHEN_VIEW, Permission.KITCHEN_UPDATE_STATUS],
  'POS & Cash': [
    Permission.POS_ACCESS,
    Permission.PAYMENTS_VIEW,
    Permission.PAYMENTS_RECEIVE,
    Permission.PAYMENTS_REFUND,
    Permission.CASHBOX_VIEW,
    Permission.CASHBOX_OPEN_SHIFT,
    Permission.CASHBOX_CLOSE_SHIFT,
    Permission.CASHBOX_TRANSACTION,
    Permission.CASHBOX_VIEW_ALL_SHIFTS,
  ],
  Delivery: [
    Permission.COURIERS_VIEW,
    Permission.COURIERS_CREATE,
    Permission.COURIERS_UPDATE,
    Permission.COURIERS_DELETE,
    Permission.COURIERS_TRACK,
    Permission.COURIER_WALLET_VIEW,
    Permission.COURIER_WALLET_SETTLE,
    Permission.DELIVERIES_VIEW_OWN,
    Permission.DELIVERIES_UPDATE_OWN,
  ],
  Customers: [
    Permission.CUSTOMERS_VIEW,
    Permission.CUSTOMERS_UPDATE,
    Permission.CUSTOMERS_DELETE,
    Permission.CUSTOMERS_EXPORT,
  ],
  Marketing: [
    Permission.PROMOTIONS_VIEW,
    Permission.PROMOTIONS_MANAGE,
    Permission.PROMO_CODES_VIEW,
    Permission.PROMO_CODES_MANAGE,
    Permission.LOYALTY_VIEW,
    Permission.LOYALTY_MANAGE,
  ],
  Tables: [
    Permission.TABLES_VIEW,
    Permission.TABLES_MANAGE,
    Permission.WAITER_CALLS_HANDLE,
  ],
  Telegram: [Permission.TELEGRAM_VIEW, Permission.TELEGRAM_MANAGE],
  Finance: [
    Permission.FINANCE_VIEW,
    Permission.FINANCE_MANAGE,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    Permission.ANALYTICS_VIEW,
  ],
  Audit: [Permission.AUDIT_VIEW],
};

/* -------------------------------------------------------------------------- */
/* System roles                                                               */
/* -------------------------------------------------------------------------- */

export const SystemRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OWNER: 'OWNER',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  CASHIER: 'CASHIER',
  KITCHEN: 'KITCHEN',
  COURIER: 'COURIER',
  FINANCE: 'FINANCE',
  OPERATOR: 'OPERATOR',
  MARKETING: 'MARKETING',
  SUPPORT: 'SUPPORT',
} as const;
export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole];

/**
 * The only role that lives outside any tenant. A SUPER_ADMIN user has
 * `tenantId = null` and its token carries no tenant, which is what lets the
 * tenant-scoping Prisma extension run unscoped for it.
 */
export const PLATFORM_ROLES: readonly SystemRole[] = [SystemRole.SUPER_ADMIN];

export function isPlatformRole(role: string): boolean {
  return (PLATFORM_ROLES as readonly string[]).includes(role);
}

/* -------------------------------------------------------------------------- */
/* Default role → permission mapping                                          */
/* -------------------------------------------------------------------------- */

const READ_ONLY_OPERATIONS: readonly Permission[] = [
  Permission.ORDERS_VIEW,
  Permission.ORDERS_VIEW_ALL_BRANCHES,
  Permission.PRODUCTS_VIEW,
  Permission.CATEGORIES_VIEW,
  Permission.MODIFIERS_VIEW,
  Permission.BRANCHES_VIEW,
  Permission.CUSTOMERS_VIEW,
];

/**
 * Permissions each system role is seeded with. SUPER_ADMIN is intentionally
 * absent: it is granted `ALL_PERMISSIONS` at seed time and additionally
 * short-circuits the permissions guard, so new permissions never need to be
 * back-filled into it.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<Exclude<SystemRole, 'SUPER_ADMIN'>, readonly Permission[]>
> = {
  /** Business owner — everything inside their own tenant. */
  OWNER: ALL_PERMISSIONS.filter(
    (p) => !PERMISSION_GROUPS.Platform!.includes(p),
  ),

  /** Day-to-day company administrator: no branding/billing surgery. */
  COMPANY_ADMIN: ALL_PERMISSIONS.filter(
    (p) =>
      !PERMISSION_GROUPS.Platform!.includes(p) &&
      p !== Permission.BRANDING_UPDATE &&
      p !== Permission.TENANTS_DELETE &&
      p !== Permission.BRANCHES_DELETE,
  ),

  /** Runs one branch: full floor control, no company-wide configuration. */
  BRANCH_MANAGER: [
    Permission.SETTINGS_VIEW,
    Permission.BRANCHES_VIEW,
    Permission.EMPLOYEES_VIEW,
    Permission.CATEGORIES_VIEW,
    Permission.PRODUCTS_VIEW,
    Permission.PRODUCTS_AVAILABILITY_UPDATE,
    Permission.MODIFIERS_VIEW,
    Permission.ORDERS_VIEW,
    Permission.ORDERS_CREATE,
    Permission.ORDERS_UPDATE,
    Permission.ORDERS_CANCEL,
    Permission.ORDERS_CHANGE_STATUS,
    Permission.ORDERS_ASSIGN_COURIER,
    Permission.KITCHEN_VIEW,
    Permission.KITCHEN_UPDATE_STATUS,
    Permission.POS_ACCESS,
    Permission.PAYMENTS_VIEW,
    Permission.PAYMENTS_RECEIVE,
    Permission.PAYMENTS_REFUND,
    Permission.CASHBOX_VIEW,
    Permission.CASHBOX_VIEW_ALL_SHIFTS,
    Permission.CASHBOX_OPEN_SHIFT,
    Permission.CASHBOX_CLOSE_SHIFT,
    Permission.CASHBOX_TRANSACTION,
    Permission.COURIERS_VIEW,
    Permission.COURIERS_TRACK,
    Permission.COURIER_WALLET_VIEW,
    Permission.COURIER_WALLET_SETTLE,
    Permission.CUSTOMERS_VIEW,
    Permission.TABLES_VIEW,
    Permission.TABLES_MANAGE,
    Permission.WAITER_CALLS_HANDLE,
    Permission.PROMOTIONS_VIEW,
    Permission.PROMO_CODES_VIEW,
    Permission.REPORTS_VIEW,
    Permission.ANALYTICS_VIEW,
  ],

  /** Till operator (TZ §5 "Senior Cashier" is a custom role on top of this). */
  CASHIER: [
    Permission.POS_ACCESS,
    // The POS header shows which branch the till belongs to, and the order
    // form needs the branch's delivery fee and minimum — without this the
    // terminal cannot render its own identity.
    Permission.BRANCHES_VIEW,
    Permission.ORDERS_VIEW,
    Permission.ORDERS_CREATE,
    Permission.ORDERS_UPDATE,
    Permission.ORDERS_CHANGE_STATUS,
    Permission.PRODUCTS_VIEW,
    Permission.CATEGORIES_VIEW,
    Permission.MODIFIERS_VIEW,
    Permission.PAYMENTS_VIEW,
    Permission.PAYMENTS_RECEIVE,
    Permission.CASHBOX_VIEW,
    Permission.CASHBOX_OPEN_SHIFT,
    Permission.CASHBOX_CLOSE_SHIFT,
    Permission.CASHBOX_TRANSACTION,
    Permission.CUSTOMERS_VIEW,
    Permission.TABLES_VIEW,
  ],

  /** Kitchen display only — cannot see money. */
  KITCHEN: [
    Permission.KITCHEN_VIEW,
    Permission.KITCHEN_UPDATE_STATUS,
    Permission.ORDERS_VIEW,
    Permission.PRODUCTS_VIEW,
    // The KDS picks its branch on first run.
    Permission.BRANCHES_VIEW,
    // Marking something as run out is a kitchen action, not an admin one.
    Permission.PRODUCTS_AVAILABILITY_UPDATE,
  ],

  /** The courier mobile app: own jobs, own wallet. Nothing else. */
  COURIER: [
    Permission.DELIVERIES_VIEW_OWN,
    Permission.DELIVERIES_UPDATE_OWN,
    Permission.COURIER_WALLET_VIEW,
    // Needed to show the pickup branch's address and phone on the job card.
    Permission.BRANCHES_VIEW,
  ],

  FINANCE: [
    Permission.FINANCE_VIEW,
    Permission.FINANCE_MANAGE,
    Permission.PAYMENTS_VIEW,
    Permission.PAYMENTS_REFUND,
    Permission.CASHBOX_VIEW,
    Permission.CASHBOX_VIEW_ALL_SHIFTS,
    Permission.COURIER_WALLET_VIEW,
    Permission.COURIER_WALLET_SETTLE,
    Permission.ORDERS_VIEW,
    Permission.ORDERS_VIEW_ALL_BRANCHES,
    Permission.ORDERS_REFUND,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    Permission.ANALYTICS_VIEW,
    Permission.AUDIT_VIEW,
  ],

  /** Call-centre / dispatcher. */
  OPERATOR: [
    Permission.ORDERS_VIEW,
    Permission.ORDERS_VIEW_ALL_BRANCHES,
    Permission.ORDERS_CREATE,
    Permission.ORDERS_UPDATE,
    Permission.ORDERS_CANCEL,
    Permission.ORDERS_CHANGE_STATUS,
    Permission.ORDERS_ASSIGN_COURIER,
    Permission.PRODUCTS_VIEW,
    Permission.CATEGORIES_VIEW,
    Permission.MODIFIERS_VIEW,
    Permission.BRANCHES_VIEW,
    Permission.CUSTOMERS_VIEW,
    Permission.CUSTOMERS_UPDATE,
    Permission.COURIERS_VIEW,
    Permission.COURIERS_TRACK,
    Permission.PROMO_CODES_VIEW,
  ],

  MARKETING: [
    Permission.PROMOTIONS_VIEW,
    Permission.PROMOTIONS_MANAGE,
    Permission.PROMO_CODES_VIEW,
    Permission.PROMO_CODES_MANAGE,
    Permission.LOYALTY_VIEW,
    Permission.LOYALTY_MANAGE,
    Permission.CUSTOMERS_VIEW,
    Permission.CUSTOMERS_EXPORT,
    Permission.PRODUCTS_VIEW,
    Permission.CATEGORIES_VIEW,
    Permission.REPORTS_VIEW,
    Permission.ANALYTICS_VIEW,
  ],

  SUPPORT: [...READ_ONLY_OPERATIONS, Permission.CUSTOMERS_UPDATE, Permission.AUDIT_VIEW],
};

/* -------------------------------------------------------------------------- */
/* Runtime helpers                                                            */
/* -------------------------------------------------------------------------- */

/** True when `granted` covers every entry of `required`. */
export function hasAllPermissions(
  granted: readonly string[],
  required: readonly Permission[],
): boolean {
  return required.every((p) => granted.includes(p));
}

/** True when `granted` covers at least one entry of `required`. */
export function hasAnyPermission(
  granted: readonly string[],
  required: readonly Permission[],
): boolean {
  return required.some((p) => granted.includes(p));
}
