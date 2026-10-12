import { Injectable } from '@nestjs/common';
import { ReservationStatus, type TableReservation } from '@restor/shared-types';
import type {
  CreateReservationInput,
  ReservationListQueryInput,
  UpdateReservationInput,
} from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Where each status may go next. The last three are final. */
const MOVES: Record<ReservationStatus, readonly ReservationStatus[]> = {
  BOOKED: [ReservationStatus.SEATED, ReservationStatus.CANCELLED, ReservationStatus.NO_SHOW],
  SEATED: [ReservationStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Statuses that hold a table: a booking still to come, or guests sitting at it. */
export const HOLDING_STATUSES: readonly ReservationStatus[] = [
  ReservationStatus.BOOKED,
  ReservationStatus.SEATED,
];

export function canMoveReservation(from: ReservationStatus, to: ReservationStatus): boolean {
  return MOVES[from].includes(to);
}

interface Slot {
  startsAt: Date;
  durationMinutes: number;
}

/** Half-open intervals: a booking ending at 20:00 does not clash with one at 20:00. */
export function slotsOverlap(a: Slot, b: Slot): boolean {
  const aStart = a.startsAt.getTime();
  const bStart = b.startsAt.getTime();
  return aStart < bStart + b.durationMinutes * 60_000 && bStart < aStart + a.durationMinutes * 60_000;
}

const INCLUDE = {
  table: { select: { number: true } },
  createdBy: { select: { fullName: true } },
} as const;

/** The longest booking allowed, used to bound the clash search. */
const MAX_DURATION_MS = 720 * 60_000;

/**
 * Table bookings (TZ 20).
 *
 * The rule that matters is the clash check: two parties promised the same
 * table at the same hour is the one failure a host cannot recover from at the
 * door, so the server refuses it rather than leaving it to whoever reads the
 * board. A booking without a table yet is allowed — the host often seats by
 * party size on the night — and is checked when a table is given to it.
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchScope: BranchScope,
  ) {}

  async list(query: ReservationListQueryInput): Promise<TableReservation[]> {
    const rows = await this.prisma.db.tableReservation.findMany({
      where: {
        branchId: this.branchScope.filterFor(query.branchId),
        ...(query.tableId ? { tableId: query.tableId } : {}),
        startsAt: { gte: new Date(query.from), lt: new Date(query.to) },
      },
      include: INCLUDE,
      orderBy: { startsAt: 'asc' },
      take: 1000,
    });
    return rows.map(toReservation);
  }

  async create(input: CreateReservationInput): Promise<TableReservation> {
    this.branchScope.assertCanAccess(input.branchId);
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');

    const startsAt = new Date(input.startsAt);
    // An hour of grace lets a host record a walk-in that arrived a moment ago.
    if (startsAt.getTime() < Date.now() - 60 * 60_000) {
      throw AppException.badRequest('Oʻtgan vaqtga bron qilib boʻlmaydi');
    }

    if (input.tableId) {
      await this.assertTableFree(input.branchId, input.tableId, { startsAt, durationMinutes: input.durationMinutes });
    }

    const row = await this.prisma.db.tableReservation.create({
      data: {
        tenantId,
        branchId: input.branchId,
        tableId: input.tableId ?? null,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        partySize: input.partySize,
        startsAt,
        durationMinutes: input.durationMinutes,
        note: input.note ?? null,
        createdByUserId: getContext()?.userId ?? null,
      },
      include: INCLUDE,
    });

    await this.audit.record({
      action: 'RESERVATION_CREATED',
      entity: 'TableReservation',
      entityId: row.id,
      newValue: { branchId: row.branchId, tableId: row.tableId, startsAt: row.startsAt.toISOString(), partySize: row.partySize },
    });

    return toReservation(row);
  }

  async update(id: string, input: UpdateReservationInput): Promise<TableReservation> {
    const current = await this.prisma.db.tableReservation.findFirst({ where: { id } });
    if (!current) throw AppException.notFound('Reservation');
    this.branchScope.assertCanAccess(current.branchId);

    const from = current.status as ReservationStatus;
    const to = input.status ?? from;
    if (to !== from && !canMoveReservation(from, to)) {
      throw AppException.badRequest('Bron holatini bunday oʻzgartirib boʻlmaydi');
    }

    const editsDetails = Object.entries(input).some(([key, value]) => key !== 'status' && value !== undefined);
    if (editsDetails && !HOLDING_STATUSES.includes(from)) {
      throw AppException.badRequest('Yopilgan bronni oʻzgartirib boʻlmaydi');
    }

    const tableId = input.tableId !== undefined ? input.tableId ?? null : current.tableId;
    const slot = {
      startsAt: input.startsAt ? new Date(input.startsAt) : current.startsAt,
      durationMinutes: input.durationMinutes ?? current.durationMinutes,
    };

    if (to === ReservationStatus.SEATED && !tableId) {
      throw AppException.badRequest('Avval stol tanlang');
    }

    // Re-check only what could newly clash: another table, another time, or a
    // longer stay. A booking that keeps its slot cannot have started clashing.
    const moved =
      tableId !== current.tableId ||
      slot.startsAt.getTime() !== current.startsAt.getTime() ||
      slot.durationMinutes !== current.durationMinutes;
    if (tableId && moved && HOLDING_STATUSES.includes(to)) {
      await this.assertTableFree(current.branchId, tableId, slot, id);
    }

    const now = new Date();
    const row = await this.prisma.db.tableReservation.update({
      where: { id },
      data: {
        tableId,
        ...(input.guestName !== undefined ? { guestName: input.guestName } : {}),
        ...(input.guestPhone !== undefined ? { guestPhone: input.guestPhone } : {}),
        ...(input.partySize !== undefined ? { partySize: input.partySize } : {}),
        ...(input.note !== undefined ? { note: input.note ?? null } : {}),
        startsAt: slot.startsAt,
        durationMinutes: slot.durationMinutes,
        status: to,
        ...(to === ReservationStatus.SEATED && from !== to ? { seatedAt: now } : {}),
        ...(to !== from && !HOLDING_STATUSES.includes(to) ? { closedAt: now } : {}),
      },
      include: INCLUDE,
    });

    if (to !== from) {
      await this.audit.record({
        action: `RESERVATION_${to}`,
        entity: 'TableReservation',
        entityId: id,
        oldValue: { status: from },
        newValue: { status: to },
      });
    }

    return toReservation(row);
  }

  /**
   * Refuses a slot that clashes with another live booking on the same table.
   *
   * Searches a window wide enough to catch a long booking that started before
   * this one, then compares exactly in code.
   */
  private async assertTableFree(branchId: string, tableId: string, slot: Slot, excludeId?: string): Promise<void> {
    const table = await this.prisma.db.restaurantTable.findFirst({
      where: { id: tableId, deletedAt: null },
      select: { branchId: true, number: true, isActive: true, branch: { select: { timezone: true } } },
    });
    if (!table || table.branchId !== branchId) throw AppException.notFound('Table');
    if (!table.isActive) throw AppException.badRequest(`${table.number}-stol oʻchirilgan`);

    const end = new Date(slot.startsAt.getTime() + slot.durationMinutes * 60_000);
    const nearby = await this.prisma.db.tableReservation.findMany({
      where: {
        tableId,
        status: { in: [...HOLDING_STATUSES] },
        startsAt: { gte: new Date(slot.startsAt.getTime() - MAX_DURATION_MS), lt: end },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { guestName: true, startsAt: true, durationMinutes: true },
    });

    const clash = nearby.find((other) => slotsOverlap(slot, other));
    if (clash) {
      const time = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: table.branch.timezone,
      }).format(clash.startsAt);
      throw AppException.conflict(`${table.number}-stol bu vaqtda band: ${clash.guestName}, ${time}`);
    }
  }
}

function toReservation(row: {
  id: string;
  branchId: string;
  tableId: string | null;
  guestName: string;
  guestPhone: string;
  partySize: number;
  startsAt: Date;
  durationMinutes: number;
  status: string;
  note: string | null;
  seatedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  table: { number: string } | null;
  createdBy: { fullName: string } | null;
}): TableReservation {
  return {
    id: row.id,
    branchId: row.branchId,
    tableId: row.tableId,
    tableNumber: row.table?.number ?? null,
    guestName: row.guestName,
    guestPhone: row.guestPhone,
    partySize: row.partySize,
    startsAt: row.startsAt.toISOString(),
    durationMinutes: row.durationMinutes,
    status: row.status as ReservationStatus,
    note: row.note,
    seatedAt: row.seatedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdByName: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
