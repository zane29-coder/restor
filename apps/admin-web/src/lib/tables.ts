import {
  FLOOR_PLAN,
  ReservationStatus,
  TableShape,
  WaiterCallType,
  type FloorTable,
  type RestaurantTable,
} from '@restor/shared-types';

export const PLAN_WIDTH = FLOOR_PLAN.width;
export const PLAN_HEIGHT = FLOOR_PLAN.height;

export type TableState = 'busy' | 'reserved' | 'free' | 'off';

export const TABLE_STATE_LABELS: Record<TableState, string> = {
  busy: 'Band',
  reserved: 'Bron',
  free: 'Erkin',
  off: 'Oʻchiq',
};

export const TABLE_STATE_TONES: Record<TableState, string> = {
  busy: 'tone-primary',
  reserved: 'tone-info',
  free: 'tone-success',
  off: 'tone-neutral',
};

export const SHAPE_LABELS: Record<TableShape, string> = {
  SQUARE: 'Kvadrat',
  ROUND: 'Dumaloq',
  RECT: 'Uzun',
};

export const RESERVATION_LABELS: Record<ReservationStatus, string> = {
  BOOKED: 'Bron qilingan',
  SEATED: 'Oʻtirishdi',
  COMPLETED: 'Yakunlandi',
  CANCELLED: 'Bekor qilindi',
  NO_SHOW: 'Kelmadi',
};

export const RESERVATION_TONES: Record<ReservationStatus, string> = {
  BOOKED: 'tone-info',
  SEATED: 'tone-primary',
  COMPLETED: 'tone-success',
  CANCELLED: 'tone-neutral',
  NO_SHOW: 'tone-danger',
};

/**
 * What the floor shows for a table. Guests at it — an open order or a seated
 * booking — outrank a booking still to come.
 */
export function tableState(table: FloorTable): TableState {
  if (!table.isActive) return 'off';
  if (table.openOrder || table.reservation?.status === ReservationStatus.SEATED) return 'busy';
  if (table.reservation) return 'reserved';
  return 'free';
}

export const asksForBill = (table: FloorTable) => table.calls.some((c) => c.type === WaiterCallType.REQUEST_BILL);

/** Staff talk about "the main hall" for tables nobody put in a zone. */
export const zoneName = (zone: string | null) => zone || 'Asosiy zal';

/** Footprint on the plan, in plan units: bigger tables for bigger parties. */
export function tableSize(table: Pick<RestaurantTable, 'seats' | 'shape'>): { w: number; h: number } {
  const seats = table.seats ?? 4;
  const base = seats <= 2 ? 80 : seats <= 4 ? 100 : seats <= 6 ? 116 : 132;
  return table.shape === TableShape.RECT ? { w: Math.round(base * 1.75), h: Math.round(base * 0.85) } : { w: base, h: base };
}

export interface PlanPoint {
  x: number;
  y: number;
}

/**
 * Where to draw each table: its saved spot, or — until someone places it — a
 * tidy grid, so a restaurant that never opens the editor still gets a plan.
 */
export function planPositions(tables: RestaurantTable[]): Record<string, PlanPoint> {
  const result: Record<string, PlanPoint> = {};
  let slot = 0;
  for (const table of tables) {
    if (table.layoutX !== null && table.layoutY !== null) {
      result[table.id] = { x: table.layoutX, y: table.layoutY };
      continue;
    }
    const col = slot % 5;
    const row = Math.floor(slot / 5);
    result[table.id] = { x: 110 + col * 195, y: Math.min(PLAN_HEIGHT - 70, 95 + row * 145) };
    slot++;
  }
  return result;
}

/** Keeps a dragged table wholly on the canvas, on a 5-unit grid. */
export function clampToPlan(point: PlanPoint, size: { w: number; h: number }): PlanPoint {
  const snap = (v: number) => Math.round(v / 5) * 5;
  return {
    x: Math.min(PLAN_WIDTH - size.w / 2, Math.max(size.w / 2, snap(point.x))),
    y: Math.min(PLAN_HEIGHT - size.h / 2, Math.max(size.h / 2, snap(point.y))),
  };
}

/** Local `YYYY-MM-DD` + `HH:mm` to an ISO instant. */
export function localInstant(day: string, time: string): string {
  return new Date(`${day}T${time}:00`).toISOString();
}

export function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
