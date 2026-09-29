import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  AuditAction,
  DEFAULT_ROLE_PERMISSIONS,
  ErrorCode,
  SubscriptionStatus,
  SystemRole,
  TenantStatus,
  type Paginated,
  type Plan,
  type PlatformStats,
  type Subscription,
  type Tenant,
} from '@restor/shared-types';
import { normalizePagination, paginated, slugify, uniqueSlug } from '@restor/shared-utils';
import type {
  AssignSubscriptionInput,
  CreatePlanInput,
  CreateTenantInput,
  UpdateTenantInput,
} from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { runUnscoped } from '../../common/context/request-context';
import { PrismaService, type PrismaTransaction } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';

/**
 * Platform administration (TZ §6).
 *
 * Every method here runs unscoped by design — this is the one part of the
 * system that legitimately spans tenants. Access is gated by
 * `@SuperAdminOnly()` on the controller, which is the only thing standing
 * between these queries and a tenant user.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Tenants                                                            */
  /* ------------------------------------------------------------------ */

  async list(query: {
    page?: number;
    limit?: number;
    status?: TenantStatus;
    search?: string;
  }): Promise<Paginated<Tenant>> {
    const page = normalizePagination(query);

    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await runUnscoped(() =>
      Promise.all([
        this.prisma.db.tenant.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: page.skip,
          take: page.take,
        }),
        this.prisma.db.tenant.count({ where }),
      ]),
    );

    return paginated(rows.map(toTenant), total, page);
  }

  async get(id: string): Promise<Tenant> {
    const row = await runUnscoped(() =>
      this.prisma.db.tenant.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) throw AppException.notFound('Restaurant', ErrorCode.TENANT_NOT_FOUND);
    return toTenant(row);
  }

  /**
   * Creates a company together with its first owner, in one transaction.
   *
   * The three are inseparable: a tenant with no owner cannot be logged into,
   * and system roles must exist before the owner can be given one. Doing this
   * in separate calls would leave half-provisioned companies behind whenever
   * the second call failed.
   */
  async create(input: CreateTenantInput): Promise<Tenant> {
    const slug = await this.nextTenantSlug(input.slug ?? input.name);

    const passwordHash = await this.passwords.hash(input.owner.password);

    const tenant = await runUnscoped(() =>
      this.prisma.transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: {
            name: input.name,
            slug,
            legalName: input.legalName ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            currency: input.currency,
            timezone: input.timezone,
            locale: input.locale,
            status: TenantStatus.TRIAL,
            ...(input.branding
              ? {
                  logoUrl: input.branding.logoUrl ?? null,
                  primaryColor: input.branding.primaryColor ?? '#FF6B00',
                  secondaryColor: input.branding.secondaryColor ?? '#1F2937',
                  domain: input.branding.domain ?? null,
                  companyName: input.branding.companyName ?? null,
                }
              : {}),
          },
        });

        // Seed this tenant's own copy of the system roles. Copies rather than
        // shared rows so an admin can later duplicate and tweak one without
        // affecting every other restaurant on the platform.
        const roleIdByCode = await seedSystemRoles(tx, created.id);

        const ownerRoleId = roleIdByCode.get(SystemRole.OWNER);
        if (!ownerRoleId) throw AppException.internal('Owner role was not seeded');

        await tx.user.create({
          data: {
            tenantId: created.id,
            phone: input.owner.phone,
            email: input.owner.email ?? null,
            passwordHash,
            fullName: input.owner.fullName,
            roles: { create: [{ roleId: ownerRoleId }] },
            employee: {
              create: {
                tenantId: created.id,
                position: 'Owner',
                hiredAt: new Date(),
              },
            },
          },
        });

        if (input.planId) {
          const plan = await tx.plan.findUnique({ where: { id: input.planId } });
          if (plan) {
            await tx.subscription.create({
              data: {
                tenantId: created.id,
                planId: plan.id,
                status: SubscriptionStatus.TRIAL,
                startsAt: new Date(),
                endsAt: new Date(Date.now() + plan.periodDays * 86_400_000),
                maxBranches: plan.maxBranches,
                maxEmployees: plan.maxEmployees,
                maxPosTerminals: plan.maxPosTerminals,
                maxBots: plan.maxBots,
                maxStorageMb: plan.maxStorageMb,
              },
            });
          }
        }

        return created;
      }),
    );

    await this.audit.record({
      action: 'TENANT_CREATED',
      entity: 'Tenant',
      entityId: tenant.id,
      tenantId: tenant.id,
      newValue: { name: tenant.name, slug: tenant.slug, ownerPhone: input.owner.phone },
    });

    return toTenant(tenant);
  }

  async update(id: string, input: UpdateTenantInput): Promise<Tenant> {
    const before = await this.get(id);

    const row = await runUnscoped(() =>
      this.prisma.db.tenant.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.branding
            ? {
                logoUrl: input.branding.logoUrl ?? undefined,
                faviconUrl: input.branding.faviconUrl ?? undefined,
                primaryColor: input.branding.primaryColor ?? undefined,
                secondaryColor: input.branding.secondaryColor ?? undefined,
                domain: input.branding.domain ?? undefined,
                companyName: input.branding.companyName ?? undefined,
              }
            : {}),
        },
      }),
    );

    const after = toTenant(row);
    await this.audit.recordChange(
      'TENANT_UPDATED',
      'Tenant',
      id,
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );

    return after;
  }

  /**
   * Blocks a tenant and ends every session belonging to it.
   *
   * Without the revocation, staff holding a valid access token would keep
   * working for up to its full TTL after the company was blocked.
   */
  async block(id: string, reason: string): Promise<Tenant> {
    const row = await runUnscoped(() =>
      this.prisma.db.tenant.update({
        where: { id },
        data: { status: TenantStatus.BLOCKED, blockedAt: new Date(), blockReason: reason },
      }),
    );

    const users = await runUnscoped(() =>
      this.prisma.db.user.findMany({ where: { tenantId: id }, select: { id: true } }),
    );
    await Promise.all(users.map((user) => this.tokens.revokeAllForUser(user.id)));

    await this.audit.record({
      action: AuditAction.TENANT_BLOCKED,
      entity: 'Tenant',
      entityId: id,
      tenantId: id,
      newValue: { reason, sessionsRevoked: users.length },
    });

    return toTenant(row);
  }

  async activate(id: string): Promise<Tenant> {
    const row = await runUnscoped(() =>
      this.prisma.db.tenant.update({
        where: { id },
        data: { status: TenantStatus.ACTIVE, blockedAt: null, blockReason: null },
      }),
    );

    await this.audit.record({
      action: AuditAction.TENANT_ACTIVATED,
      entity: 'Tenant',
      entityId: id,
      tenantId: id,
    });

    return toTenant(row);
  }

  /* ------------------------------------------------------------------ */
  /* Plans & subscriptions                                              */
  /* ------------------------------------------------------------------ */

  async listPlans(): Promise<Plan[]> {
    const rows = await runUnscoped(() =>
      this.prisma.db.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }] }),
    );
    return rows.map(toPlan);
  }

  async createPlan(input: CreatePlanInput): Promise<Plan> {
    const row = await runUnscoped(() =>
      this.prisma.db.plan.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          price: input.price,
          currency: input.currency,
          periodDays: input.periodDays,
          maxBranches: input.limits.maxBranches,
          maxEmployees: input.limits.maxEmployees,
          maxPosTerminals: input.limits.maxPosTerminals,
          maxBots: input.limits.maxBots,
          maxStorageMb: input.limits.maxStorageMb,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        },
      }),
    );

    await this.audit.record({
      action: 'PLAN_CREATED',
      entity: 'Plan',
      entityId: row.id,
      tenantId: null,
      newValue: { code: input.code, price: input.price },
    });

    return toPlan(row);
  }

  /**
   * Assigns or renews a tenant's subscription.
   *
   * The plan's limits are COPIED onto the subscription, so later repricing the
   * plan never silently re-limits a customer already paying under the old
   * terms. `limits` overrides individual values for a bespoke deal.
   */
  async assignSubscription(
    tenantId: string,
    input: AssignSubscriptionInput,
  ): Promise<Subscription> {
    const plan = await runUnscoped(() =>
      this.prisma.db.plan.findUnique({ where: { id: input.planId } }),
    );
    if (!plan) throw AppException.notFound('Plan');

    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const endsAt = input.endsAt
      ? new Date(input.endsAt)
      : new Date(startsAt.getTime() + plan.periodDays * 86_400_000);

    if (endsAt.getTime() <= startsAt.getTime()) {
      throw AppException.badRequest('The subscription must end after it starts');
    }

    const row = await runUnscoped(() =>
      this.prisma.transaction(async (tx) => {
        // Only one subscription may be current; older ones are closed out.
        await tx.subscription.updateMany({
          where: {
            tenantId,
            status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
          },
          data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
        });

        const created = await tx.subscription.create({
          data: {
            tenantId,
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            startsAt,
            endsAt,
            maxBranches: input.limits?.maxBranches ?? plan.maxBranches,
            maxEmployees: input.limits?.maxEmployees ?? plan.maxEmployees,
            maxPosTerminals: input.limits?.maxPosTerminals ?? plan.maxPosTerminals,
            maxBots: input.limits?.maxBots ?? plan.maxBots,
            maxStorageMb: input.limits?.maxStorageMb ?? plan.maxStorageMb,
          },
          include: { plan: true },
        });

        // A paying tenant should not stay in TRIAL.
        await tx.tenant.updateMany({
          where: { id: tenantId, status: TenantStatus.TRIAL },
          data: { status: TenantStatus.ACTIVE },
        });

        return created;
      }),
    );

    await this.audit.record({
      action: AuditAction.SUBSCRIPTION_CHANGED,
      entity: 'Subscription',
      entityId: row.id,
      tenantId,
      newValue: { planCode: plan.code, startsAt, endsAt },
    });

    return toSubscription(row);
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                          */
  /* ------------------------------------------------------------------ */

  async stats(): Promise<PlatformStats> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      totalCompanies,
      activeCompanies,
      blockedCompanies,
      totalBranches,
      totalOrders,
      gmvAggregate,
      monthlyAggregate,
      activeSubscriptions,
      expiredSubscriptions,
    ] = await runUnscoped(() =>
      Promise.all([
        this.prisma.db.tenant.count({ where: { deletedAt: null } }),
        this.prisma.db.tenant.count({ where: { deletedAt: null, status: TenantStatus.ACTIVE } }),
        this.prisma.db.tenant.count({ where: { deletedAt: null, status: TenantStatus.BLOCKED } }),
        this.prisma.db.branch.count({ where: { deletedAt: null } }),
        this.prisma.db.order.count(),
        // GMV counts delivered orders only: cancelled ones never took money.
        this.prisma.db.order.aggregate({
          where: { status: 'DELIVERED' },
          _sum: { total: true },
        }),
        this.prisma.db.order.aggregate({
          where: { status: 'DELIVERED', createdAt: { gte: monthStart } },
          _sum: { total: true },
        }),
        this.prisma.db.subscription.count({
          where: {
            status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
            endsAt: { gt: new Date() },
          },
        }),
        this.prisma.db.subscription.count({
          where: {
            OR: [{ status: SubscriptionStatus.EXPIRED }, { endsAt: { lte: new Date() } }],
          },
        }),
      ]),
    );

    return {
      totalCompanies,
      activeCompanies,
      blockedCompanies,
      totalBranches,
      totalOrders,
      gmv: gmvAggregate._sum.total ?? 0,
      monthlyRevenue: monthlyAggregate._sum.total ?? 0,
      activeSubscriptions,
      expiredSubscriptions,
    };
  }

  private async nextTenantSlug(source: string): Promise<string> {
    const existing = await runUnscoped(() =>
      this.prisma.db.tenant.findMany({ select: { slug: true } }),
    );
    return uniqueSlug(slugify(source), new Set(existing.map((row) => row.slug)));
  }
}

/* -------------------------------------------------------------------------- */
/* Seeding helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Creates this tenant's copies of the system roles.
 *
 * Exported so the database seed can reuse exactly the same logic — two
 * implementations of "what does OWNER mean" would drift apart immediately.
 */
export async function seedSystemRoles(
  tx: PrismaTransaction,
  tenantId: string,
): Promise<Map<string, string>> {
  const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
  const permissionIdByCode = new Map(permissions.map((row) => [row.code, row.id]));

  const result = new Map<string, string>();

  for (const [code, granted] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = await tx.role.create({
      data: {
        tenantId,
        code,
        name: humanizeRoleCode(code),
        isSystem: true,
        permissions: {
          create: granted
            .map((permission) => permissionIdByCode.get(permission))
            .filter((id): id is string => Boolean(id))
            .map((permissionId) => ({ permissionId })),
        },
      },
      select: { id: true, code: true },
    });

    result.set(role.code, role.id);
  }

  return result;
}

/** Ensures the global permission catalog matches the shared source of truth. */
export async function syncPermissionCatalog(tx: PrismaTransaction): Promise<number> {
  const { PERMISSION_GROUPS } = await import('@restor/shared-types');

  const groupOf = (code: string): string => {
    for (const [group, list] of Object.entries(PERMISSION_GROUPS)) {
      if ((list as readonly string[]).includes(code)) return group;
    }
    return 'Other';
  };

  let created = 0;
  for (const code of ALL_PERMISSIONS) {
    const result = await tx.permission.upsert({
      where: { code },
      create: { code, group: groupOf(code) },
      update: { group: groupOf(code) },
      select: { id: true },
    });
    if (result) created += 1;
  }

  return created;
}

function humanizeRoleCode(code: string): string {
  return code
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

/* -------------------------------------------------------------------------- */
/* Mappers                                                                    */
/* -------------------------------------------------------------------------- */

type TenantRow = Prisma.TenantGetPayload<object>;

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as TenantStatus,
    legalName: row.legalName,
    phone: row.phone,
    email: row.email,
    currency: row.currency,
    timezone: row.timezone,
    locale: row.locale,
    branding: {
      logoUrl: row.logoUrl,
      faviconUrl: row.faviconUrl,
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
      domain: row.domain,
      companyName: row.companyName,
      // The token itself is never serialised — only whether one exists.
      hasCustomBot: false,
    },
    blockedAt: row.blockedAt?.toISOString() ?? null,
    blockReason: row.blockReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPlan(row: Prisma.PlanGetPayload<object>): Plan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    price: row.price,
    currency: row.currency,
    periodDays: row.periodDays,
    limits: {
      maxBranches: row.maxBranches,
      maxEmployees: row.maxEmployees,
      maxPosTerminals: row.maxPosTerminals,
      maxBots: row.maxBots,
      maxStorageMb: row.maxStorageMb,
    },
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSubscription(
  row: Prisma.SubscriptionGetPayload<{ include: { plan: true } }>,
): Subscription {
  return {
    id: row.id,
    tenantId: row.tenantId,
    planId: row.planId,
    plan: toPlan(row.plan),
    status: row.status as SubscriptionStatus,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    limits: {
      maxBranches: row.maxBranches,
      maxEmployees: row.maxEmployees,
      maxPosTerminals: row.maxPosTerminals,
      maxBots: row.maxBots,
      maxStorageMb: row.maxStorageMb,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
