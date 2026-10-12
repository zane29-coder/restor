import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'node:crypto';
import {
  DomainEvent,
  OrderStatus,
  OrderType,
  ReservationStatus,
  TableShape,
  WaiterCallStatus,
  WaiterCallType,
  type FloorTable,
  type RestaurantTable,
  type TableFloor,
  type WaiterCall,
} from '@restor/shared-types';
import { startOfDayInZone } from '@restor/shared-utils';
import type { TableLayoutInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { getContext, runUnscoped } from '../../common/context/request-context';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

const OPEN_ORDER = { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] };

/** How far ahead a booking starts showing its table as reserved. */
const RESERVED_AHEAD_MS = 3 * 60 * 60_000;
/** How long a late party keeps its table before the floor shows it free. */
const LATE_GRACE_MS = 30 * 60_000;

/** What a guest sees after scanning, before they have ordered anything. */
export interface TableSession {
  tableId: string;
  tableNumber: string;
  tableName: string | null;
  branchId: string;
  branchName: string;
  tenantSlug: string;
  /** An order already open on this table, so a second scan rejoins it. */
  openOrderId: string | null;
  openOrderNumber: string | null;
}

/**
 * Tables and QR service (TZ §20).
 *
 * The QR token is the whole security model here, and it is deliberately thin:
 * scanning a table's code is how a guest proves they are sitting at it, and
 * nothing more is asked of them. No login, no phone number — a guest who has
 * to register before seeing the menu orders at the counter instead.
 *
 * What that means in practice: the token grants the ability to read one
 * branch's menu and open an order on one table. It cannot read other tables,
 * other orders, or anything belonging to the restaurant. Rotating it
 * invalidates every printed code for that table, which is the lever to pull
 * when a code leaks onto the internet.
 */
@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly config: AppConfig,
    private readonly branchScope: BranchScope,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Tables                                                            */
  /* ------------------------------------------------------------------ */

  async list(branchId?: string): Promise<RestaurantTable[]> {
    const rows = await this.prisma.db.restaurantTable.findMany({
      where: { branchId: this.branchScope.filterFor(branchId), deletedAt: null },
      orderBy: [{ zone: 'asc' }, { number: 'asc' }],
    });

    return rows.map((row) => this.toTable(row));
  }

  /**
   * The live floor of one branch: every table with what is happening at it.
   *
   * One request rather than the client stitching orders, calls and bookings
   * together, because the board refreshes every few seconds on a tablet at
   * the host stand.
   */
  async floor(branchId: string): Promise<TableFloor> {
    this.branchScope.assertCanAccess(branchId);
    const branch = await this.prisma.db.branch.findFirst({
      where: { id: branchId },
      select: { timezone: true },
    });
    if (!branch) throw AppException.notFound('Branch');

    const now = new Date();
    const dayStart = startOfDayInZone(now, branch.timezone);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const [tables, orders, calls, reservations, completed, bookedToday] = await Promise.all([
      this.prisma.db.restaurantTable.findMany({
        where: { branchId, deletedAt: null },
        orderBy: [{ zone: 'asc' }, { number: 'asc' }],
      }),
      this.prisma.db.order.findMany({
        where: { branchId, tableId: { not: null }, status: OPEN_ORDER },
        select: {
          id: true,
          tableId: true,
          displayNumber: true,
          status: true,
          total: true,
          createdAt: true,
          createdBy: { select: { fullName: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.waiterCall.findMany({
        where: { branchId, status: { in: [WaiterCallStatus.PENDING, WaiterCallStatus.ACKNOWLEDGED] } },
        select: { id: true, tableId: true, type: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.db.tableReservation.findMany({
        where: {
          branchId,
          tableId: { not: null },
          OR: [
            { status: ReservationStatus.SEATED },
            {
              status: ReservationStatus.BOOKED,
              startsAt: {
                gte: new Date(now.getTime() - LATE_GRACE_MS),
                lte: new Date(now.getTime() + RESERVED_AHEAD_MS),
              },
            },
          ],
        },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.db.order.aggregate({
        where: {
          branchId,
          type: OrderType.DINE_IN,
          status: OrderStatus.DELIVERED,
          createdAt: { gte: dayStart, lt: dayEnd },
        },
        _sum: { total: true, refundedTotal: true },
        _count: true,
      }),
      this.prisma.db.tableReservation.count({
        where: {
          branchId,
          startsAt: { gte: dayStart, lt: dayEnd },
          status: { notIn: [ReservationStatus.CANCELLED] },
        },
      }),
    ]);

    const floorTables: FloorTable[] = tables.map((row) => {
      const order = orders.find((o) => o.tableId === row.id);
      // Guests sitting on a booking outrank the next one coming.
      const held = reservations.filter((r) => r.tableId === row.id);
      const reservation = held.find((r) => r.status === ReservationStatus.SEATED) ?? held[0];
      return {
        ...this.toTable(row),
        openOrder: order
          ? {
              id: order.id,
              displayNumber: order.displayNumber,
              status: order.status as OrderStatus,
              total: order.total,
              itemCount: order._count.items,
              createdAt: order.createdAt.toISOString(),
              createdByName: order.createdBy?.fullName ?? null,
            }
          : null,
        calls: calls
          .filter((c) => c.tableId === row.id)
          .map((c) => ({
            id: c.id,
            type: c.type as WaiterCallType,
            status: c.status as WaiterCallStatus,
            createdAt: c.createdAt.toISOString(),
          })),
        reservation: reservation
          ? {
              id: reservation.id,
              guestName: reservation.guestName,
              guestPhone: reservation.guestPhone,
              partySize: reservation.partySize,
              startsAt: reservation.startsAt.toISOString(),
              status: reservation.status as ReservationStatus,
              note: reservation.note,
            }
          : null,
      };
    });

    return {
      branchId,
      tables: floorTables,
      today: {
        orders: completed._count,
        revenue: (completed._sum.total ?? 0) - (completed._sum.refundedTotal ?? 0),
        reservations: bookedToday,
      },
    };
  }

  /**
   * Saves table positions from the plan editor, all or nothing.
   *
   * Every id is checked against the caller's tenant (the scoped query) and
   * branch before anything is written, so a crafted request cannot move
   * another branch's tables.
   */
  async saveLayout(input: TableLayoutInput): Promise<RestaurantTable[]> {
    const ids = [...new Set(input.items.map((item) => item.id))];
    const rows = await this.prisma.db.restaurantTable.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (rows.length !== ids.length) throw AppException.notFound('Table');
    for (const branchId of new Set(rows.map((row) => row.branchId))) {
      this.branchScope.assertCanAccess(branchId);
    }

    const updated = await this.prisma.db.$transaction(
      input.items.map((item) =>
        this.prisma.db.restaurantTable.update({
          where: { id: item.id },
          data: { layoutX: item.x, layoutY: item.y, ...(item.shape ? { shape: item.shape } : {}) },
        }),
      ),
    );

    await this.audit.record({
      action: 'TABLE_LAYOUT_SAVED',
      entity: 'RestaurantTable',
      entityId: rows[0]!.id,
      newValue: { branchIds: [...new Set(rows.map((row) => row.branchId))], tables: ids.length },
    });

    return updated.map((row) => this.toTable(row));
  }

  async create(input: {
    branchId: string;
    number: string;
    name?: string | null;
    seats?: number | null;
    zone?: string | null;
    shape?: TableShape;
  }): Promise<RestaurantTable> {
    this.branchScope.assertCanAccess(input.branchId);
    const tenantId = this.requireTenant();

    const duplicate = await this.prisma.db.restaurantTable.findFirst({
      where: { branchId: input.branchId, number: input.number, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.conflict(`${input.number}-stol allaqachon mavjud`);
    }

    const row = await this.prisma.db.restaurantTable.create({
      data: {
        tenantId,
        branchId: input.branchId,
        number: input.number,
        name: input.name ?? null,
        seats: input.seats ?? null,
        zone: input.zone ?? null,
        shape: input.shape ?? TableShape.SQUARE,
        qrToken: qrToken(),
      },
    });

    await this.audit.record({
      action: 'TABLE_CREATED',
      entity: 'RestaurantTable',
      entityId: row.id,
      newValue: { number: input.number, branchId: input.branchId },
    });

    return this.toTable(row);
  }

  async update(
    id: string,
    input: {
      number?: string;
      name?: string | null;
      seats?: number | null;
      zone?: string | null;
      isActive?: boolean;
      shape?: TableShape;
    },
  ): Promise<RestaurantTable> {
    const current = await this.require(id);

    if (input.number !== undefined && input.number !== current.number) {
      const duplicate = await this.prisma.db.restaurantTable.findFirst({
        where: { branchId: current.branchId, number: input.number, deletedAt: null, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) throw AppException.conflict(`${input.number}-stol allaqachon mavjud`);
    }

    // Moving a table to another zone puts it on another plan, where its old
    // coordinates mean nothing; it is laid out afresh there.
    const zone = input.zone !== undefined ? input.zone ?? null : current.zone;
    const leavesZone = zone !== current.zone;

    const row = await this.prisma.db.restaurantTable.update({
      where: { id },
      data: {
        ...(input.number !== undefined ? { number: input.number } : {}),
        ...(input.name !== undefined ? { name: input.name ?? null } : {}),
        ...(input.seats !== undefined ? { seats: input.seats ?? null } : {}),
        ...(input.zone !== undefined ? { zone } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.shape !== undefined ? { shape: input.shape } : {}),
        ...(leavesZone ? { layoutX: null, layoutY: null } : {}),
      },
    });

    return this.toTable(row);
  }

  /**
   * Issues a new QR token, invalidating every printed code for this table.
   *
   * The reason this exists as an explicit action rather than happening on
   * edit: a photographed code posted online lets anyone open orders on that
   * table from anywhere, and the fix has to be one deliberate button, not a
   * side effect of renaming a table.
   */
  async rotateQr(id: string): Promise<RestaurantTable> {
    const before = await this.require(id);

    const row = await this.prisma.db.restaurantTable.update({
      where: { id },
      data: { qrToken: qrToken() },
    });

    await this.audit.record({
      action: 'TABLE_QR_ROTATED',
      entity: 'RestaurantTable',
      entityId: id,
      // The tokens themselves are deliberately absent: the audit log records
      // that codes were invalidated, not what would reactivate them.
      newValue: { number: before.number, rotated: true },
    });

    this.logger.log({ tableId: id, number: before.number }, 'Table QR rotated');
    return this.toTable(row);
  }

  async remove(id: string): Promise<void> {
    const table = await this.require(id);

    const openOrders = await this.prisma.db.order.count({
      where: { tableId: id, status: { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] } },
    });
    if (openOrders > 0) {
      throw AppException.conflict('Bu stolda yakunlanmagan buyurtma bor');
    }

    // Soft: past orders reference the table, and a report that cannot say
    // which table a sale came from is less useful than one that can.
    await this.prisma.db.restaurantTable.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      action: 'TABLE_DELETED',
      entity: 'RestaurantTable',
      entityId: id,
      oldValue: { number: table.number },
    });
  }

  /* ------------------------------------------------------------------ */
  /* The guest's side                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Resolves a scanned QR token.
   *
   * Public and unauthenticated by design, so it runs unscoped and derives the
   * tenant from the token itself — the one piece of information the guest
   * demonstrably holds. An inactive table is refused rather than silently
   * accepted: the restaurant turned it off for a reason.
   */
  async resolveQr(token: string): Promise<TableSession> {
    const table = await runUnscoped(() =>
      this.prisma.db.restaurantTable.findFirst({
        where: { qrToken: token, deletedAt: null },
        include: {
          branch: { select: { id: true, name: true, isActive: true } },
          tenant: { select: { slug: true, status: true } },
        },
      }),
    );

    if (!table || !table.isActive) throw AppException.notFound('Table');
    if (!table.branch.isActive) {
      throw AppException.badRequest('Bu filial hozir xizmat koʻrsatmaydi');
    }
    if (table.tenant.status !== 'ACTIVE') {
      throw AppException.badRequest('Restoran hozir xizmat koʻrsatmaydi');
    }

    // A second scan at the same table rejoins the order already open on it,
    // rather than starting a parallel one for the same group of guests.
    const open = await runUnscoped(() =>
      this.prisma.db.order.findFirst({
        where: {
          tableId: table.id,
          status: { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, displayNumber: true },
      }),
    );

    return {
      tableId: table.id,
      tableNumber: table.number,
      tableName: table.name,
      branchId: table.branch.id,
      branchName: table.branch.name,
      tenantSlug: table.tenant.slug,
      openOrderId: open?.id ?? null,
      openOrderNumber: open?.displayNumber ?? null,
    };
  }

  /**
   * A guest calling a waiter.
   *
   * Rate-limited by collapsing duplicates: a guest who taps three times is
   * impatient, not three guests, and three identical rows on a waiter's
   * screen is noise that trains them to ignore it.
   */
  async call(token: string, type: WaiterCallType): Promise<WaiterCall> {
    const session = await this.resolveQr(token);

    const existing = await runUnscoped(() =>
      this.prisma.db.waiterCall.findFirst({
        where: {
          tableId: session.tableId,
          type,
          status: { in: [WaiterCallStatus.PENDING, WaiterCallStatus.ACKNOWLEDGED] },
        },
        include: { table: { select: { number: true } } },
      }),
    );
    if (existing) return toCall(existing, existing.table.number);

    const row = await runUnscoped(async () => {
      const table = await this.prisma.db.restaurantTable.findFirst({
        where: { id: session.tableId },
        select: { tenantId: true, branchId: true, number: true },
      });

      return this.prisma.db.waiterCall.create({
        data: {
          tenantId: table!.tenantId,
          branchId: table!.branchId,
          tableId: session.tableId,
          type,
        },
      });
    });

    this.events.emit(DomainEvent.WAITER_CALLED, {
      tenantId: row.tenantId,
      branchId: row.branchId,
      requestId: getContext()?.requestId ?? null,
      actorUserId: null,
      occurredAt: new Date().toISOString(),
      callId: row.id,
      tableId: session.tableId,
      tableNumber: session.tableNumber,
      type,
    });

    this.logger.log(
      { tableNumber: session.tableNumber, type },
      'Waiter called from a table',
    );

    return toCall(row, session.tableNumber);
  }

  /* ------------------------------------------------------------------ */
  /* Staff side                                                         */
  /* ------------------------------------------------------------------ */

  async listCalls(query: {
    branchId?: string;
    status?: WaiterCallStatus;
  }): Promise<WaiterCall[]> {
    const rows = await this.prisma.db.waiterCall.findMany({
      where: {
        branchId: this.branchScope.filterFor(query.branchId),
        // Default to what still needs a person, not the whole history.
        status: query.status ?? {
          in: [WaiterCallStatus.PENDING, WaiterCallStatus.ACKNOWLEDGED],
        },
      },
      include: { table: { select: { number: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    return rows.map((row) => toCall(row, row.table.number));
  }

  async acknowledge(id: string): Promise<WaiterCall> {
    return this.advance(id, WaiterCallStatus.ACKNOWLEDGED);
  }

  async resolve(id: string): Promise<WaiterCall> {
    return this.advance(id, WaiterCallStatus.RESOLVED);
  }

  private async advance(id: string, status: WaiterCallStatus): Promise<WaiterCall> {
    const call = await this.prisma.db.waiterCall.findFirst({ where: { id } });
    if (!call) throw AppException.notFound('WaiterCall');
    this.branchScope.assertCanAccess(call.branchId);

    const row = await this.prisma.db.waiterCall.update({
      where: { id },
      data: {
        status,
        ...(status === WaiterCallStatus.ACKNOWLEDGED
          ? {
              acknowledgedByUserId: getContext()?.userId ?? null,
              acknowledgedAt: new Date(),
            }
          : { resolvedAt: new Date() }),
      },
      include: { table: { select: { number: true } } },
    });

    return toCall(row, row.table.number);
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  private async require(id: string) {
    const row = await this.prisma.db.restaurantTable.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw AppException.notFound('Table');
    this.branchScope.assertCanAccess(row.branchId);
    return row;
  }

  private toTable(row: {
    id: string;
    tenantId: string;
    branchId: string;
    number: string;
    name: string | null;
    seats: number | null;
    zone: string | null;
    qrToken: string;
    isActive: boolean;
    layoutX: number | null;
    layoutY: number | null;
    shape: string;
    createdAt: Date;
    updatedAt: Date;
  }): RestaurantTable {
    return {
      id: row.id,
      tenantId: row.tenantId,
      branchId: row.branchId,
      number: row.number,
      name: row.name,
      seats: row.seats,
      zone: row.zone,
      qrToken: row.qrToken,
      // Built here rather than in the client so one definition of the guest
      // entry point exists, and a printed code cannot point at a stale path.
      qrUrl: `${this.config.customerWebUrl.replace(/\/+$/, '')}/t/${row.qrToken}`,
      isActive: row.isActive,
      layoutX: row.layoutX,
      layoutY: row.layoutY,
      shape: row.shape as TableShape,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');
    return tenantId;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * A QR token.
 *
 * 24 bytes of base64url: long enough that guessing one is not a strategy, and
 * short enough to survive being printed at the size of a table tent.
 */
function qrToken(): string {
  return randomBytes(24).toString('base64url');
}

function toCall(
  row: {
    id: string;
    tenantId: string;
    branchId: string;
    tableId: string;
    type: string;
    status: string;
    acknowledgedByUserId: string | null;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  tableNumber: string,
): WaiterCall {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    tableId: row.tableId,
    tableNumber,
    type: row.type as WaiterCallType,
    status: row.status as WaiterCallStatus,
    acknowledgedByUserId: row.acknowledgedByUserId,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
