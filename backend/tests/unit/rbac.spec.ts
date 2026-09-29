import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  Permission,
  SystemRole,
  hasAllPermissions,
  hasAnyPermission,
  isPlatformRole,
} from '@restor/shared-types';

/**
 * RBAC catalog (TZ §5).
 *
 * These assertions encode privilege boundaries, not just data shape: a change
 * that hands a cashier `payments.refund` should fail a test, not ship.
 */
describe('permission catalog', () => {
  it('has no duplicate codes', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('assigns every permission to exactly one display group', () => {
    const seen = new Map<string, string>();

    for (const [group, permissions] of Object.entries(PERMISSION_GROUPS)) {
      for (const permission of permissions) {
        expect(seen.has(permission)).toBe(false);
        seen.set(permission, group);
      }
    }

    // Every permission must be reachable from the role editor's UI.
    for (const permission of ALL_PERMISSIONS) {
      expect(seen.has(permission)).toBe(true);
    }
  });

  it('uses resource.action naming throughout', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
  });
});

describe('default role grants', () => {
  it('grants only permissions that exist', () => {
    for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(ALL_PERMISSIONS).toContain(permission);
      }
      expect(permissions.length).toBeGreaterThan(0);
      expect(role).toBeTruthy();
    }
  });

  it('keeps platform permissions out of every tenant role', () => {
    const platform = PERMISSION_GROUPS.Platform!;

    for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const permission of platform) {
        expect(permissions).not.toContain(permission);
      }
      expect(role).not.toBe(SystemRole.SUPER_ADMIN);
    }
  });

  it('does not let a cashier refund money', () => {
    // Taking payment and reversing it are different levels of trust.
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).toContain(Permission.PAYMENTS_RECEIVE);
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain(Permission.PAYMENTS_REFUND);
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain(Permission.ORDERS_REFUND);
  });

  it('does not let a cashier reprice the menu', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain(Permission.PRODUCTS_PRICE_UPDATE);
    expect(DEFAULT_ROLE_PERMISSIONS.CASHIER).not.toContain(Permission.PRODUCTS_UPDATE);
  });

  it('keeps money away from the kitchen display', () => {
    const forbidden = [
      Permission.PAYMENTS_VIEW,
      Permission.PAYMENTS_RECEIVE,
      Permission.CASHBOX_VIEW,
      Permission.FINANCE_VIEW,
      Permission.REPORTS_VIEW,
    ];

    for (const permission of forbidden) {
      expect(DEFAULT_ROLE_PERMISSIONS.KITCHEN).not.toContain(permission);
    }
  });

  it('restricts the courier to its own jobs and wallet', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.COURIER).toContain(Permission.DELIVERIES_VIEW_OWN);
    expect(DEFAULT_ROLE_PERMISSIONS.COURIER).not.toContain(Permission.ORDERS_VIEW);
    expect(DEFAULT_ROLE_PERMISSIONS.COURIER).not.toContain(Permission.CUSTOMERS_VIEW);
    expect(DEFAULT_ROLE_PERMISSIONS.COURIER).not.toContain(Permission.COURIER_WALLET_SETTLE);
  });

  it('gives every operational role the branch context it needs', () => {
    // A POS/KDS/courier screen that cannot read its own branch cannot render.
    for (const role of ['CASHIER', 'KITCHEN', 'COURIER'] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(Permission.BRANCHES_VIEW);
    }
  });

  it('lets marketing reach customers but not orders or money', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.MARKETING).toContain(Permission.PROMOTIONS_MANAGE);
    expect(DEFAULT_ROLE_PERMISSIONS.MARKETING).not.toContain(Permission.ORDERS_CANCEL);
    expect(DEFAULT_ROLE_PERMISSIONS.MARKETING).not.toContain(Permission.PAYMENTS_RECEIVE);
  });

  it('keeps SUPPORT read-only apart from customer edits', () => {
    // `.view` and `.view.*` are reads; everything else mutates something.
    const isRead = (permission: string): boolean => /(^|\.)view(\.|$)/.test(permission);

    const writes = DEFAULT_ROLE_PERMISSIONS.SUPPORT.filter(
      (permission) => !isRead(permission) && permission !== Permission.CUSTOMERS_UPDATE,
    );

    expect(writes).toEqual([]);
    // The one write it does have is deliberate: support corrects a customer's
    // name or phone when they call in.
    expect(DEFAULT_ROLE_PERMISSIONS.SUPPORT).toContain(Permission.CUSTOMERS_UPDATE);
    expect(DEFAULT_ROLE_PERMISSIONS.SUPPORT).not.toContain(Permission.CUSTOMERS_DELETE);
  });

  it('gives the owner everything inside their tenant', () => {
    const tenantPermissions = ALL_PERMISSIONS.filter(
      (permission) => !PERMISSION_GROUPS.Platform!.includes(permission),
    );
    expect([...DEFAULT_ROLE_PERMISSIONS.OWNER].sort()).toEqual([...tenantPermissions].sort());
  });
});

describe('permission helpers', () => {
  const granted = [Permission.ORDERS_VIEW, Permission.ORDERS_CREATE];

  it('hasAllPermissions requires every entry', () => {
    expect(hasAllPermissions(granted, [Permission.ORDERS_VIEW])).toBe(true);
    expect(hasAllPermissions(granted, [Permission.ORDERS_VIEW, Permission.ORDERS_CANCEL])).toBe(false);
    expect(hasAllPermissions(granted, [])).toBe(true);
  });

  it('hasAnyPermission requires at least one', () => {
    expect(hasAnyPermission(granted, [Permission.ORDERS_CANCEL, Permission.ORDERS_VIEW])).toBe(true);
    expect(hasAnyPermission(granted, [Permission.ORDERS_CANCEL])).toBe(false);
    expect(hasAnyPermission(granted, [])).toBe(false);
  });

  it('identifies the platform role', () => {
    expect(isPlatformRole(SystemRole.SUPER_ADMIN)).toBe(true);
    expect(isPlatformRole(SystemRole.OWNER)).toBe(false);
  });
});
