import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReservationStatus,
  WaiterCallStatus,
  WaiterCallType,
  type FloorTable,
} from '@restor/shared-types';
import { IconCalendar, IconCopy, IconEdit, IconExternal, IconPrint, IconRefresh } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { ago, minutesBetween, phone, som, timeOf } from '../../lib/format';
import { posUrl } from '../../lib/pos';
import { qrImageUrl } from '../../lib/print';
import {
  RESERVATION_LABELS,
  RESERVATION_TONES,
  SHAPE_LABELS,
  TABLE_STATE_LABELS,
  TABLE_STATE_TONES,
  tableState,
  zoneName,
} from '../../lib/tables';
import { StatusBadge } from '../StatusBadge';
import { SidePanel } from '../ui';

type Notify = (notice: { ok: boolean; text: string }) => void;

/**
 * Everything about one table: its code, who is at it and what they ordered,
 * who is coming, and who is waving for a waiter.
 *
 * Money is taken at the till, not here — the panel links to the POS instead
 * of growing a second checkout.
 */
export function TablePanel({
  table,
  canManage,
  canHandle,
  canReserve,
  onClose,
  onEdit,
  onReserve,
  onPrint,
  onNotice,
}: {
  table: FloorTable;
  canManage: boolean;
  canHandle: boolean;
  canReserve: boolean;
  onClose: () => void;
  onEdit: () => void;
  onReserve: () => void;
  onPrint: () => void;
  onNotice: Notify;
}) {
  const queryClient = useQueryClient();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const state = tableState(table);
  const pos = posUrl();

  const order = useQuery({
    queryKey: ['orders', table.openOrder?.id],
    queryFn: () => api.orders.get(table.openOrder!.id),
    enabled: Boolean(table.openOrder),
  });

  const refreshFloor = () => void queryClient.invalidateQueries({ queryKey: ['tables'] });
  const fail = (e: unknown, fallback: string) => onNotice({ ok: false, text: e instanceof RestorApiError ? e.message : fallback });

  const rotate = useMutation({
    mutationFn: () => api.tables.rotateQr(table.id),
    onSuccess: () => {
      setConfirmRotate(false);
      refreshFloor();
      onNotice({ ok: true, text: `${table.number}-stol QR kodi yangilandi — eski chop etilganlari endi ishlamaydi` });
    },
    onError: (e) => fail(e, 'Yangilanmadi'),
  });

  const handleCall = useMutation({
    mutationFn: ({ id, step }: { id: string; step: 'ack' | 'resolve' }) =>
      step === 'ack' ? api.tables.acknowledgeCall(id) : api.tables.resolveCall(id),
    onSuccess: () => {
      refreshFloor();
      void queryClient.invalidateQueries({ queryKey: ['waiter-calls'] });
    },
    onError: (e) => fail(e, 'Amal bajarilmadi'),
  });

  const moveReservation = useMutation({
    mutationFn: (status: ReservationStatus) => api.tables.updateReservation(table.reservation!.id, { status }),
    onSuccess: (r) => {
      refreshFloor();
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      onNotice({ ok: true, text: `${r.guestName}: ${RESERVATION_LABELS[r.status].toLowerCase()}` });
    },
    onError: (e) => fail(e, 'Oʻzgartirilmadi'),
  });

  return (
    <SidePanel
      title={`${table.number}-stol`}
      sub={`${zoneName(table.zone)}${table.name ? ` · ${table.name}` : ''}`}
      headerExtra={<span className={`pill ${TABLE_STATE_TONES[state]}`}>{TABLE_STATE_LABELS[state]}</span>}
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', width: '100%' }}>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onPrint}>
            <IconPrint size={14} /> QR chop etish
          </button>
          {canManage &&
            (confirmRotate ? (
              <>
                <button type="button" className="btn btn--sm btn--danger" disabled={rotate.isPending} onClick={() => rotate.mutate()}>Ha, yangilansin</button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirmRotate(false)}>Yoʻq</button>
              </>
            ) : (
              <button type="button" className="btn btn--sm btn--ghost" title="Eski chop etilgan QR kodlar ishlamay qoladi" onClick={() => setConfirmRotate(true)}>
                <IconRefresh size={14} /> QR yangilash
              </button>
            ))}
          {canManage && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={onEdit}>
              <IconEdit size={14} /> Tahrirlash
            </button>
          )}
          {canReserve && table.isActive && (
            <button type="button" className="btn btn--sm" onClick={onReserve}>
              <IconCalendar size={14} /> Bron qilish
            </button>
          )}
        </div>
      }
    >
      {table.calls.length > 0 && (
        <section className="stack" style={{ gap: 8, marginBottom: 16 }}>
          {table.calls.map((call) => (
            <div key={call.id} className={`banner ${call.status === WaiterCallStatus.PENDING ? 'banner--warning' : 'banner--info'}`}>
              <div style={{ flex: 1 }}>
                <b>{call.type === WaiterCallType.REQUEST_BILL ? 'Hisob soʻradi' : 'Ofitsiantni chaqirdi'}</b>
                <div style={{ fontSize: 12 }}>{minutesBetween(call.createdAt)} daqiqa kutmoqda{call.status === WaiterCallStatus.ACKNOWLEDGED ? ' · ofitsiant yoʻlda' : ''}</div>
              </div>
              {canHandle &&
                (call.status === WaiterCallStatus.PENDING ? (
                  <button type="button" className="btn btn--sm" disabled={handleCall.isPending} onClick={() => handleCall.mutate({ id: call.id, step: 'ack' })}>Ketdim</button>
                ) : (
                  <button type="button" className="btn btn--sm" disabled={handleCall.isPending} onClick={() => handleCall.mutate({ id: call.id, step: 'resolve' })}>Bajarildi</button>
                ))}
            </div>
          ))}
        </section>
      )}

      <div className="qr-box">
        <img src={qrImageUrl(table.qrUrl, 200)} alt={`${table.number}-stol QR kodi`} width={160} height={160} />
        <div className="qr-box__link">
          <span className="muted" style={{ fontSize: 11.5 }}>QR menyu havolasi</span>
          <code title={table.qrUrl}>{table.qrUrl.replace(/^https?:\/\//, '')}</code>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label="Havoladan nusxa olish"
            onClick={() => void navigator.clipboard?.writeText(table.qrUrl).then(() => onNotice({ ok: true, text: 'Havola nusxalandi' }))}
          >
            <IconCopy size={14} />
          </button>
        </div>
      </div>

      <dl className="kv" style={{ marginTop: 14 }}>
        <dt>Sigʻimi</dt><dd>{table.seats ? `${table.seats} kishi` : '—'}</dd>
        <dt>Zona</dt><dd>{zoneName(table.zone)}</dd>
        <dt>Shakli</dt><dd>{SHAPE_LABELS[table.shape]}</dd>
        <dt>QR</dt><dd>{table.isActive ? 'Ishlaydi' : 'Stol oʻchiq — QR ishlamaydi'}</dd>
      </dl>

      {table.reservation && (
        <section className="soft-box" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{table.reservation.status === ReservationStatus.SEATED ? 'Bron boʻyicha oʻtirishibdi' : `Bron: ${timeOf(table.reservation.startsAt)}`}</b>
            <span className={`pill ${RESERVATION_TONES[table.reservation.status]}`}>{RESERVATION_LABELS[table.reservation.status]}</span>
          </div>
          <div style={{ marginTop: 6 }}>{table.reservation.guestName} · {table.reservation.partySize} kishi</div>
          <div className="cell-sub">{phone(table.reservation.guestPhone)}{table.reservation.note ? ` · ${table.reservation.note}` : ''}</div>
          {canReserve && (
            <div className="row" style={{ gap: 6, marginTop: 10 }}>
              {table.reservation.status === ReservationStatus.BOOKED ? (
                <>
                  <button type="button" className="btn btn--sm" disabled={moveReservation.isPending} onClick={() => moveReservation.mutate(ReservationStatus.SEATED)}>Mehmonni oʻtqazish</button>
                  <button type="button" className="btn btn--sm btn--ghost" disabled={moveReservation.isPending} onClick={() => moveReservation.mutate(ReservationStatus.NO_SHOW)}>Kelmadi</button>
                </>
              ) : (
                <button type="button" className="btn btn--sm btn--ghost" disabled={moveReservation.isPending} onClick={() => moveReservation.mutate(ReservationStatus.COMPLETED)}>Stol boʻshadi</button>
              )}
            </div>
          )}
        </section>
      )}

      {table.openOrder && (
        <section style={{ marginTop: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 className="card__title">Joriy buyurtma #{table.openOrder.displayNumber}</h3>
            <StatusBadge status={table.openOrder.status} />
          </div>
          <div className="cell-sub" style={{ marginBottom: 8 }}>
            {timeOf(table.openOrder.createdAt)} da ochilgan ({ago(table.openOrder.createdAt)})
            {table.openOrder.createdByName ? ` · ${table.openOrder.createdByName}` : ''}
          </div>
          {order.data ? (
            <ul className="line-items">
              {order.data.items.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.quantity}× {item.name}
                    {item.variantName ? ` (${item.variantName})` : ''}
                  </span>
                  <span className="num">{som(item.total)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>{table.openOrder.itemCount} ta mahsulot</p>
          )}
          <div className="row line-items__total">
            <span>Jami hisob</span>
            <span className="num">{som(table.openOrder.total)}</span>
          </div>
          {pos && (
            <a className="btn btn--sm btn--ghost" style={{ marginTop: 10 }} href={pos} target="_blank" rel="noreferrer">
              <IconExternal size={14} /> Hisobni POSda yopish
            </a>
          )}
        </section>
      )}

      {state === 'free' && !table.reservation && (
        <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>Stol boʻsh. Mehmon QR kodni skanerlab buyurtma beradi yoki kassada ochiladi.</p>
      )}
    </SidePanel>
  );
}
