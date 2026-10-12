import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CourierStatus,
  OrderStatus,
  OrderType,
  PaymentStatus,
  Permission,
  type Order,
} from '@restor/shared-types';
import {
  IconBolt,
  IconCheck,
  IconClock,
  IconDownload,
  IconEye,
  IconKanban,
  IconList,
  IconMap,
  IconPrint,
  IconRefresh,
  IconSearch,
} from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { ago, daysAgo, initialsOf, phone, som, timeOf, dateTimeOf } from '../lib/format';
import {
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from '../lib/labels';
import { ACTIVE_STATUSES, itemsSummary } from '../lib/orders';
import { printOrder } from '../lib/print';
import { OrderPanel } from '../components/orders/OrderPanel';
import { OrdersKanban } from '../components/orders/OrdersKanban';
import { StatusBadge } from '../components/StatusBadge';
import { ErrorState, Loading } from '../components/States';
import { LivePill, PageHeader, Pager, Seg, downloadCsv } from '../components/ui';

type DateKey = 'today' | 'yesterday' | '7d' | '30d' | 'all';

const DATE_OPTIONS: Array<{ value: DateKey; label: string }> = [
  { value: 'today', label: 'Bugun' },
  { value: 'yesterday', label: 'Kecha' },
  { value: '7d', label: '7 kun' },
  { value: '30d', label: '30 kun' },
  { value: 'all', label: 'Barchasi' },
];

/** ISO instants for the list endpoint, which takes datetimes rather than days. */
function rangeFor(key: DateKey): { dateFrom?: string; dateTo?: string } {
  switch (key) {
    case 'today':
      return { dateFrom: daysAgo(0).toISOString() };
    case 'yesterday':
      return { dateFrom: daysAgo(1).toISOString(), dateTo: new Date(daysAgo(0).getTime() - 1).toISOString() };
    case '7d':
      return { dateFrom: daysAgo(6).toISOString() };
    case '30d':
      return { dateFrom: daysAgo(29).toISOString() };
    default:
      return {};
  }
}

/** The pipeline strip, in the order an order moves through it. */
const COUNTER_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.WAITING_COURIER,
  OrderStatus.COURIER_ASSIGNED,
  OrderStatus.ON_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

/**
 * Orders: the operator's live board (TZ §46).
 *
 * Two views over one set of filters — a paginated table for finding and
 * reviewing, and a kanban of the orders still in flight for running the
 * floor. Either opens the same detail panel, and `?id=` opens it directly
 * (the dashboard, the bell and the search all link that way).
 */
export function OrdersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { branchId, current } = useBranch();
  const [params, setParams] = useSearchParams();

  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [type, setType] = useState<OrderType | ''>('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | ''>('');
  const [dateKey, setDateKey] = useState<DateKey>('today');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);

  const openId = params.get('id');
  const open = (order: Order | null) => {
    const next = new URLSearchParams(params);
    if (order) next.set('id', order.id);
    else next.delete('id');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  // Any filter change starts again from page one with nothing selected.
  useEffect(() => {
    setPage(1);
    setSelection(new Set());
  }, [status, type, paymentStatus, dateKey, search, branchId, limit]);

  const filters = {
    branchId: branchId || undefined,
    type: type || undefined,
    paymentStatus: paymentStatus || undefined,
    search: search || undefined,
    ...rangeFor(dateKey),
  };

  const counts = useQuery({
    queryKey: ['orders', 'counts', filters],
    queryFn: () => api.orders.counts(filters),
    refetchInterval: 15_000,
  });

  const list = useQuery({
    queryKey: ['orders', 'list', filters, status, page, limit],
    queryFn: () => api.orders.list({ ...filters, status: status || undefined, page, limit }),
    enabled: view === 'table',
    refetchInterval: 10_000,
    placeholderData: (previous) => previous,
  });

  // The board shows only what is still moving, whatever the date filter says
  // about history: an order from yesterday still in the kitchen belongs on it.
  const board = useQuery({
    queryKey: ['orders', 'board', branchId, type, search],
    queryFn: () =>
      api.orders.list({
        branchId: branchId || undefined,
        type: type || undefined,
        search: search || undefined,
        status: ACTIVE_STATUSES,
        limit: 100,
      }),
    enabled: view === 'kanban',
    refetchInterval: 10_000,
  });

  const couriersFree = useQuery({
    queryKey: ['couriers', 'count', CourierStatus.AVAILABLE, branchId],
    queryFn: () => api.couriers.list({ status: CourierStatus.AVAILABLE, branchId: branchId || undefined, limit: 1 }),
    enabled: can(Permission.COURIERS_VIEW),
    refetchInterval: 30_000,
  });
  const couriersBusy = useQuery({
    queryKey: ['couriers', 'count', CourierStatus.ON_DELIVERY, branchId],
    queryFn: () => api.couriers.list({ status: CourierStatus.ON_DELIVERY, branchId: branchId || undefined, limit: 1 }),
    enabled: can(Permission.COURIERS_VIEW),
    refetchInterval: 30_000,
  });

  const rows = list.data?.items ?? [];
  const total = list.data?.pagination.total ?? 0;
  const openOrder = useMemo(
    () => rows.find((o) => o.id === openId) ?? board.data?.items.find((o) => o.id === openId),
    [rows, board.data, openId],
  );

  const bulkAccept = useMutation({
    mutationFn: async (ids: string[]) => {
      // One at a time: the API applies each transition with its own checks,
      // and a failure on one order should not hide the others' results.
      const failures: string[] = [];
      for (const id of ids) {
        try {
          await api.orders.updateStatus(id, { status: OrderStatus.ACCEPTED });
        } catch (e) {
          failures.push(e instanceof RestorApiError ? e.message : id);
        }
      }
      return failures;
    },
    onSuccess: (failures) => {
      setBulkError(failures.length ? `${failures.length} ta buyurtma qabul qilinmadi: ${failures[0]}` : null);
      setSelection(new Set());
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['live'] });
    },
  });

  const selectedRows = rows.filter((o) => selection.has(o.id));
  const selectedNew = selectedRows.filter((o) => o.status === OrderStatus.NEW);
  const allChecked = rows.length > 0 && rows.every((o) => selection.has(o.id));

  const toggle = (id: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resetFilters = () => {
    setStatus('');
    setType('');
    setPaymentStatus('');
    setDateKey('today');
    setText('');
  };

  const countsTotal = counts.data ? Object.values(counts.data).reduce((a, b) => a + b, 0) : null;

  return (
    <div className="page">
      <PageHeader
        crumb="Buyurtmalar"
        title="Buyurtmalar"
        badge={<LivePill label="Real vaqt" />}
        subtitle="Jonli buyurtmalar oqimi, kuryer biriktirish va holatlarni boshqarish"
        actions={
          <>
            <Seg
              label="Koʻrinish"
              quiet
              value={view}
              onChange={setView}
              options={[
                { value: 'table', label: <><IconList size={15} /> Jadval</> },
                { value: 'kanban', label: <><IconKanban size={15} /> Kanban</> },
              ]}
            />
            <button
              type="button"
              className="btn btn--ghost"
              disabled={rows.length === 0}
              onClick={() => exportOrders(selectedRows.length ? selectedRows : rows)}
            >
              <IconDownload size={17} />
              Eksport
            </button>
          </>
        }
      />

      {/* Pipeline counters */}
      <div className="counter-strip" role="group" aria-label="Holat boʻyicha">
        <button
          type="button"
          className={`counter${status === '' ? ' counter--active' : ''}`}
          onClick={() => setStatus('')}
        >
          Barchasi
          <span className="counter__value">{countsTotal ?? '…'}</span>
        </button>
        {COUNTER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`counter${status === s ? ' counter--active' : ''}`}
            onClick={() => {
              setStatus(status === s ? '' : s);
              setView('table');
            }}
          >
            {STATUS_LABELS[s]}
            <span className="counter__value">{counts.data ? counts.data[s] : '…'}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="toolbar">
        <div className="search-input">
          <IconSearch size={16} />
          <input
            type="search"
            placeholder="Buyurtma raqami, mijoz ismi yoki telefon…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Buyurtmalarni qidirish"
          />
        </div>
        <select value={type} onChange={(event) => setType(event.target.value as OrderType | '')} aria-label="Buyurtma turi">
          <option value="">Barcha turlar</option>
          {Object.values(OrderType).map((t) => (
            <option key={t} value={t}>{ORDER_TYPE_LABELS[t] ?? t}</option>
          ))}
        </select>
        <select
          value={paymentStatus}
          onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus | '')}
          aria-label="Toʻlov holati"
        >
          <option value="">Toʻlov: barchasi</option>
          {Object.values(PaymentStatus).map((p) => (
            <option key={p} value={p}>{PAYMENT_STATUS_LABELS[p] ?? p}</option>
          ))}
        </select>
        <Seg label="Sana" quiet value={dateKey} onChange={setDateKey} options={DATE_OPTIONS} />
        <button type="button" className="btn btn--ghost btn--sm" onClick={resetFilters}>
          <IconRefresh size={14} />
          Tozalash
        </button>
      </div>

      {view === 'kanban' ? (
        <div className={`split${openId ? '' : ' split--single'}`}>
          {board.isLoading ? (
            <Loading />
          ) : board.isError ? (
            <ErrorState error={board.error} onRetry={() => void board.refetch()} />
          ) : (
            <OrdersKanban
              orders={board.data?.items ?? []}
              selectedId={openId}
              onOpen={open}
              canChange={can(Permission.ORDERS_CHANGE_STATUS)}
            />
          )}
          {openId && <OrderPanel key={openId} orderId={openId} initial={openOrder} onClose={() => open(null)} />}
        </div>
      ) : (
        <div className={`split${openId ? '' : ' split--single'}`}>
          <div className="stack" style={{ minWidth: 0 }}>
            {selection.size > 0 && (
              <div className="bulk-bar">
                <IconCheck size={16} />
                <strong>{selection.size} ta tanlandi</strong>
                <span style={{ opacity: 0.7 }}>(jami {total} ta)</span>
                <span className="spacer" />
                {can(Permission.ORDERS_CHANGE_STATUS) && selectedNew.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={bulkAccept.isPending}
                    onClick={() => bulkAccept.mutate(selectedNew.map((o) => o.id))}
                  >
                    {selectedNew.length} ta yangini qabul qilish
                  </button>
                )}
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => exportOrders(selectedRows)}>
                  <IconDownload size={14} /> Eksport
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSelection(new Set())}>
                  Bekor
                </button>
              </div>
            )}
            {bulkError && <div className="alert alert--error" style={{ margin: 0 }}>{bulkError}</div>}

            <section className="card card--flush">
              {list.isLoading ? (
                <Loading />
              ) : list.isError ? (
                <div style={{ padding: 16 }}>
                  <ErrorState error={list.error} onRetry={() => void list.refetch()} />
                </div>
              ) : rows.length === 0 ? (
                <p className="muted" style={{ padding: '56px 16px', textAlign: 'center' }}>
                  Bu filtrlar boʻyicha buyurtma topilmadi
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input
                            type="checkbox"
                            aria-label="Hammasini tanlash"
                            checked={allChecked}
                            onChange={() =>
                              setSelection(allChecked ? new Set() : new Set(rows.map((o) => o.id)))
                            }
                          />
                        </th>
                        <th>Raqam / vaqt</th>
                        <th>Mijoz</th>
                        <th>Filial va turi</th>
                        <th>Tarkibi</th>
                        <th className="td-right">Summa</th>
                        <th>Holat</th>
                        <th className="td-right">Amallar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((order) => (
                        <OrderRow
                          key={order.id}
                          order={order}
                          checked={selection.has(order.id)}
                          selected={order.id === openId}
                          onCheck={() => toggle(order.id)}
                          onOpen={() => open(order)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="card__foot">
                <span>
                  {total > 0
                    ? `Koʻrsatilmoqda: ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} / ${total}`
                    : '—'}
                </span>
                <div className="row" style={{ gap: 10 }}>
                  <select
                    value={limit}
                    onChange={(event) => setLimit(Number(event.target.value))}
                    aria-label="Sahifadagi qatorlar"
                    style={{ minHeight: 30 }}
                  >
                    {[10, 20, 50, 100].map((n) => (
                      <option key={n} value={n}>{n} tadan</option>
                    ))}
                  </select>
                  <Pager page={page} totalPages={list.data?.pagination.totalPages ?? 1} onChange={setPage} />
                </div>
              </div>
            </section>

            {can(Permission.COURIERS_VIEW) && (
              <div className="toolbar" style={{ justifyContent: 'space-between' }}>
                <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                  <span className="kpi__icon tone-primary" style={{ width: 36, height: 36 }}>
                    <IconBolt size={18} />
                  </span>
                  <div>
                    <div className="cell-main">{current ? `${current.name} yetkazish markazi` : 'Yetkazish markazi'}</div>
                    <div className="cell-sub">
                      {couriersFree.data?.pagination.total ?? '…'} nafar kuryer boʻsh,{' '}
                      {couriersBusy.data?.pagination.total ?? '…'} nafari yoʻlda
                    </div>
                  </div>
                </div>
                <Link to="/couriers" className="btn btn--ghost btn--sm">
                  <IconMap size={15} />
                  Dispetcher markazi
                </Link>
              </div>
            )}
          </div>

          {openId && <OrderPanel key={openId} orderId={openId} initial={openOrder} onClose={() => open(null)} />}
        </div>
      )}
    </div>
  );
}

function OrderRow({
  order,
  checked,
  selected,
  onCheck,
  onOpen,
}: {
  order: Order;
  checked: boolean;
  selected: boolean;
  onCheck: () => void;
  onOpen: () => void;
}) {
  const { user } = useAuth();
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <tr className={`row--clickable${selected ? ' row--selected' : ''}`} onClick={onOpen}>
      <td onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" aria-label={`#${order.displayNumber} ni tanlash`} checked={checked} onChange={onCheck} />
      </td>
      <td>
        <div className="cell-stack">
          <span className="cell-main">#{order.displayNumber}</span>
          <span className="cell-sub row" style={{ gap: 3 }}>
            <IconClock size={12} />
            {timeOf(order.createdAt)} · {ago(order.createdAt)}
          </span>
        </div>
      </td>
      <td>
        <div className="cell-person">
          <span className="avatar avatar--sm">{initialsOf(order.customerName ?? order.customerPhone)}</span>
          <div className="cell-stack">
            <span className="cell-main">{order.customerName ?? 'Mehmon'}</span>
            <span className="cell-sub">{phone(order.customerPhone)}</span>
          </div>
        </div>
      </td>
      <td>
        <div className="cell-stack">
          <span>{order.branch?.name ?? '—'}</span>
          <span className="cell-sub">
            {ORDER_TYPE_LABELS[order.type] ?? order.type}
            {order.tableNumber ? ` · Stol ${order.tableNumber}` : ''}
          </span>
        </div>
      </td>
      <td style={{ maxWidth: 240 }}>
        <div className="cell-stack">
          <span className="ellipsis">{itemsSummary(order)}</span>
          <span className="cell-sub">{order.items.length} xil · {itemCount} ta</span>
        </div>
      </td>
      <td className="td-right">
        <div className="cell-stack">
          <span className="cell-main num">{som(order.total)}</span>
          <span className="cell-sub">
            {order.paymentMethod ? (PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod) : '—'}
            {order.paymentStatus === PaymentStatus.PAID ? ' · toʻlangan' : ''}
          </span>
        </div>
      </td>
      <td><StatusBadge status={order.status} /></td>
      <td className="td-right" onClick={(event) => event.stopPropagation()}>
        <div className="row" style={{ gap: 2, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            title="Chek"
            aria-label="Chekni chop etish"
            onClick={() => printOrder(order, user?.tenantName ?? 'RESTOR')}
          >
            <IconPrint size={16} />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" title="Ochish" aria-label="Tafsilotlar" onClick={onOpen}>
            <IconEye size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function exportOrders(orders: Order[]) {
  downloadCsv(`buyurtmalar_${new Date().toISOString().slice(0, 10)}`, [
    ['Raqam', 'Vaqt', 'Filial', 'Turi', 'Manba', 'Mijoz', 'Telefon', 'Tarkibi', 'Summa (soʻm)', 'Toʻlov', 'Toʻlov holati', 'Holat'],
    ...orders.map((o) => [
      o.displayNumber,
      dateTimeOf(o.createdAt),
      o.branch?.name ?? '',
      ORDER_TYPE_LABELS[o.type] ?? o.type,
      SOURCE_LABELS[o.source] ?? o.source,
      o.customerName ?? '',
      o.customerPhone ?? '',
      itemsSummary(o),
      o.total,
      o.paymentMethod ? (PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod) : '',
      PAYMENT_STATUS_LABELS[o.paymentStatus] ?? o.paymentStatus,
      STATUS_LABELS[o.status] ?? o.status,
    ]),
  ]);
}
