/**
 * Re-syncs the permission catalog and every system role's grants.
 *
 * Run after adding or regrouping a permission in `@restor/shared-types`:
 * existing tenants were seeded with the OLD set, and without this they would
 * keep it until someone edited each role by hand.
 *
 * Non-destructive by design — it only inserts missing permissions and
 * reconciles the grants of roles marked `isSystem`. Custom roles an admin
 * built are never touched, because their grants are a deliberate choice.
 *
 *   npm run db:sync-roles --workspace=backend
 */

import { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  SystemRole,
  type Permission,
} from '@restor/shared-types';

const prisma = new PrismaClient();

function groupOf(code: Permission): string {
  for (const [group, list] of Object.entries(PERMISSION_GROUPS)) {
    if ((list as readonly string[]).includes(code)) return group;
  }
  return 'Other';
}

async function main(): Promise<void> {
  console.log('→ Syncing permission catalog and system roles\n');

  // 1. The catalog itself.
  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, group: groupOf(code) },
      update: { group: groupOf(code) },
    });
  }
  console.log(`  catalog            ${ALL_PERMISSIONS.length} permissions`);

  const permissions = await prisma.permission.findMany({ select: { id: true, code: true } });
  const idByCode = new Map(permissions.map((row) => [row.code, row.id]));

  // 2. The platform role gets everything, so a new permission is never missing
  //    from it.
  const superAdmin = await prisma.role.findFirst({
    where: { tenantId: null, code: SystemRole.SUPER_ADMIN },
    select: { id: true },
  });

  if (superAdmin) {
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: superAdmin.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
    console.log(`  SUPER_ADMIN        ${permissions.length} permissions`);
  }

  // 3. Every tenant's copies of the system roles.
  const roles = await prisma.role.findMany({
    where: { isSystem: true, tenantId: { not: null }, deletedAt: null },
    select: { id: true, code: true, tenantId: true },
  });

  let reconciled = 0;

  for (const role of roles) {
    const expected = DEFAULT_ROLE_PERMISSIONS[
      role.code as keyof typeof DEFAULT_ROLE_PERMISSIONS
    ];
    if (!expected) continue;

    const expectedIds = expected
      .map((permission) => idByCode.get(permission))
      .filter((id): id is string => Boolean(id));

    // Replaced wholesale: a system role's grants are defined by the catalog,
    // so a drifted row should be corrected in both directions.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: expectedIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ]);

    reconciled += 1;
  }

  console.log(`  system roles       ${reconciled} reconciled across all tenants`);
  console.log('\n✔ Sync complete');
  console.log('  Staff must sign in again: permissions are baked into the access token.\n');
}

main()
  .catch((error: unknown) => {
    console.error('\n✖ Sync failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
