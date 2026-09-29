import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import {
  CourierStatus,
  DeliveryStatus,
  DomainEvent,
  ErrorCode,
  OrderStatus,
  OrderType,
  SystemRole,
  type Courier,
  type Paginated,
} from '@restor/shared-types';
import { distanceMeters, normalizePagination, paginated } from '@restor/shared-utils';
import type { AssignDeliveryInput, CreateCourierInput, UpdateCourierInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { OrdersService } from '../orders/orders.service';
import { CourierWalletService } from './courier-wallet.service';

const COURIER_INCLUDE = {
  user: { select: { fullName: true, phone: true } },
  wallet: true,
} as const;

type CourierRow = Prisma.CourierGetPayload<{ include: typeof COURIER_INCLUDE }>;

/**
 * Courier management and delivery assignment (TZ §23, §24).
 *
 * A courier is a `User` (credentials, COURIER role) plus a `Courier` row
 * (vehicle, branch, status) plus a `CourierWallet`. All three are created in
 * one transaction — any one missing makes the app unusable in a way that is
 * hard to diagnose later.
 */
@Injectable()
export class CouriersService {
  private readonly logger = new Logger(CouriersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly wallet: CourierWalletService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly branchScope: BranchScope,
  ) {}

  /* ------------------------------------------------------------------ */
  /* CRUD                                                               */
  /* ------------------------------------------------------------------ */

  async list(query: {
    page?: number;
    limit?: number;
    branchId?: string;
    status?: CourierStatus;
    isActive?: boolean;
    search?: string;
  }): Promise<Paginated<Courier>> {
    const page = normalizePagination(query);
    const branchFilter = this.branchScope.filterFor(query.branchId);

    const where: Prisma.CourierWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(branchFilter ? { branchId: branchFilter as Prisma.CourierWhereInput['branchId'] } : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search } },
              ],
            },
          }
        : {}),
    };

    const [rows, total, activeCounts] = await Promise.all([
      this.prisma.db.courier.findMany({
        where,
        include: COURIER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.courier.count({ where }),
      // One grouped query rather than N per-courier counts.
      this.prisma.db.delivery.groupBy({
        by: ['courierId'],
        where: {
          status: { in: [DeliveryStatus.ASSIGNED, DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP] },
        },
        _count: { _all: true },
      }),
    ]);

    const activeByCourier = new Map(
      activeCounts.map((entry) => [entry.courierId, entry._count._all]),
    );

    return paginated(
      rows.map((row) => toCourier(row, activeByCourier.get(row.id) ?? 0)),
      total,
      page,
    );
  }

  async get(id: string): Promise<Courier> {
    const row = await this.prisma.db.courier.findFirst({
      where: { id, deletedAt: null },
      include: COURIER_INCLUDE,
    });
    if (!row) throw AppException.notFound('Courier', ErrorCode.COURIER_NOT_FOUND);

    const active = await this.prisma.db.delivery.count({
      where: {
        courierId: id,
        status: { in: [DeliveryStatus.ASSIGNED, DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP] },
      },
    });

    return toCourier(row, active);
  }

  /** Live positions for the dispatcher map. Only couriers actually on shift. */
  async liveLocations(branchId?: string): Promise<Courier[]> {
    const branchFilter = this.branchScope.filterFor(branchId);

    const rows = await this.prisma.db.courier.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { not: CourierStatus.OFFLINE },
        lastLocationAt: { not: null },
        ...(branchFilter ? { branchId: branchFilter as Prisma.CourierWhereInput['branchId'] } : {}),
      },
      include: COURIER_INCLUDE,
    });

    return rows.map((row) => toCourier(row, 0));
  }

  async create(input: CreateCourierInput): Promise<Courier> {
    const tenantId = this.requireTenant();
    if (input.branchId) this.branchScope.assertCanAccess(input.branchId);

    const duplicate = await this.prisma.db.user.findFirst({
      where: { tenantId, phone: input.phone, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.conflict('Bu telefon raqam bilan xodim allaqachon mavjud');
    }

    const courierRole = await this.prisma.db.role.findFirst({
      where: { tenantId, code: SystemRole.COURIER, deletedAt: null },
      select: { id: true },
    });
    if (!courierRole) {
      throw AppException.internal('COURIER roli topilmadi — db:sync-roles ishga tushiring');
    }

    const passwordHash = await this.passwords.hash(input.password);

    const row = await this.prisma.transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          phone: input.phone,
          email: input.email ?? null,
          passwordHash,
          fullName: input.fullName,
          roles: {
            create: input.branchId
              ? [{ roleId: courierRole.id, branchId: input.branchId }]
              : [{ roleId: courierRole.id }],
          },
        },
      });

      return tx.courier.create({
        data: {
          tenantId,
          userId: user.id,
          branchId: input.branchId ?? null,
          vehicleType: input.vehicleType,
          status: CourierStatus.OFFLINE,
          // Created here so no later code has to handle a missing wallet.
          wallet: { create: {} },
        },
        include: COURIER_INCLUDE,
      });
    });

    await this.audit.record({
      action: 'COURIER_CREATED',
      entity: 'Courier',
      entityId: row.id,
      newValue: { fullName: input.fullName, phone: input.phone, branchId: input.branchId },
    });

    return toCourier(row, 0);
  }

  async update(id: string, input: UpdateCourierInput): Promise<Courier> {
    const before = await this.get(id);
    if (input.branchId) this.branchScope.assertCanAccess(input.branchId);

    const passwordHash = input.password ? await this.passwords.hash(input.password) : null;

    const row = await this.prisma.transaction(async (tx) => {
      const courier = await tx.courier.findFirstOrThrow({
        where: { id },
        select: { userId: true },
      });

      if (input.fullName || input.phone || passwordHash || input.isActive !== undefined) {
        await tx.user.update({
          where: { id: courier.userId },
          data: {
            ...(input.fullName ? { fullName: input.fullName } : {}),
            ...(input.phone ? { phone: input.phone } : {}),
            ...(passwordHash ? { passwordHash } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
      }

      return tx.courier.update({
        where: { id },
        data: {
          ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
          ...(input.vehicleType ? { vehicleType: input.vehicleType } : {}),
          ...(input.isActive !== undefined
            ? {
                isActive: input.isActive,
                // Deactivating must also take them off the dispatch board.
                ...(input.isActive === false ? { status: CourierStatus.OFFLINE } : {}),
              }
            : {}),
        },
        include: COURIER_INCLUDE,
      });
    });

    // Permissions live in the access token, so a change has to end the session.
    if (input.password || input.isActive === false || input.branchId !== undefined) {
      await this.tokens.revokeAllForUser(row.userId);
    }

    await this.audit.recordChange(
      'COURIER_UPDATED',
      'Courier',
      id,
      { isActive: before.isActive, branchId: before.branchId, vehicleType: before.vehicleType },
      { isActive: row.isActive, branchId: row.branchId, vehicleType: row.vehicleType },
    );

    return toCourier(row, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Assignment (TZ §24)                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Assigns a courier to an order's delivery.
   *
   * Refuses when the courier is offline or the order is not ready to travel —
   * a dispatcher assigning a job to someone who has gone home produces a
   * delivery nobody is looking at.
   */
  async assignToOrder(orderId: string, input: AssignDeliveryInput) {
    const order = await this.prisma.db.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        type: true,
        status: true,
        displayNumber: true,
        deliveryFee: true,
        branch: { select: { latitude: true, longitude: true } },
        addressLatitude: true,
        addressLongitude: true,
        delivery: { select: { id: true, status: true } },
      },
    });
    if (!order) throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);

    this.branchScope.assertCanAccess(order.branchId);

    if (order.type !== OrderType.DELIVERY) {
      throw AppException.badRequest('Faqat yetkazib berish buyurtmasiga kuryer biriktiriladi');
    }
    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.DELIVERED ||
      order.status === OrderStatus.REFUNDED
    ) {
      throw AppException.conflict(`Buyurtma holati ${order.status} — kuryer biriktirib boʻlmaydi`);
    }

    const courier = await this.prisma.db.courier.findFirst({
      where: { id: input.courierId, deletedAt: null, isActive: true },
      include: { user: { select: { fullName: true } } },
    });
    if (!courier) throw AppException.notFound('Courier', ErrorCode.COURIER_NOT_FOUND);

    if (courier.status === CourierStatus.OFFLINE) {
      throw new AppException(
        ErrorCode.COURIER_UNAVAILABLE,
        'Kuryer oflayn — unga buyurtma biriktirib boʻlmaydi',
        409,
      );
    }

    // Straight-line distance, used for the courier fee and for the dispatcher's
    // sense of the job. Real driving distance is always longer; this is
    // deliberately the conservative estimate.
    const distanceM =
      order.branch.latitude != null &&
      order.branch.longitude != null &&
      order.addressLatitude != null &&
      order.addressLongitude != null
        ? distanceMeters(
            { latitude: order.branch.latitude, longitude: order.branch.longitude },
            { latitude: order.addressLatitude, longitude: order.addressLongitude },
          )
        : null;

    const courierFee = input.courierFee ?? order.deliveryFee;
    const now = new Date();

    const delivery = await this.prisma.transaction(async (tx) => {
      const data = {
        courierId: input.courierId,
        status: DeliveryStatus.ASSIGNED,
        assignedAt: now,
        courierFee,
        distanceM,
        // A re-assignment starts the courier's clock again.
        acceptedAt: null,
        pickedUpAt: null,
        failedAt: null,
        failureReason: null,
      };

      const row = order.delivery
        ? await tx.delivery.update({ where: { id: order.delivery.id }, data })
        : await tx.delivery.create({
            data: {
              tenantId: order.tenantId,
              branchId: order.branchId,
              orderId: order.id,
              customerFee: order.deliveryFee,
              ...data,
            },
          });

      await tx.order.update({ where: { id: orderId }, data: { courierId: input.courierId } });
      return row;
    });

    // READY/WAITING_COURIER → COURIER_ASSIGNED. Tolerated if the order has
    // already moved past that point.
    await this.orders
      .updateStatus(orderId, {
        status: OrderStatus.COURIER_ASSIGNED,
        comment: `Kuryer: ${courier.user.fullName}`,
      })
      .catch(() => undefined);

    this.events.emit(DomainEvent.COURIER_ASSIGNED, {
      tenantId: order.tenantId,
      branchId: order.branchId,
      requestId: getContext()?.requestId ?? null,
      actorUserId: getContext()?.userId ?? null,
      occurredAt: now.toISOString(),
      orderId,
      displayNumber: order.displayNumber,
      deliveryId: delivery.id,
      courierId: input.courierId,
      courierName: courier.user.fullName,
    });

    await this.audit.record({
      action: 'COURIER_ASSIGNED',
      entity: 'Delivery',
      entityId: delivery.id,
      newValue: {
        orderId,
        courierId: input.courierId,
        courierName: courier.user.fullName,
        courierFee,
        distanceM,
      },
    });

    return this.orders.get(orderId);
  }

  /**
   * Suggests couriers for an order, nearest first.
   *
   * A suggestion, not an auto-assignment: the dispatcher knows things the
   * database does not — who is about to finish, whose scooter is low on fuel.
   */
  async suggestForOrder(orderId: string): Promise<Array<Courier & { distanceM?: number }>> {
    const order = await this.prisma.db.order.findFirst({
      where: { id: orderId },
      select: {
        branchId: true,
        addressLatitude: true,
        addressLongitude: true,
        branch: { select: { latitude: true, longitude: true } },
      },
    });
    if (!order) throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);

    const rows = await this.prisma.db.courier.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { in: [CourierStatus.AVAILABLE, CourierStatus.ON_DELIVERY] },
        OR: [{ branchId: order.branchId }, { branchId: null }],
      },
      include: COURIER_INCLUDE,
    });

    const activeCounts = await this.prisma.db.delivery.groupBy({
      by: ['courierId'],
      where: {
        courierId: { in: rows.map((row) => row.id) },
        status: { in: [DeliveryStatus.ASSIGNED, DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP] },
      },
      _count: { _all: true },
    });
    const activeByCourier = new Map(
      activeCounts.map((entry) => [entry.courierId, entry._count._all]),
    );

    // Measure from the branch when the order has no coordinates — the courier
    // has to collect the food there either way.
    const origin =
      order.addressLatitude != null && order.addressLongitude != null
        ? { latitude: order.addressLatitude, longitude: order.addressLongitude }
        : order.branch.latitude != null && order.branch.longitude != null
          ? { latitude: order.branch.latitude, longitude: order.branch.longitude }
          : null;

    return rows
      .map((row) => {
        const courier = toCourier(row, activeByCourier.get(row.id) ?? 0);
        const distanceM =
          origin && row.lastLatitude != null && row.lastLongitude != null
            ? distanceMeters(origin, {
                latitude: row.lastLatitude,
                longitude: row.lastLongitude,
              })
            : undefined;
        return { ...courier, ...(distanceM !== undefined ? { distanceM } : {}) };
      })
      .sort((a, b) => {
        // Idle couriers first, then by distance.
        const byLoad = (a.activeDeliveryCount ?? 0) - (b.activeDeliveryCount ?? 0);
        if (byLoad !== 0) return byLoad;
        return (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity);
      });
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('No restaurant is in scope');
    return tenantId;
  }
}

/* -------------------------------------------------------------------------- */

function toCourier(row: CourierRow, activeDeliveryCount: number): Courier {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    branchId: row.branchId,
    fullName: row.user.fullName,
    phone: row.user.phone,
    status: row.status as CourierStatus,
    vehicleType: row.vehicleType,
    isActive: row.isActive,
    lastLocation:
      row.lastLatitude != null && row.lastLongitude != null && row.lastLocationAt
        ? {
            latitude: row.lastLatitude,
            longitude: row.lastLongitude,
            accuracyM: null,
            headingDeg: null,
            speedMps: null,
            recordedAt: row.lastLocationAt.toISOString(),
          }
        : null,
    wallet: row.wallet
      ? {
          id: row.wallet.id,
          courierId: row.wallet.courierId,
          cashReceived: row.wallet.cashReceived,
          deliveryIncome: row.wallet.deliveryIncome,
          expenses: row.wallet.expenses,
          cashHandedOver: row.wallet.cashHandedOver,
          balance: row.wallet.balance,
          createdAt: row.wallet.createdAt.toISOString(),
          updatedAt: row.wallet.updatedAt.toISOString(),
        }
      : undefined,
    activeDeliveryCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
