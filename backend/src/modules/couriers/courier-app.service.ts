import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CourierStatus,
  CourierTransactionType,
  DeliveryStatus,
  DomainEvent,
  ErrorCode,
  OrderStatus,
  PaymentStatus,
  type CourierJob,
  type CourierProfile,
} from '@restor/shared-types';
import { startOfDayInZone } from '@restor/shared-utils';
import type {
  CompleteDeliveryInput,
  ReportLocationInput,
  UpdateCourierProfileInput,
} from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import { CourierWalletService } from './courier-wallet.service';

const JOB_INCLUDE = {
  order: {
    select: {
      id: true,
      displayNumber: true,
      total: true,
      paidTotal: true,
      paymentStatus: true,
      customerName: true,
      customerPhone: true,
      comment: true,
      addressText: true,
      addressApartment: true,
      addressLatitude: true,
      addressLongitude: true,
      items: { select: { name: true, quantity: true } },
    },
  },
  branch: {
    select: { name: true, address: true, latitude: true, longitude: true },
  },
} as const;

/**
 * The courier app's own surface (TZ §23-§26).
 *
 * The rule that shapes every method here: **the courier id comes from the
 * JWT, never from the request**. The app has no way to name another courier,
 * so a tampered client cannot read or move someone else's job.
 *
 * Delivery status transitions are also what make the money safe. Crediting
 * the wallet happens only on PICKED_UP → DELIVERED, so a retry on a flaky
 * connection finds the delivery already DELIVERED and returns without
 * crediting twice.
 */
@Injectable()
export class CourierAppService {
  private readonly logger = new Logger(CourierAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: CourierWalletService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Jobs                                                               */
  /* ------------------------------------------------------------------ */

  /** Deliveries assigned to the signed-in courier that are not finished. */
  async myJobs(): Promise<CourierJob[]> {
    const courierId = this.requireCourier();

    const rows = await this.prisma.db.delivery.findMany({
      where: {
        courierId,
        status: {
          in: [DeliveryStatus.ASSIGNED, DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP],
        },
      },
      include: JOB_INCLUDE,
      orderBy: { assignedAt: 'asc' },
    });

    return rows.map(toJob);
  }

  async myJob(deliveryId: string): Promise<CourierJob> {
    return toJob(await this.loadOwnDelivery(deliveryId));
  }

  /** ASSIGNED → ACCEPTED. The courier has seen the job and taken it. */
  async accept(deliveryId: string): Promise<CourierJob> {
    const delivery = await this.loadOwnDelivery(deliveryId);

    if (delivery.status === DeliveryStatus.ACCEPTED) return toJob(delivery);
    this.assertTransition(delivery.status, DeliveryStatus.ASSIGNED);

    const row = await this.prisma.db.delivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.ACCEPTED, acceptedAt: new Date() },
      include: JOB_INCLUDE,
    });

    this.emitStatus(row.tenantId, row.branchId, deliveryId, delivery.status, row.status, row.courierId);
    return toJob(row);
  }

  /**
   * ACCEPTED → PICKED_UP, and the order moves to ON_DELIVERY.
   *
   * The courier has the food and is leaving the branch.
   */
  async start(deliveryId: string): Promise<CourierJob> {
    const delivery = await this.loadOwnDelivery(deliveryId);

    if (delivery.status === DeliveryStatus.PICKED_UP) return toJob(delivery);
    this.assertTransition(delivery.status, DeliveryStatus.ACCEPTED);

    const row = await this.prisma.db.delivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.PICKED_UP, pickedUpAt: new Date() },
      include: JOB_INCLUDE,
    });

    await this.syncCourierStatus(delivery.courierId!, CourierStatus.ON_DELIVERY);
    await this.nudgeOrder(row.orderId, OrderStatus.ON_DELIVERY);

    this.emitStatus(row.tenantId, row.branchId, deliveryId, delivery.status, row.status, row.courierId);
    return toJob(row);
  }

  /**
   * PICKED_UP → DELIVERED, crediting any cash collected at the door.
   *
   * Idempotent by construction: a second call sees DELIVERED and returns
   * without touching the wallet, so a retry on a dropped connection cannot
   * double-credit.
   */
  async complete(deliveryId: string, input: CompleteDeliveryInput): Promise<CourierJob> {
    const delivery = await this.loadOwnDelivery(deliveryId);

    if (delivery.status === DeliveryStatus.DELIVERED) return toJob(delivery);
    this.assertTransition(delivery.status, DeliveryStatus.PICKED_UP);

    const owed = Math.max(0, delivery.order.total - delivery.order.paidTotal);
    const collected = input.collectedCash ?? 0;

    // The app sends what it thinks is owed; the server checks it against the
    // order. Accepting the client's number would let a courier under-declare.
    if (collected > owed) {
      throw AppException.badRequest(
        `Bu buyurtma boʻyicha ${owed} olinishi kerak, ${collected} emas`,
      );
    }
    if (owed > 0 && collected === 0) {
      throw new AppException(
        ErrorCode.PAYMENT_AMOUNT_MISMATCH,
        `Buyurtma toʻlanmagan — ${owed} olinishi kerak`,
        422,
      );
    }

    const walletId = (await this.wallet.ensureWallet(delivery.courierId!)).id;
    const now = new Date();

    const row = await this.prisma.transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.DELIVERED, deliveredAt: now },
        include: JOB_INCLUDE,
      });

      if (collected > 0) {
        await this.wallet.recordMovement(tx, {
          tenantId: delivery.tenantId,
          courierId: delivery.courierId!,
          walletId,
          type: CourierTransactionType.CASH_RECEIVED,
          amount: collected,
          orderId: delivery.orderId,
          comment: `${delivery.order.displayNumber} boʻyicha naqd`,
          createdByUserId: getContext()?.userId ?? null,
        });

        // The order is now settled, so its payment state has to follow.
        await tx.order.update({
          where: { id: delivery.orderId },
          data: {
            paidTotal: { increment: collected },
            paymentStatus:
              collected >= owed ? PaymentStatus.PAID : PaymentStatus.PARTIALLY_PAID,
          },
        });
      }

      // The courier's own earning for the job. Recorded separately because it
      // is income, not cash they are holding for the restaurant.
      if (delivery.courierFee > 0) {
        await this.wallet.recordMovement(tx, {
          tenantId: delivery.tenantId,
          courierId: delivery.courierId!,
          walletId,
          type: CourierTransactionType.DELIVERY_INCOME,
          amount: delivery.courierFee,
          orderId: delivery.orderId,
          comment: `${delivery.order.displayNumber} uchun daromad`,
        });
      }

      return updated;
    });

    await this.nudgeOrder(row.orderId, OrderStatus.DELIVERED);
    await this.releaseCourierIfIdle(delivery.courierId!);

    this.emitStatus(row.tenantId, row.branchId, deliveryId, delivery.status, row.status, row.courierId);

    await this.audit.record({
      action: 'DELIVERY_COMPLETED',
      entity: 'Delivery',
      entityId: deliveryId,
      newValue: { collectedCash: collected, courierFee: delivery.courierFee },
    });

    return toJob(row);
  }

  /** The delivery could not be made — the dispatcher picks it up from here. */
  async fail(deliveryId: string, reason: string): Promise<CourierJob> {
    const delivery = await this.loadOwnDelivery(deliveryId);

    if (
      delivery.status === DeliveryStatus.DELIVERED ||
      delivery.status === DeliveryStatus.FAILED
    ) {
      throw AppException.conflict('Bu yetkazish allaqachon yakunlangan');
    }

    const row = await this.prisma.db.delivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.FAILED, failedAt: new Date(), failureReason: reason },
      include: JOB_INCLUDE,
    });

    await this.releaseCourierIfIdle(delivery.courierId!);
    this.emitStatus(row.tenantId, row.branchId, deliveryId, delivery.status, row.status, row.courierId);

    await this.audit.record({
      action: 'DELIVERY_FAILED',
      entity: 'Delivery',
      entityId: deliveryId,
      newValue: { reason },
    });

    return toJob(row);
  }

  /* ------------------------------------------------------------------ */
  /* Status & location                                                  */
  /* ------------------------------------------------------------------ */

  async setStatus(status: CourierStatus): Promise<{ status: CourierStatus }> {
    const courierId = this.requireCourier();

    const courier = await this.prisma.db.courier.findFirst({
      where: { id: courierId },
      select: { status: true, tenantId: true, branchId: true },
    });
    if (!courier) throw AppException.notFound('Courier', ErrorCode.COURIER_NOT_FOUND);

    // Going offline mid-delivery would strand the order.
    if (status === CourierStatus.OFFLINE) {
      const active = await this.prisma.db.delivery.count({
        where: {
          courierId,
          status: { in: [DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP] },
        },
      });
      if (active > 0) {
        throw AppException.conflict(
          `${active} ta faol yetkazish bor — avval ularni yakunlang`,
        );
      }
    }

    await this.prisma.db.courier.update({ where: { id: courierId }, data: { status } });

    this.events.emit(DomainEvent.COURIER_STATUS_CHANGED, {
      tenantId: courier.tenantId,
      branchId: courier.branchId,
      requestId: getContext()?.requestId ?? null,
      actorUserId: getContext()?.userId ?? null,
      occurredAt: new Date().toISOString(),
      courierId,
      fromStatus: courier.status,
      toStatus: status,
    });

    return { status };
  }

  /**
   * GPS ping (TZ §25).
   *
   * Stores history AND denormalises the latest fix onto the courier row, so
   * the dispatcher map is one query rather than a join against every point
   * ever recorded.
   *
   * Silently ignored when the courier is offline: the app should not be
   * reporting then, and accepting it would mean tracking someone off shift.
   */
  async reportLocation(input: ReportLocationInput): Promise<void> {
    const courierId = this.requireCourier();

    const courier = await this.prisma.db.courier.findFirst({
      where: { id: courierId },
      select: { status: true, tenantId: true },
    });
    if (!courier || courier.status === CourierStatus.OFFLINE) return;

    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();

    await this.prisma.transaction(async (tx) => {
      await tx.courierLocation.create({
        data: {
          courierId,
          latitude: input.latitude,
          longitude: input.longitude,
          accuracyM: input.accuracyM ?? null,
          headingDeg: input.headingDeg ?? null,
          speedMps: input.speedMps ?? null,
          recordedAt,
        },
      });

      await tx.courier.update({
        where: { id: courierId },
        data: {
          lastLatitude: input.latitude,
          lastLongitude: input.longitude,
          lastLocationAt: recordedAt,
        },
      });
    });

    this.events.emit(DomainEvent.COURIER_LOCATION_UPDATED, {
      tenantId: courier.tenantId,
      branchId: null,
      requestId: getContext()?.requestId ?? null,
      actorUserId: getContext()?.userId ?? null,
      occurredAt: recordedAt.toISOString(),
      courierId,
      latitude: input.latitude,
      longitude: input.longitude,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Profile (TZ §23)                                                   */
  /* ------------------------------------------------------------------ */

  async myProfile(): Promise<CourierProfile> {
    return this.buildProfile(this.requireCourier());
  }

  /**
   * The courier editing their own contact number.
   *
   * Writes `Courier.contactPhone`, never `User.phone` — the latter is the
   * login key, and a typo there would lock the courier out of the app between
   * one delivery and the next.
   */
  async updateMyProfile(input: UpdateCourierProfileInput): Promise<CourierProfile> {
    const courierId = this.requireCourier();

    const before = await this.prisma.db.courier.findFirst({
      where: { id: courierId },
      select: { contactPhone: true },
    });

    await this.prisma.db.courier.update({
      where: { id: courierId },
      data: { contactPhone: input.phone },
    });

    await this.audit.record({
      action: 'COURIER_CONTACT_PHONE_CHANGED',
      entity: 'Courier',
      entityId: courierId,
      oldValue: { contactPhone: before?.contactPhone ?? null },
      newValue: { contactPhone: input.phone },
    });

    return this.buildProfile(courierId);
  }

  /**
   * Profile plus the figures the courier actually checks: how many deliveries
   * they have finished today and what they earned for them.
   *
   * "Today" is midnight in the branch's own timezone, not the server's. A
   * courier in Tashkent reading "0 delivered" at 06:00 because UTC has not
   * rolled over yet would rightly think the app was broken.
   */
  private async buildProfile(courierId: string): Promise<CourierProfile> {
    const courier = await this.prisma.db.courier.findFirst({
      where: { id: courierId },
      include: {
        user: { select: { fullName: true, phone: true } },
        branch: { select: { id: true, name: true, timezone: true } },
        tenant: { select: { timezone: true } },
      },
    });
    if (!courier) throw AppException.notFound('Courier', ErrorCode.COURIER_NOT_FOUND);

    const since = startOfDayInZone(
      new Date(),
      courier.branch?.timezone ?? courier.tenant.timezone,
    );

    const [deliveredToday, todayMoney] = await Promise.all([
      this.prisma.db.delivery.count({
        where: { courierId, status: DeliveryStatus.DELIVERED, deliveredAt: { gte: since } },
      }),
      this.prisma.db.courierTransaction.groupBy({
        by: ['type'],
        where: {
          courierId,
          createdAt: { gte: since },
          type: {
            in: [CourierTransactionType.CASH_RECEIVED, CourierTransactionType.DELIVERY_INCOME],
          },
        },
        _sum: { amount: true },
      }),
    ]);

    const sumOf = (type: CourierTransactionType): number =>
      todayMoney.find((row) => row.type === type)?._sum.amount ?? 0;

    return {
      courierId,
      fullName: courier.user.fullName,
      phone: courier.contactPhone ?? courier.user.phone,
      vehicleType: courier.vehicleType,
      status: courier.status,
      branchId: courier.branch?.id ?? null,
      branchName: courier.branch?.name ?? null,
      deliveredToday,
      collectedToday: sumOf(CourierTransactionType.CASH_RECEIVED),
      earnedToday: sumOf(CourierTransactionType.DELIVERY_INCOME),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * The courier id from the JWT.
   *
   * A staff token without a courier profile reaching these routes means the
   * role was mis-assigned; failing loudly beats returning an empty job list
   * that looks like "no work today".
   */
  private requireCourier(): string {
    const courierId = getContext()?.courierId;
    if (!courierId) {
      throw AppException.forbidden('Bu hisob kuryerga biriktirilmagan');
    }
    return courierId;
  }

  /** Loads a delivery and proves it belongs to the signed-in courier. */
  private async loadOwnDelivery(deliveryId: string) {
    const courierId = this.requireCourier();

    const delivery = await this.prisma.db.delivery.findFirst({
      where: { id: deliveryId, courierId },
      include: JOB_INCLUDE,
    });

    // 404 rather than 403: confirming that another courier's delivery exists
    // is itself a leak.
    if (!delivery) throw AppException.notFound('Delivery');

    return delivery;
  }

  private assertTransition(current: DeliveryStatus, expected: DeliveryStatus): void {
    if (current !== expected) {
      throw new AppException(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `Yetkazish holati ${current}, ${expected} kutilgan edi`,
        409,
      );
    }
  }

  /** Moves the order along, tolerating a transition that is no longer legal. */
  private async nudgeOrder(orderId: string, status: OrderStatus): Promise<void> {
    try {
      await this.orders.updateStatus(orderId, { status });
    } catch {
      // The order moved on without the courier — cancelled from the office,
      // say. The delivery's own state is still correct.
    }
  }

  private async syncCourierStatus(courierId: string, status: CourierStatus): Promise<void> {
    await this.prisma.db.courier
      .updateMany({ where: { id: courierId }, data: { status } })
      .catch(() => undefined);
  }

  /** Back to AVAILABLE once nothing is in flight. */
  private async releaseCourierIfIdle(courierId: string): Promise<void> {
    const active = await this.prisma.db.delivery.count({
      where: {
        courierId,
        status: { in: [DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP] },
      },
    });

    if (active === 0) await this.syncCourierStatus(courierId, CourierStatus.AVAILABLE);
  }

  private emitStatus(
    tenantId: string,
    branchId: string,
    deliveryId: string,
    from: DeliveryStatus,
    to: DeliveryStatus,
    courierId: string | null,
  ): void {
    this.events.emit(DomainEvent.DELIVERY_STATUS_CHANGED, {
      tenantId,
      branchId,
      requestId: getContext()?.requestId ?? null,
      actorUserId: getContext()?.userId ?? null,
      occurredAt: new Date().toISOString(),
      deliveryId,
      orderId: '',
      courierId,
      fromStatus: from,
      toStatus: to,
    });
  }
}

/* -------------------------------------------------------------------------- */

type DeliveryRow = {
  id: string;
  orderId: string;
  status: string;
  assignedAt: Date | null;
  courierFee: number;
  order: {
    displayNumber: string;
    total: number;
    paidTotal: number;
    paymentStatus: string;
    customerName: string | null;
    customerPhone: string | null;
    comment: string | null;
    addressText: string | null;
    addressApartment: string | null;
    addressLatitude: number | null;
    addressLongitude: number | null;
    items: Array<{ name: string; quantity: number }>;
  };
  branch: {
    name: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
  };
};

function toJob(row: DeliveryRow): CourierJob {
  const owed = Math.max(0, row.order.total - row.order.paidTotal);

  const address = row.order.addressApartment
    ? `${row.order.addressText}, ${row.order.addressApartment}-xonadon`
    : (row.order.addressText ?? '');

  return {
    deliveryId: row.id,
    orderId: row.orderId,
    displayNumber: row.order.displayNumber,
    status: row.status as CourierJob['status'],
    branchName: row.branch.name,
    branchAddress: row.branch.address,
    branchLatitude: row.branch.latitude,
    branchLongitude: row.branch.longitude,
    customerName: row.order.customerName,
    customerPhone: row.order.customerPhone,
    address,
    latitude: row.order.addressLatitude,
    longitude: row.order.addressLongitude,
    amountToCollect: owed,
    orderTotal: row.order.total,
    isPaid: owed === 0,
    // A compact one-liner: the courier does not assemble the order, they just
    // need to recognise the bag.
    itemsSummary: row.order.items
      .map((item) => `${item.quantity}× ${item.name}`)
      .join(', '),
    comment: row.order.comment,
    assignedAt: row.assignedAt?.toISOString() ?? null,
  };
}
