import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { FloorTable } from '@restor/shared-types';
import { IconBell, IconCash } from '@restor/ui';
import { compactSom, timeOf } from '../../lib/format';
import {
  PLAN_HEIGHT,
  PLAN_WIDTH,
  TABLE_STATE_LABELS,
  asksForBill,
  clampToPlan,
  tableSize,
  tableState,
  type PlanPoint,
} from '../../lib/tables';

/**
 * One zone's floor, drawn to scale on a 1000 × 625 plan.
 *
 * Positions are plan units and the canvas keeps its aspect ratio, so the same
 * layout reads the same on the host's tablet and the manager's monitor. In
 * edit mode tables are dragged with pointer events — mouse, pen and finger
 * alike — and the page saves every position in one request.
 */
export function FloorPlan({
  tables,
  positions,
  selectedId,
  editing,
  onSelect,
  onMove,
}: {
  tables: FloorTable[];
  positions: Record<string, PlanPoint>;
  selectedId: string | null;
  editing: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, point: PlanPoint) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  function toPlan(event: ReactPointerEvent): PlanPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * PLAN_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PLAN_HEIGHT,
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, table: FloorTable) {
    if (!editing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = toPlan(event);
    const pos = positions[table.id]!;
    drag.current = { id: table.id, dx: at.x - pos.x, dy: at.y - pos.y, moved: false };
    onSelect(table.id);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>, table: FloorTable) {
    if (!drag.current || drag.current.id !== table.id) return;
    const at = toPlan(event);
    drag.current.moved = true;
    onMove(table.id, clampToPlan({ x: at.x - drag.current.dx, y: at.y - drag.current.dy }, tableSize(table)));
  }

  return (
    <div ref={canvasRef} className={`floor${editing ? ' floor--editing' : ''}`}>
      {tables.map((table) => {
        const pos = positions[table.id];
        if (!pos) return null;
        const size = tableSize(table);
        const state = tableState(table);
        const calling = table.calls.length > 0;
        return (
          <button
            key={table.id}
            type="button"
            className={[
              'floor__table',
              `floor__table--${table.shape.toLowerCase()}`,
              `is-${state}`,
              selectedId === table.id ? 'is-selected' : '',
              calling ? 'has-call' : '',
            ].join(' ')}
            style={{
              left: `${(pos.x / PLAN_WIDTH) * 100}%`,
              top: `${(pos.y / PLAN_HEIGHT) * 100}%`,
              width: `${(size.w / PLAN_WIDTH) * 100}%`,
              height: `${(size.h / PLAN_HEIGHT) * 100}%`,
            }}
            aria-label={`${table.number}-stol, ${TABLE_STATE_LABELS[state]}`}
            aria-pressed={selectedId === table.id}
            onClick={() => !editing && onSelect(table.id)}
            onPointerDown={(e) => onPointerDown(e, table)}
            onPointerMove={(e) => onPointerMove(e, table)}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <span className="floor__num">{table.number}</span>
            <span className="floor__meta">
              {state === 'busy' && table.openOrder
                ? compactSom(table.openOrder.total)
                : state === 'reserved' && table.reservation
                  ? timeOf(table.reservation.startsAt)
                  : `${table.seats ?? '–'} oʻrin`}
            </span>
            {calling && (
              <span className="floor__alert" title={asksForBill(table) ? 'Hisob soʻradi' : 'Ofitsiant chaqirdi'}>
                {asksForBill(table) ? <IconCash size={11} /> : <IconBell size={11} />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
