/**
 * Development seed (TZ §63).
 *
 * Creates a super admin, one demo restaurant with two branches, staff for
 * every role, and a small menu — enough to sign into every client and place a
 * real order without touching the database by hand.
 *
 * Idempotent: safe to re-run. Existing rows are reused rather than duplicated,
 * so `npm run db:seed` after a schema change does not explode.
 *
 * The seeded passwords are DEVELOPMENT ONLY and the script refuses to run
 * against `NODE_ENV=production`.
 */

import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  SubscriptionStatus,
  SystemRole,
  TenantStatus,
  type Permission,
} from '@restor/shared-types';

const prisma = new PrismaClient();

/** Shown in the README; never reuse outside development. */
const DEV_PASSWORD = 'Restor2026dev';

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  console.log('→ Seeding RESTOR development data\n');

  const passwordHash = await hash(DEV_PASSWORD, ARGON2_OPTIONS);

  await seedPermissions();
  const plans = await seedPlans();
  await seedSuperAdmin(passwordHash);
  const tenant = await seedDemoTenant(plans.proId, passwordHash);

  console.log('\n✔ Seed complete\n');
  printCredentials(tenant.slug);
}

/* -------------------------------------------------------------------------- */
/* Permissions & plans                                                        */
/* -------------------------------------------------------------------------- */

/** Mirrors the shared catalog into the `permissions` table. */
async function seedPermissions(): Promise<void> {
  const groupOf = (code: Permission): string => {
    for (const [group, list] of Object.entries(PERMISSION_GROUPS)) {
      if ((list as readonly string[]).includes(code)) return group;
    }
    return 'Other';
  };

  for (const code of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, group: groupOf(code) },
      update: { group: groupOf(code) },
    });
  }

  console.log(`  permissions        ${ALL_PERMISSIONS.length}`);
}

async function seedPlans(): Promise<{ proId: string }> {
  const definitions = [
    {
      code: 'FREE',
      name: 'Free',
      price: 0,
      periodDays: 30,
      maxBranches: 1,
      maxEmployees: 5,
      maxPosTerminals: 1,
      maxBots: 1,
      maxStorageMb: 512,
      sortOrder: 0,
    },
    {
      code: 'BASIC',
      name: 'Basic',
      price: 490_000,
      periodDays: 30,
      maxBranches: 3,
      maxEmployees: 25,
      maxPosTerminals: 3,
      maxBots: 1,
      maxStorageMb: 5_120,
      sortOrder: 1,
    },
    {
      code: 'PRO',
      name: 'Pro',
      price: 1_490_000,
      periodDays: 30,
      // `null` means unlimited.
      maxBranches: null,
      maxEmployees: null,
      maxPosTerminals: null,
      maxBots: 5,
      maxStorageMb: 51_200,
      sortOrder: 2,
    },
  ];

  let proId = '';
  for (const plan of definitions) {
    const row = await prisma.plan.upsert({
      where: { code: plan.code },
      create: plan,
      update: plan,
    });
    if (plan.code === 'PRO') proId = row.id;
  }

  console.log(`  plans              ${definitions.length}`);
  return { proId };
}

/* -------------------------------------------------------------------------- */
/* Super admin                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The platform administrator lives OUTSIDE every tenant: `tenantId` is null on
 * both the user and its role, which is what lets the tenant-scoping extension
 * run unscoped for them.
 */
async function seedSuperAdmin(passwordHash: string): Promise<void> {
  let role = await prisma.role.findFirst({
    where: { tenantId: null, code: SystemRole.SUPER_ADMIN },
  });

  if (!role) {
    role = await prisma.role.create({
      data: {
        tenantId: null,
        code: SystemRole.SUPER_ADMIN,
        name: 'Super Admin',
        description: 'Platform administrator with access to every restaurant',
        isSystem: true,
      },
    });
  }

  // Granted every permission so a newly added one never has to be back-filled.
  const permissions = await prisma.permission.findMany({ select: { id: true } });
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: role!.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  const phone = '+998900000000';
  let user = await prisma.user.findFirst({ where: { tenantId: null, phone } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        tenantId: null,
        phone,
        email: 'admin@restor.uz',
        passwordHash,
        fullName: 'Platform Administrator',
      },
    });
  }

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });

  console.log('  super admin        +998900000000');
}

/* -------------------------------------------------------------------------- */
/* Demo tenant                                                                */
/* -------------------------------------------------------------------------- */

async function seedDemoTenant(
  planId: string,
  passwordHash: string,
): Promise<{ id: string; slug: string }> {
  const slug = 'demo';

  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    console.log('  demo tenant        already present, skipping');
    return { id: existing.id, slug };
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Demo Fast Food',
      slug,
      legalName: 'Demo Fast Food LLC',
      phone: '+998712000000',
      email: 'info@demo.restor.uz',
      status: TenantStatus.ACTIVE,
      currency: 'UZS',
      timezone: 'Asia/Tashkent',
      primaryColor: '#FF6B00',
      companyName: 'Demo Fast Food',
    },
  });

  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planId,
      status: SubscriptionStatus.ACTIVE,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 365 * 86_400_000),
      maxBranches: null,
      maxEmployees: null,
      maxPosTerminals: null,
      maxBots: 5,
      maxStorageMb: 51_200,
    },
  });

  const roleIds = await seedTenantRoles(tenant.id);
  const branches = await seedBranches(tenant.id);
  await seedStaff(tenant.id, branches, roleIds, passwordHash);
  await seedMenu(tenant.id, branches);

  console.log(`  demo tenant        ${slug}`);
  return { id: tenant.id, slug };
}

/** Each tenant gets its OWN copies of the system roles (TZ §5). */
async function seedTenantRoles(tenantId: string): Promise<Map<string, string>> {
  const permissions = await prisma.permission.findMany({ select: { id: true, code: true } });
  const idByCode = new Map(permissions.map((row) => [row.code, row.id]));

  const result = new Map<string, string>();

  for (const [code, granted] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = await prisma.role.create({
      data: {
        tenantId,
        code,
        name: humanize(code),
        isSystem: true,
        permissions: {
          create: granted
            .map((permission) => idByCode.get(permission))
            .filter((id): id is string => Boolean(id))
            .map((permissionId) => ({ permissionId })),
        },
      },
    });
    result.set(code, role.id);
  }

  console.log(`  roles              ${result.size}`);
  return result;
}

async function seedBranches(
  tenantId: string,
): Promise<Array<{ id: string; name: string }>> {
  const definitions = [
    {
      name: 'Chilonzor',
      slug: 'chilonzor',
      address: 'Chilonzor tumani, Bunyodkor shoh ko‘chasi 12',
      phone: '+998712001001',
      latitude: 41.2756,
      longitude: 69.2035,
      orderPrefix: 'CH',
    },
    {
      name: 'Yunusobod',
      slug: 'yunusobod',
      address: 'Yunusobod tumani, Amir Temur shoh ko‘chasi 108',
      phone: '+998712001002',
      latitude: 41.3628,
      longitude: 69.2896,
      orderPrefix: 'YU',
    },
  ];

  const created: Array<{ id: string; name: string }> = [];

  for (const definition of definitions) {
    const branch = await prisma.branch.create({
      data: {
        tenantId,
        ...definition,
        deliveryRadiusM: 8_000,
        minOrderAmount: 30_000,
        deliveryPrice: 15_000,
        averagePrepMinutes: 20,
        acceptsDelivery: true,
        acceptsPickup: true,
        acceptsDineIn: true,
        workingHours: {
          create: Array.from({ length: 7 }, (_, index) => ({
            dayOfWeek: index + 1,
            opensAt: '09:00',
            // Past midnight, which is normal for a fast food branch.
            closesAt: '02:00',
            isClosed: false,
          })),
        },
        cashRegisters: {
          create: { tenantId, name: `${definition.name} — Kassa 1`, deviceId: `${definition.slug}-pos-1` },
        },
      },
    });

    created.push({ id: branch.id, name: branch.name });
  }

  console.log(`  branches           ${created.length}`);
  return created;
}

async function seedStaff(
  tenantId: string,
  branches: Array<{ id: string; name: string }>,
  roleIds: Map<string, string>,
  passwordHash: string,
): Promise<void> {
  const chilonzor = branches[0]!;

  const staff: Array<{
    phone: string;
    fullName: string;
    role: string;
    position: string;
    /** Empty = every branch. */
    branchIds: string[];
    isCourier?: boolean;
  }> = [
    {
      phone: '+998901111111',
      fullName: 'Aziz Karimov',
      role: SystemRole.OWNER,
      position: 'Owner',
      branchIds: [],
    },
    {
      phone: '+998902222222',
      fullName: 'Dilnoza Rahimova',
      role: SystemRole.COMPANY_ADMIN,
      position: 'Administrator',
      branchIds: [],
    },
    {
      phone: '+998903333333',
      fullName: 'Sardor Yusupov',
      role: SystemRole.BRANCH_MANAGER,
      position: 'Branch manager',
      branchIds: [chilonzor.id],
    },
    {
      phone: '+998904444444',
      fullName: 'Malika Tosheva',
      role: SystemRole.CASHIER,
      position: 'Cashier',
      branchIds: [chilonzor.id],
    },
    {
      phone: '+998905555555',
      fullName: 'Jasur Ergashev',
      role: SystemRole.KITCHEN,
      position: 'Chef',
      branchIds: [chilonzor.id],
    },
    {
      phone: '+998906666666',
      fullName: 'Bekzod Aliyev',
      role: SystemRole.COURIER,
      position: 'Courier',
      branchIds: [chilonzor.id],
      isCourier: true,
    },
    {
      phone: '+998907777777',
      fullName: 'Nodira Saidova',
      role: SystemRole.FINANCE,
      position: 'Accountant',
      branchIds: [],
    },
  ];

  for (const person of staff) {
    const roleId = roleIds.get(person.role);
    if (!roleId) continue;

    const user = await prisma.user.create({
      data: {
        tenantId,
        phone: person.phone,
        passwordHash,
        fullName: person.fullName,
        roles: {
          create:
            person.branchIds.length === 0
              ? [{ roleId }]
              : person.branchIds.map((branchId) => ({ roleId, branchId })),
        },
        employee: {
          create: {
            tenantId,
            branchId: person.branchIds[0] ?? null,
            position: person.position,
            hiredAt: new Date(),
          },
        },
      },
    });

    if (person.isCourier) {
      await prisma.courier.create({
        data: {
          tenantId,
          userId: user.id,
          branchId: person.branchIds[0] ?? null,
          vehicleType: 'SCOOTER',
          wallet: { create: {} },
        },
      });
    }
  }

  console.log(`  staff              ${staff.length}`);
}

async function seedMenu(
  tenantId: string,
  branches: Array<{ id: string; name: string }>,
): Promise<void> {
  const branchIds = branches.map((branch) => branch.id);

  // --- Modifier groups, shared across products ---
  const sauces = await prisma.modifierGroup.create({
    data: {
      tenantId,
      name: 'Sous',
      minSelect: 0,
      maxSelect: 2,
      sortOrder: 0,
      modifiers: {
        create: [
          { name: 'Ketchup', price: 0, sortOrder: 0 },
          { name: 'Mayonez', price: 0, sortOrder: 1 },
          { name: 'Achchiq sous', price: 3_000, sortOrder: 2 },
          { name: 'Sirli sous', price: 4_000, sortOrder: 3 },
        ],
      },
    },
  });

  const extras = await prisma.modifierGroup.create({
    data: {
      tenantId,
      name: 'Qo‘shimchalar',
      minSelect: 0,
      maxSelect: 3,
      sortOrder: 1,
      modifiers: {
        create: [
          { name: 'Qo‘shimcha pishloq', price: 5_000, sortOrder: 0 },
          { name: 'Qo‘shimcha go‘sht', price: 10_000, sortOrder: 1 },
          { name: 'Jalapeño', price: 3_000, sortOrder: 2 },
        ],
      },
    },
  });

  const catalog: Array<{
    category: string;
    products: Array<{
      name: string;
      description: string;
      price: number;
      discountPrice?: number;
      prep: number;
      variants?: Array<{ name: string; priceDelta: number; isDefault?: boolean }>;
      modifierGroupIds?: string[];
    }>;
  }> = [
    {
      category: 'Lavash va donar',
      products: [
        {
          name: 'Tovuqli lavash',
          description: 'Tovuq go‘shti, pomidor, bodring, sous',
          price: 32_000,
          prep: 8,
          variants: [
            { name: 'Oddiy', priceDelta: 0, isDefault: true },
            { name: 'Katta', priceDelta: 9_000 },
          ],
          modifierGroupIds: [sauces.id, extras.id],
        },
        {
          name: 'Mol go‘shtli lavash',
          description: 'Mol go‘shti, sabzavotlar, maxsus sous',
          price: 42_000,
          discountPrice: 38_000,
          prep: 10,
          variants: [
            { name: 'Oddiy', priceDelta: 0, isDefault: true },
            { name: 'Katta', priceDelta: 12_000 },
          ],
          modifierGroupIds: [sauces.id, extras.id],
        },
      ],
    },
    {
      category: 'Burgerlar',
      products: [
        {
          name: 'Chizburger',
          description: 'Mol kotleti, cheddar pishloq, salat',
          price: 35_000,
          prep: 9,
          modifierGroupIds: [sauces.id, extras.id],
        },
        {
          name: 'Double burger',
          description: 'Ikki qavat kotlet, ikki xil pishloq',
          price: 55_000,
          prep: 12,
          modifierGroupIds: [sauces.id, extras.id],
        },
      ],
    },
    {
      category: 'Pitsa',
      products: [
        {
          name: 'Pepperoni',
          description: 'Pepperoni kolbasa, mozzarella, tomat sous',
          price: 75_000,
          prep: 18,
          variants: [
            { name: 'Kichik 25 sm', priceDelta: -15_000 },
            { name: 'O‘rta 30 sm', priceDelta: 0, isDefault: true },
            { name: 'Katta 35 sm', priceDelta: 25_000 },
          ],
        },
        {
          name: 'To‘rt pishloq',
          description: 'Mozzarella, cheddar, parmezan, dor blyu',
          price: 82_000,
          prep: 18,
          variants: [
            { name: 'Kichik 25 sm', priceDelta: -15_000 },
            { name: 'O‘rta 30 sm', priceDelta: 0, isDefault: true },
            { name: 'Katta 35 sm', priceDelta: 25_000 },
          ],
        },
      ],
    },
    {
      category: 'Garnir',
      products: [
        { name: 'Fri kartoshka', description: 'Xrustlagan fri', price: 18_000, prep: 5 },
        { name: 'Nagets (6 dona)', description: 'Tovuqli nagets', price: 24_000, prep: 6 },
      ],
    },
    {
      category: 'Ichimliklar',
      products: [
        { name: 'Cola 0.5', description: 'Sovuq gazli ichimlik', price: 12_000, prep: 1 },
        { name: 'Ayron 0.5', description: 'Tabiiy ayron', price: 10_000, prep: 1 },
        { name: 'Suv 0.5', description: 'Gazsiz ichimlik suvi', price: 5_000, prep: 1 },
      ],
    },
  ];

  let productCount = 0;

  for (const [categoryIndex, group] of catalog.entries()) {
    const category = await prisma.category.create({
      data: {
        tenantId,
        name: group.category,
        slug: slugify(group.category),
        sortOrder: categoryIndex,
      },
    });

    for (const [productIndex, product] of group.products.entries()) {
      await prisma.product.create({
        data: {
          tenantId,
          categoryId: category.id,
          name: product.name,
          slug: slugify(product.name),
          description: product.description,
          price: product.price,
          discountPrice: product.discountPrice ?? null,
          preparationTime: product.prep,
          sortOrder: productIndex,
          variants: product.variants?.length
            ? {
                create: product.variants.map((variant, index) => ({
                  name: variant.name,
                  priceDelta: variant.priceDelta,
                  isDefault: variant.isDefault ?? false,
                  sortOrder: index,
                })),
              }
            : undefined,
          modifierGroups: product.modifierGroupIds?.length
            ? {
                create: product.modifierGroupIds.map((modifierGroupId, index) => ({
                  modifierGroupId,
                  sortOrder: index,
                })),
              }
            : undefined,
          // Available at every branch by default.
          branchSettings: {
            create: branchIds.map((branchId) => ({ branchId, isAvailable: true })),
          },
        },
      });
      productCount += 1;
    }
  }

  // --- Kitchen stations (TZ §22) ---
  const categories = await prisma.category.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  });
  const categoryId = (name: string): string | undefined =>
    categories.find((entry) => entry.name === name)?.id;

  const stations: Array<{ name: string; categories: string[] }> = [
    { name: 'Grill', categories: ['Lavash va donar', 'Burgerlar'] },
    { name: 'Pitsa', categories: ['Pitsa'] },
    { name: 'Bar', categories: ['Ichimliklar', 'Garnir'] },
  ];

  for (const [index, station] of stations.entries()) {
    for (const branch of branches) {
      const linkIds = station.categories
        .map(categoryId)
        .filter((id): id is string => Boolean(id));

      await prisma.kitchenStation.create({
        data: {
          tenantId,
          branchId: branch.id,
          name: station.name,
          sortOrder: index,
          categories: { create: linkIds.map((id) => ({ categoryId: id })) },
        },
      });
    }
  }

  // --- Tables for QR ordering (TZ §29) ---
  for (const branch of branches) {
    await prisma.restaurantTable.createMany({
      data: Array.from({ length: 8 }, (_, index) => ({
        tenantId,
        branchId: branch.id,
        number: String(index + 1),
        seats: index < 4 ? 2 : 4,
        qrToken: randomToken(),
      })),
    });
  }

  console.log(`  menu               ${catalog.length} categories, ${productCount} products`);
  console.log(`  kitchen stations   ${stations.length * branches.length}`);
  console.log(`  tables             ${8 * branches.length}`);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function humanize(code: string): string {
  return code
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

/** Local copy so the seed does not depend on the built shared-utils package. */
function slugify(input: string): string {
  const map: Record<string, string> = { '‘': '', '’': '', ʻ: '' };
  return input
    .toLowerCase()
    .split('')
    .map((char) => map[char] ?? char)
    .join('')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function printCredentials(tenantSlug: string): void {
  const rows: Array<[string, string]> = [
    ['SUPER_ADMIN', '+998900000000'],
    ['OWNER', '+998901111111'],
    ['COMPANY_ADMIN', '+998902222222'],
    ['BRANCH_MANAGER', '+998903333333'],
    ['CASHIER', '+998904444444'],
    ['KITCHEN', '+998905555555'],
    ['COURIER', '+998906666666'],
    ['FINANCE', '+998907777777'],
  ];

  console.log('  Development credentials (DEV ONLY)');
  console.log('  ─────────────────────────────────────────────');
  for (const [role, phone] of rows) {
    console.log(`  ${role.padEnd(16)} ${phone}`);
  }
  console.log(`  ${'password'.padEnd(16)} ${DEV_PASSWORD}`);
  console.log(`  ${'tenantSlug'.padEnd(16)} ${tenantSlug}  (omit for SUPER_ADMIN)`);
  console.log('  ─────────────────────────────────────────────\n');
}

main()
  .catch((error: unknown) => {
    console.error('\n✖ Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
