import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ErrorCode,
  type Branch,
  type BranchSummary,
  type Paginated,
  type Weekday,
} from '@restor/shared-types';
import {
  deriveBranchPrefix,
  distanceMeters,
  isOpenAt,
  normalizePagination,
  paginated,
  uniqueSlug,
} from '@restor/shared-utils';
import type { CreateBranchInput, UpdateBranchInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionLimitsService } from '../subscriptions/subscription-limits.service';

const BRANCH_INCLUDE = {
  workingHours: { orderBy: { dayOfWeek: 'asc' } },
} as const;

type BranchRow = Prisma.BranchGetPayload<{ include: typeof BRANCH_INCLUDE }>;

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: SubscriptionLimitsService,
    private readonly branchScope: BranchScope,
  ) {}

  async list(query: {
    page?: number;
    limit?: number;
    isActive?: boolean;
    search?: string;
  }): Promise<Paginated<Branch>> {
    const page = normalizePagination(query);
    const scopeFilter = this.branchScope.filterFor();

    const where: Prisma.BranchWhereInput = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(scopeFilter ? { id: scopeFilter } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { address: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.branch.findMany({
        where,
        include: BRANCH_INCLUDE,
        orderBy: { name: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.branch.count({ where }),
    ]);

    return paginated(rows.map(toBranch), total, page);
  }

  /**
   * Lightweight list for branch pickers.
   *
   * When the caller sends coordinates the result is sorted by distance, which
   * is what the customer app wants — "which branch is nearest me".
   */
  async summaries(query: { latitude?: number; longitude?: number }): Promise<BranchSummary[]> {
    const rows = await this.prisma.db.branch.findMany({
      where: { deletedAt: null, isActive: true },
      include: BRANCH_INCLUDE,
      orderBy: { name: 'asc' },
    });

    const hasOrigin = query.latitude !== undefined && query.longitude !== undefined;

    const summaries = rows.map((row) => {
      const distanceM =
        hasOrigin && row.latitude !== null && row.longitude !== null
          ? distanceMeters(
              { latitude: query.latitude!, longitude: query.longitude! },
              { latitude: row.latitude, longitude: row.longitude },
            )
          : undefined;

      return {
        id: row.id,
        name: row.name,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        isActive: row.isActive,
        isOpenNow: isBranchOpen(row),
        deliveryPrice: row.deliveryPrice,
        minOrderAmount: row.minOrderAmount,
        ...(distanceM !== undefined ? { distanceM } : {}),
      } satisfies BranchSummary;
    });

    if (hasOrigin) {
      // Branches without coordinates sink to the bottom rather than disappear.
      summaries.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    }

    return summaries;
  }

  async get(id: string): Promise<Branch> {
    this.branchScope.assertCanAccess(id);

    const row = await this.prisma.db.branch.findFirst({
      where: { id, deletedAt: null },
      include: BRANCH_INCLUDE,
    });

    if (!row) throw AppException.notFound('Branch', ErrorCode.BRANCH_NOT_FOUND);
    return toBranch(row);
  }

  async create(input: CreateBranchInput): Promise<Branch> {
    const tenantId = this.requireTenant();

    // The plan's branch limit is enforced here, not in the UI (TZ §6).
    await this.limits.assertCanAddBranch(tenantId);

    const slug = await this.nextSlug(input.name);

    const row = await this.prisma.db.branch.create({
      data: {
        // Passed explicitly as well as injected by the scoping extension:
        // Prisma's types require the FK, and the extension rejects a mismatch.
        tenantId,
        name: input.name,
        slug,
        address: input.address,
        phone: input.phone ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        deliveryRadiusM: input.deliveryRadiusM,
        minOrderAmount: input.minOrderAmount,
        deliveryPrice: input.deliveryPrice,
        averagePrepMinutes: input.averagePrepMinutes,
        timezone: input.timezone,
        acceptsDelivery: input.acceptsDelivery,
        acceptsPickup: input.acceptsPickup,
        acceptsDineIn: input.acceptsDineIn,
        orderPrefix: deriveBranchPrefix(input.name),
        workingHours: input.workingHours?.length
          ? {
              create: input.workingHours.map((hours) => ({
                dayOfWeek: hours.dayOfWeek,
                opensAt: hours.opensAt,
                closesAt: hours.closesAt,
                isClosed: hours.isClosed,
              })),
            }
          : { create: defaultWorkingHours() },
      },
      include: BRANCH_INCLUDE,
    });

    await this.audit.record({
      action: 'BRANCH_CREATED',
      entity: 'Branch',
      entityId: row.id,
      newValue: { name: row.name, address: row.address },
    });

    return toBranch(row);
  }

  async update(id: string, input: UpdateBranchInput): Promise<Branch> {
    const before = await this.get(id);

    const row = await this.prisma.transaction(async (tx) => {
      if (input.workingHours) {
        // Replaced wholesale — the editor always submits the full week.
        await tx.branchWorkingHours.deleteMany({ where: { branchId: id } });
        await tx.branchWorkingHours.createMany({
          data: input.workingHours.map((hours) => ({
            branchId: id,
            dayOfWeek: hours.dayOfWeek,
            opensAt: hours.opensAt,
            closesAt: hours.closesAt,
            isClosed: hours.isClosed,
          })),
        });
      }

      return tx.branch.update({
        where: { id },
        data: {
          ...pick(input, [
            'name',
            'address',
            'phone',
            'latitude',
            'longitude',
            'deliveryRadiusM',
            'minOrderAmount',
            'deliveryPrice',
            'averagePrepMinutes',
            'timezone',
            'acceptsDelivery',
            'acceptsPickup',
            'acceptsDineIn',
            'isActive',
          ]),
        },
        include: BRANCH_INCLUDE,
      });
    });

    const after = toBranch(row);
    await this.audit.recordChange(
      'BRANCH_UPDATED',
      'Branch',
      id,
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );

    return after;
  }

  /**
   * Soft-deletes a branch.
   *
   * Hard deletion would orphan every order, shift and payment that references
   * it, so the row stays and is simply excluded from every list.
   */
  async remove(id: string): Promise<void> {
    const branch = await this.get(id);

    const openOrders = await this.prisma.db.order.count({
      where: {
        branchId: id,
        status: { notIn: ['DELIVERED', 'CANCELLED', 'REFUNDED'] },
      },
    });

    if (openOrders > 0) {
      throw AppException.conflict(
        `${openOrders} order(s) are still open at this branch. Close them first.`,
      );
    }

    await this.prisma.db.branch.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      action: 'BRANCH_DELETED',
      entity: 'Branch',
      entityId: id,
      oldValue: { name: branch.name },
    });
  }

  /** Used by the order service to validate delivery against branch settings. */
  async findForOrdering(branchId: string): Promise<BranchRow> {
    const row = await this.prisma.db.branch.findFirst({
      where: { id: branchId, deletedAt: null, isActive: true },
      include: BRANCH_INCLUDE,
    });

    if (!row) throw AppException.notFound('Branch', ErrorCode.BRANCH_NOT_FOUND);
    return row;
  }

  private async nextSlug(name: string): Promise<string> {
    const existing = await this.prisma.db.branch.findMany({ select: { slug: true } });
    return uniqueSlug(name, new Set(existing.map((row) => row.slug)));
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) {
      throw AppException.badRequest('A branch belongs to a restaurant; none is in scope');
    }
    return tenantId;
  }
}

export function isBranchOpen(row: {
  timezone: string;
  workingHours: Array<{ dayOfWeek: number; opensAt: string; closesAt: string; isClosed: boolean }>;
}): boolean {
  if (row.workingHours.length === 0) return true; // No schedule configured = always open.
  return isOpenAt(
    row.workingHours.map((hours) => ({ ...hours, dayOfWeek: hours.dayOfWeek as Weekday })),
    row.timezone,
  );
}

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    slug: row.slug,
    address: row.address,
    phone: row.phone,
    latitude: row.latitude,
    longitude: row.longitude,
    deliveryRadiusM: row.deliveryRadiusM,
    minOrderAmount: row.minOrderAmount,
    deliveryPrice: row.deliveryPrice,
    averagePrepMinutes: row.averagePrepMinutes,
    timezone: row.timezone,
    isActive: row.isActive,
    acceptsDelivery: row.acceptsDelivery,
    acceptsPickup: row.acceptsPickup,
    acceptsDineIn: row.acceptsDineIn,
    isOpenNow: isBranchOpen(row),
    workingHours: row.workingHours.map((hours) => ({
      id: hours.id,
      branchId: hours.branchId,
      dayOfWeek: hours.dayOfWeek as Weekday,
      opensAt: hours.opensAt,
      closesAt: hours.closesAt,
      isClosed: hours.isClosed,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Sensible default for a fast food branch: open every day, 09:00–23:00. */
function defaultWorkingHours() {
  return Array.from({ length: 7 }, (_, index) => ({
    dayOfWeek: index + 1,
    opensAt: '09:00',
    closesAt: '23:00',
    isClosed: false,
  }));
}

/**
 * Copies only the listed keys that are actually present.
 *
 * Returns `{ [P in K]?: T[P] }` rather than `Partial<T>`: the wider type would
 * claim every field of the input might be present, which makes Prisma reject
 * the object because of keys (like `workingHours`) that are handled separately.
 */
function pick<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): { [P in K]?: T[P] } {
  const out: { [P in K]?: T[P] } = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}
