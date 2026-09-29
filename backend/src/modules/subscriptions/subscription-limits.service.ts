import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  SubscriptionStatus,
  type PlanLimits,
  type SubscriptionUsage,
} from '@restor/shared-types';
import { AppException } from '../../common/errors/app-exception';
import { runUnscoped } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';

/**
 * Enforces the plan's limits (TZ §6).
 *
 * Checked server-side on every create, because the admin UI hiding a button is
 * a hint, not a control — a direct API call must fail the same way.
 *
 * A tenant with NO subscription row is treated as unlimited rather than
 * blocked: that is the state of a freshly seeded development tenant, and
 * failing it closed would make the platform unusable out of the box. Billing
 * assigns a plan; absence of one is not a downgrade.
 */
@Injectable()
export class SubscriptionLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanAddBranch(tenantId: string): Promise<void> {
    await this.assertUnder(tenantId, 'maxBranches', 'branches', () =>
      this.prisma.db.branch.count({ where: { tenantId, deletedAt: null } }),
    );
  }

  async assertCanAddEmployee(tenantId: string): Promise<void> {
    await this.assertUnder(tenantId, 'maxEmployees', 'employees', () =>
      this.prisma.db.employee.count({ where: { tenantId, deletedAt: null, isActive: true } }),
    );
  }

  async assertCanAddPosTerminal(tenantId: string): Promise<void> {
    await this.assertUnder(tenantId, 'maxPosTerminals', 'POS terminals', () =>
      this.prisma.db.cashRegister.count({ where: { tenantId, isActive: true } }),
    );
  }

  async assertCanAddBot(tenantId: string): Promise<void> {
    await this.assertUnder(tenantId, 'maxBots', 'Telegram bots', () =>
      this.prisma.db.telegramConfig.count({
        where: { tenantId, botTokenEncrypted: { not: null } },
      }),
    );
  }

  /** Current usage against the plan, for the super-admin limits screen. */
  async usage(tenantId: string): Promise<SubscriptionUsage> {
    const [branches, employees, posTerminals, bots, storage] = await runUnscoped(() =>
      Promise.all([
        this.prisma.db.branch.count({ where: { tenantId, deletedAt: null } }),
        this.prisma.db.employee.count({ where: { tenantId, deletedAt: null, isActive: true } }),
        this.prisma.db.cashRegister.count({ where: { tenantId, isActive: true } }),
        this.prisma.db.telegramConfig.count({
          where: { tenantId, botTokenEncrypted: { not: null } },
        }),
        this.prisma.db.fileAsset.aggregate({
          where: { tenantId },
          _sum: { sizeBytes: true },
        }),
      ]),
    );

    return {
      branches,
      employees,
      posTerminals,
      bots,
      storageMb: Math.round((storage._sum.sizeBytes ?? 0) / (1024 * 1024)),
    };
  }

  /**
   * The limits in force for a tenant.
   *
   * Reads the SUBSCRIPTION's frozen copy, not the plan's current values, so
   * repricing a plan never silently re-limits an existing customer.
   */
  async limitsFor(tenantId: string): Promise<PlanLimits | null> {
    const subscription = await runUnscoped(() =>
      this.prisma.db.subscription.findFirst({
        where: {
          tenantId,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
          endsAt: { gt: new Date() },
        },
        orderBy: { endsAt: 'desc' },
      }),
    );

    if (!subscription) return null;

    return {
      maxBranches: subscription.maxBranches,
      maxEmployees: subscription.maxEmployees,
      maxPosTerminals: subscription.maxPosTerminals,
      maxBots: subscription.maxBots,
      maxStorageMb: subscription.maxStorageMb,
    };
  }

  /** Throws when the tenant's subscription has lapsed. */
  async assertSubscriptionActive(tenantId: string): Promise<void> {
    const subscription = await runUnscoped(() =>
      this.prisma.db.subscription.findFirst({
        where: { tenantId },
        orderBy: { endsAt: 'desc' },
        select: { status: true, endsAt: true },
      }),
    );

    // No subscription at all: see the class comment — treated as unlimited.
    if (!subscription) return;

    const expired =
      subscription.endsAt.getTime() <= Date.now() ||
      subscription.status === SubscriptionStatus.EXPIRED ||
      subscription.status === SubscriptionStatus.CANCELLED;

    if (expired) {
      throw new AppException(
        ErrorCode.SUBSCRIPTION_EXPIRED,
        'This restaurant’s subscription has expired. Renew it to continue.',
        402,
      );
    }
  }

  private async assertUnder(
    tenantId: string,
    limitKey: keyof PlanLimits,
    label: string,
    count: () => Promise<number>,
  ): Promise<void> {
    const limits = await this.limitsFor(tenantId);
    const limit = limits?.[limitKey];

    if (limit === null || limit === undefined) return;

    const current = await runUnscoped(count);

    if (current >= limit) {
      throw new AppException(
        ErrorCode.SUBSCRIPTION_LIMIT_REACHED,
        `Your plan allows ${limit} ${label}. Upgrade to add more.`,
        402,
        { [limitKey]: [`Limit of ${limit} reached`] },
      );
    }
  }
}
