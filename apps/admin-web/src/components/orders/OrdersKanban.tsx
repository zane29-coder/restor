import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  OrderStatus,
  canTransitionOrderStatus,
  type Order,
} from '@restor/shared-types';
import { IconClock } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { ago, som } from '../../lib/format';
import { ORDER_TYPE_LABELS, STATUS_LABELS } from '../../lib/labels';
import { itemsSummary } from '../../lib/orders';

interface Column {
  key: string;
  title: string;
  /** Statuses shown in this column. */
  statuses: OrderStatus[];
  /** Where a card dropped here moves to. */
  target: OrderStatus;
  tone: string;
}

const COLUMNS: Column[] = [
  { key: 'new', title: 'Yangi', statuses: [OrderStatus.NEW], target: OrderStatus.NEW, tone: 'var(--info)' },
  { key: 'accepted', title: 'Qabul qilindi', statuses: [OrderStatus.ACCEPTED], target: OrderStatus.ACCEPTED, tone: 'var(--violet-ink)' },
  { key: 'preparing', title: 'Tayyorlanmoqda', statuses: [OrderStatus.PREPARING], target: OrderStatus.PREPARING, tone: 'var(--warning)' },
  { key: 'ready', title: 'Tayyor', statuses: [OrderStatus.READY], target: OrderStatus.READY, tone: 'var(--success)' },
  {
    key: 'delivery',
    title: 'Yetkazishda',
    statuses: [OrderStatus.WAITING_COURIER, OrderStatus.COURIER_ASSIGNED, OrderStatus.ON_DELIVERY],
    target: OrderStatus.WAITING_COURIER,
    tone: 'var(--primary)',
  },
];

/**
 * The live board: one column per stage, cards dragged forward.
 *
 * A drop is only accepted where `canTransitionOrderStatus` allows it — the
 * same rule the API enforces — and the column lights up only for those, so
 * the board cannot suggest a move it will then refuse.
 */
export function OrdersKanban({
  orders,
  selectedId,
  onOpen,
  canChange,
}: {
  orders: Order[];
  selectedId: string | null;
  onOpen: (order: Order) => void;
  canChange: boolean;
}) {
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      api.orders.updateStatus(id, { status }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['live'] });
    },
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Holat oʻzgarmadi'),
  });

  const accepts = (column: Column) =>
    dragging !== null &&
    !column.statuses.includes(dragging.status) &&
    canTransitionOrderStatus(dragging.status, column.target);

  return (
    <div className="stack">
      {error && <div className="alert alert--error" style={{ margin: 0 }}>{error}</div>}
      <div className="kanban">
        {COLUMNS.map((column) => {
          const cards = orders.filter((o) => column.statuses.includes(o.status));
          const droppable = accepts(column);
          return (
            <section
              key={column.key}
              className={`kanban__col${droppable ? ' kanban__col--drop' : ''}`}
              onDragOver={(event) => {
                if (droppable) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging && droppable) move.mutate({ id: dragging.id, status: column.target });
                setDragging(null);
              }}
              aria-label={column.title}
            >
              <header className="kanban__head">
                <span className="row" style={{ gap: 8 }}>
                  <span className="status-dot" style={{ background: column.tone }} />
                  {column.title}
                </span>
                <span className="tabs__count">{cards.length}</span>
              </header>
              <div className="kanban__cards">
                {cards.length === 0 && <p className="kanban__empty">Boʻsh</p>}
                {cards.map((order) => (
                  <article
                    key={order.id}
                    className={`kanban__card${order.id === selectedId ? ' kanban__card--selected' : ''}`}
                    draggable={canChange}
                    onDragStart={() => setDragging(order)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => onOpen(order)}
                    tabIndex={0}
                    onKeyDown={(event) => event.key === 'Enter' && onOpen(order)}
                  >
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>#{order.displayNumber}</strong>
                      <span className="cell-sub row" style={{ gap: 3 }}>
                        <IconClock size={12} />
                        {ago(order.createdAt)}
                      </span>
                    </div>
                    <div className="cell-sub ellipsis">{itemsSummary(order)}</div>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="pill tone-neutral">
                        {ORDER_TYPE_LABELS[order.type] ?? order.type}
                        {order.tableNumber ? ` · ${order.tableNumber}` : ''}
                      </span>
                      <span className="cell-main num">{som(order.total)}</span>
                    </div>
                    {column.statuses.length > 1 && (
                      <span className="cell-sub">{STATUS_LABELS[order.status]}</span>
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
