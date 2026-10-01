import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'node:crypto';
import {
  DomainEvent,
  OrderStatus,
  WaiterCallStatus,
  WaiterCallType,
  type RestaurantTable,
  type WaiterCall,
} from '@restor/shared-types';
import { AppException } from '../../common/errors/app-exception';
import { getContext, runUnscoped } from '../../common/context/request-context';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

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
  ) {}

  /* ------------------------------------------------------------------ */
  /* Tables                                                            */
  /* ------------------------------------------------------------------ */

  async list(branchId?: string): Promise<RestaurantTable[]> {
    const rows = await this.prisma.db.restaurantTable.findMany({
      where: { ...(branchId ? { branchId } : {}), deletedAt: null },
      orderBy: [{ zone: 'asc' }, { number: 'asc' }],
    });

    return rows.map((row) => this.toTable(row));
  }

  async create(input: {
    branchId: string;
    number: string;
    name?: string | null;
    seats?: number | null;
    zone?: string | null;
  }): Promise<RestaurantTable> {
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
    },
  ): Promise<RestaurantTable> {
    await this.require(id);

    const row = await this.prisma.db.restaurantTable.update({
      where: { id },
      data: {
        ...(input.number !== undefined ? { number: input.number } : {}),
        ...(input.name !== undefined ? { name: input.name ?? null } : {}),
        ...(input.seats !== undefined ? { seats: input.seats ?? null } : {}),
        ...(input.zone !== undefined ? { zone: input.zone ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
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
        ...(query.branchId ? { branchId: query.branchId } : {}),
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
