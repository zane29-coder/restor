import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReservationStatus,
  type RestaurantTable,
  type TableReservation,
} from '@restor/shared-types';
import { IconCalendar, IconCheck, IconPlus, IconSave, IconUsers } from '@restor/ui';
import { api, RestorApiError } from '../../lib/api';
import { isoDay, phone, timeOf } from '../../lib/format';
import {
  RESERVATION_LABELS,
  RESERVATION_TONES,
  localInstant,
  minutesSinceMidnight,
  zoneName,
} from '../../lib/tables';
import { Drawer } from '../Drawer';
import { ErrorState, Loading } from '../States';
import { Seg } from '../ui';

const HOLDING: ReservationStatus[] = [ReservationStatus.BOOKED, ReservationStatus.SEATED];
const DURATIONS = [60, 90, 120, 180] as const;

const endOf = (r: Pick<TableReservation, 'startsAt' | 'durationMinutes'>) =>
  new Date(new Date(r.startsAt).getTime() + r.durationMinutes * 60_000);

function dayWindow(day: string) {
  const from = new Date(`${day}T00:00:00`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() };
}

/**
 * The bookings board for one branch and one day: a timeline per table, so a
 * double booking or a gap for a walk-in is visible at a glance, and the list
 * the host works through as parties arrive.
 */
export function ReservationsBoard({
  branchId,
  tables,
  canManage,
  initialForm,
  onFormClosed,
  onNotice,
}: {
  branchId: string;
  tables: RestaurantTable[];
  canManage: boolean;
  /** Opens the form pre-filled, e.g. from "Bron qilish" on a table. */
  initialForm?: { tableId: string } | null;
  onFormClosed?: () => void;
  onNotice: (notice: { ok: boolean; text: string }) => void;
}) {
  const [day, setDay] = useState(() => isoDay(new Date()));
  const [form, setForm] = useState<{ reservation: TableReservation | null; tableId?: string; time?: string } | null>(
    initialForm ? { reservation: null, tableId: initialForm.tableId } : null,
  );

  const query = useQuery({
    queryKey: ['reservations', branchId, day],
    queryFn: () => api.tables.listReservations({ branchId, ...dayWindow(day) }),
    refetchInterval: 30_000,
  });

  const items = query.data ?? [];
  const live = items.filter((r) => r.status !== ReservationStatus.CANCELLED);
  const guests = live.reduce((sum, r) => sum + r.partySize, 0);
  const activeTables = tables.filter((t) => t.isActive);
  const unassigned = items.filter((r) => !r.tableId && HOLDING.includes(r.status));

  // The visible span: the usual service hours, stretched to fit any booking
  // made outside them.
  const startHour = Math.min(10, ...live.map((r) => Math.floor(minutesSinceMidnight(r.startsAt) / 60)));
  const endHour = 24;
  const span = (endHour - startHour) * 60;
  const pos = (r: TableReservation) => {
    const start = minutesSinceMidnight(r.startsAt) - startHour * 60;
    return { left: `${(start / span) * 100}%`, width: `${(Math.min(r.durationMinutes, span - start) / span) * 100}%` };
  };
  const today = isoDay(new Date());
  const nowLine = day === today ? ((minutesSinceMidnight(new Date().toISOString()) - startHour * 60) / span) * 100 : null;

  const shiftDay = (delta: number) => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDay(isoDay(d));
  };

  const close = () => {
    setForm(null);
    onFormClosed?.();
  };

  return (
    <section className="stack" style={{ gap: 14 }}>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => shiftDay(-1)} aria-label="Oldingi kun">‹</button>
          <Seg
            label="Kun"
            quiet
            options={[
              { value: today, label: 'Bugun' },
              { value: isoDay(new Date(Date.now() + 86_400_000)), label: 'Ertaga' },
            ]}
            value={day}
            onChange={setDay}
          />
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Sana" />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => shiftDay(1)} aria-label="Keyingi kun">›</button>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span className="row muted" style={{ gap: 5, fontSize: 13, whiteSpace: 'nowrap' }}>
            <IconCalendar size={14} /> {live.length} ta bron <IconUsers size={14} style={{ marginLeft: 6 }} /> {guests} mehmon
          </span>
          {canManage && (
            <button type="button" className="btn" onClick={() => setForm({ reservation: null })}>
              <IconPlus size={16} /> Yangi bron
            </button>
          )}
        </div>
      </div>

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="card card--flush">
            <div className="res-timeline">
              <div className="res-timeline__row res-timeline__row--head">
                <span className="res-timeline__label">Stol</span>
                <div className="res-timeline__track">
                  {Array.from({ length: endHour - startHour }, (_, i) => (
                    <span key={i} className="res-timeline__hour" style={{ left: `${(i / (endHour - startHour)) * 100}%` }}>
                      {String(startHour + i).padStart(2, '0')}
                    </span>
                  ))}
                </div>
              </div>
              {activeTables.map((table) => {
                const rows = items.filter((r) => r.tableId === table.id && r.status !== ReservationStatus.CANCELLED);
                return (
                  <div key={table.id} className="res-timeline__row">
                    <span className="res-timeline__label">
                      <b>{table.number}</b>
                      <small>{table.seats ?? '–'} oʻrin · {zoneName(table.zone)}</small>
                    </span>
                    <div
                      className="res-timeline__track"
                      style={{ backgroundSize: `${100 / (endHour - startHour)}% 100%` }}
                      onDoubleClick={(e) => {
                        if (!canManage) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const minutes = startHour * 60 + ((e.clientX - rect.left) / rect.width) * span;
                        const rounded = Math.round(minutes / 30) * 30;
                        setForm({
                          reservation: null,
                          tableId: table.id,
                          time: `${String(Math.floor(rounded / 60) % 24).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`,
                        });
                      }}
                    >
                      {nowLine !== null && nowLine >= 0 && nowLine <= 100 && <span className="res-timeline__now" style={{ left: `${nowLine}%` }} />}
                      {rows.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className={`res-bar ${RESERVATION_TONES[r.status]}`}
                          style={pos(r)}
                          title={`${timeOf(r.startsAt)}–${timeOf(endOf(r))} · ${r.guestName} · ${r.partySize} kishi`}
                          onClick={() => setForm({ reservation: r })}
                        >
                          {timeOf(r.startsAt)} {r.guestName}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {canManage && <p className="card__sub" style={{ padding: '8px 16px 12px' }}>Boʻsh joyga ikki marta bosing — shu stol va vaqtga bron ochiladi.</p>}
          </div>

          {unassigned.length > 0 && (
            <p className="banner banner--warning" style={{ margin: 0 }}>
              {unassigned.length} ta bronga hali stol tanlanmagan: {unassigned.map((r) => `${timeOf(r.startsAt)} ${r.guestName}`).join(', ')}
            </p>
          )}

          <div className="card card--flush">
            <div className="table-wrap">
              <table style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Vaqt</th>
                    <th>Mehmon</th>
                    <th className="td-right">Kishi</th>
                    <th>Stol</th>
                    <th>Holat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>Bu kunga bron yoʻq</td>
                    </tr>
                  ) : (
                    items.map((r) => (
                      <tr key={r.id} className="row--clickable" onClick={() => setForm({ reservation: r })}>
                        <td className="num cell-main">{timeOf(r.startsAt)}–{timeOf(endOf(r))}</td>
                        <td>
                          <div className="cell-main">{r.guestName}</div>
                          <div className="cell-sub">{phone(r.guestPhone)}{r.note ? ` · ${r.note}` : ''}</div>
                        </td>
                        <td className="td-right num">{r.partySize}</td>
                        <td>{r.tableNumber ?? <span className="pill tone-warning">tanlanmagan</span>}</td>
                        <td><span className={`pill ${RESERVATION_TONES[r.status]}`}>{RESERVATION_LABELS[r.status]}</span></td>
                        <td className="td-right" onClick={(e) => e.stopPropagation()}>
                          {canManage && <QuickActions reservation={r} onNotice={onNotice} />}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {form && (
        <ReservationForm
          branchId={branchId}
          tables={activeTables}
          reservation={form.reservation}
          defaults={{ day, tableId: form.tableId, time: form.time }}
          dayReservations={items}
          canManage={canManage}
          onClose={close}
          onSaved={(text) => {
            close();
            onNotice({ ok: true, text });
          }}
        />
      )}
    </section>
  );
}

function useMoveReservation(onNotice: (n: { ok: boolean; text: string }) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReservationStatus }) => api.tables.updateReservation(id, { status }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['tables', 'floor'] });
      onNotice({ ok: true, text: `${r.guestName}: ${RESERVATION_LABELS[r.status].toLowerCase()}` });
    },
    onError: (e) => onNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Oʻzgartirilmadi' }),
  });
}

/** The one or two moves a host makes from the list without opening the form. */
function QuickActions({ reservation, onNotice }: { reservation: TableReservation; onNotice: (n: { ok: boolean; text: string }) => void }) {
  const move = useMoveReservation(onNotice);
  if (reservation.status === ReservationStatus.BOOKED) {
    return (
      <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn--sm" disabled={move.isPending || !reservation.tableId} title={reservation.tableId ? undefined : 'Avval stol tanlang'} onClick={() => move.mutate({ id: reservation.id, status: ReservationStatus.SEATED })}>
          Oʻtqazish
        </button>
        <button type="button" className="btn btn--sm btn--ghost" disabled={move.isPending} onClick={() => move.mutate({ id: reservation.id, status: ReservationStatus.NO_SHOW })}>
          Kelmadi
        </button>
      </span>
    );
  }
  if (reservation.status === ReservationStatus.SEATED) {
    return (
      <button type="button" className="btn btn--sm btn--ghost" disabled={move.isPending} onClick={() => move.mutate({ id: reservation.id, status: ReservationStatus.COMPLETED })}>
        <IconCheck size={13} /> Yakunlash
      </button>
    );
  }
  return null;
}

/**
 * Create or edit a booking.
 *
 * The table list marks what is already taken around the chosen time, so a
 * clash is avoided before the server has to refuse it.
 */
export function ReservationForm({
  branchId,
  tables,
  reservation,
  defaults,
  dayReservations,
  canManage,
  onClose,
  onSaved,
}: {
  branchId: string;
  tables: RestaurantTable[];
  reservation: TableReservation | null;
  defaults: { day: string; tableId?: string; time?: string };
  dayReservations: TableReservation[];
  canManage: boolean;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const start = reservation ? new Date(reservation.startsAt) : null;
  const [guestName, setGuestName] = useState(reservation?.guestName ?? '');
  const [guestPhone, setGuestPhone] = useState(reservation?.guestPhone ?? '+998');
  const [partySize, setPartySize] = useState(String(reservation?.partySize ?? 2));
  const [day, setDay] = useState(start ? isoDay(start) : defaults.day);
  const [time, setTime] = useState(start ? timeOf(start) : defaults.time ?? '19:00');
  const [duration, setDuration] = useState(reservation?.durationMinutes ?? 120);
  const [tableId, setTableId] = useState(reservation?.tableId ?? defaults.tableId ?? '');
  const [note, setNote] = useState(reservation?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const editable = canManage && (!reservation || HOLDING.includes(reservation.status));
  const party = Number(partySize.replace(/\D/g, '')) || 0;

  // Clashes are only knowable for the day already loaded; another day is left
  // to the server, which checks every save anyway.
  const busy = useMemo(() => {
    if (day !== defaults.day || !time) return new Map<string, string>();
    const from = new Date(`${day}T${time}:00`).getTime();
    const to = from + duration * 60_000;
    const map = new Map<string, string>();
    for (const r of dayReservations) {
      if (!r.tableId || r.id === reservation?.id || !HOLDING.includes(r.status)) continue;
      const rFrom = new Date(r.startsAt).getTime();
      if (rFrom < to && from < rFrom + r.durationMinutes * 60_000) map.set(r.tableId, `${timeOf(r.startsAt)} ${r.guestName}`);
    }
    return map;
  }, [day, time, duration, dayReservations, reservation?.id, defaults.day]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['tables', 'floor'] });
  };
  const fail = (e: unknown) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi');

  const save = useMutation({
    mutationFn: () => {
      const body = {
        tableId: tableId || null,
        guestName: guestName.trim(),
        guestPhone: guestPhone.replace(/[^\d+]/g, ''),
        partySize: party,
        startsAt: localInstant(day, time),
        durationMinutes: duration,
        note: note.trim() || null,
      };
      return reservation ? api.tables.updateReservation(reservation.id, body) : api.tables.createReservation({ ...body, branchId });
    },
    onSuccess: (r) => {
      refresh();
      onSaved(reservation ? `${r.guestName} broni saqlandi` : `${r.guestName} uchun ${timeOf(r.startsAt)} ga bron qilindi`);
    },
    onError: fail,
  });

  const move = useMutation({
    mutationFn: (status: ReservationStatus) => api.tables.updateReservation(reservation!.id, { status }),
    onSuccess: (r) => {
      refresh();
      onSaved(`${r.guestName}: ${RESERVATION_LABELS[r.status].toLowerCase()}`);
    },
    onError: fail,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (guestName.trim().length < 2) return setError('Mehmon ismini kiriting');
    if (guestPhone.replace(/\D/g, '').length < 12) return setError('Telefon raqamini toʻliq kiriting');
    if (party < 1) return setError('Mehmonlar sonini kiriting');
    if (!day || !time) return setError('Sana va vaqtni kiriting');
    setError(null);
    save.mutate();
  }

  const chosen = tables.find((t) => t.id === tableId);
  const tooSmall = chosen?.seats && party > chosen.seats;

  return (
    <Drawer
      title={reservation ? `Bron — ${reservation.guestName}` : 'Yangi bron'}
      onClose={onClose}
      footer={
        <>
          {error && <span className="field__error" style={{ flex: 1, alignSelf: 'center' }}>{error}</span>}
          {reservation && canManage && reservation.status === ReservationStatus.BOOKED && (
            <>
              <button type="button" className="btn btn--danger-soft" disabled={move.isPending} onClick={() => move.mutate(ReservationStatus.CANCELLED)}>Bekor qilish</button>
              <button type="button" className="btn btn--ghost" disabled={move.isPending} onClick={() => move.mutate(ReservationStatus.NO_SHOW)}>Kelmadi</button>
            </>
          )}
          {reservation && canManage && reservation.status === ReservationStatus.SEATED && (
            <button type="button" className="btn btn--ghost" disabled={move.isPending} onClick={() => move.mutate(ReservationStatus.COMPLETED)}>
              <IconCheck size={15} /> Yakunlash
            </button>
          )}
          {editable ? (
            <button type="submit" form="reservation-form" className="btn" disabled={save.isPending}>
              <IconSave size={16} /> {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={onClose}>Yopish</button>
          )}
        </>
      }
    >
      {reservation && (
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <span className={`pill ${RESERVATION_TONES[reservation.status]}`}>{RESERVATION_LABELS[reservation.status]}</span>
          {reservation.createdByName && <span className="muted" style={{ fontSize: 12.5 }}>Qabul qildi: {reservation.createdByName}</span>}
        </div>
      )}
      <form id="reservation-form" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <fieldset disabled={!editable} className="stack" style={{ gap: 14, border: 0, padding: 0, margin: 0 }}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="rf-name">Mehmon ismi</label>
              <input id="rf-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} autoFocus={!reservation} />
            </div>
            <div className="field">
              <label htmlFor="rf-phone">Telefon</label>
              <input id="rf-phone" type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+998 90 123 45 67" />
            </div>
            <div className="field">
              <label htmlFor="rf-day">Sana</label>
              <input id="rf-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rf-time">Vaqt</label>
              <input id="rf-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rf-party">Mehmonlar soni</label>
              <input id="rf-party" inputMode="numeric" value={partySize} onChange={(e) => setPartySize(e.target.value)} />
            </div>
            <div className="field">
              <span className="field__label">Davomiyligi</span>
              <Seg
                label="Davomiyligi"
                options={DURATIONS.map((m) => ({ value: String(m), label: m === 90 ? '1,5 soat' : `${m / 60} soat` }))}
                value={String(duration)}
                onChange={(v) => setDuration(Number(v))}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="rf-table">Stol</label>
            <select id="rf-table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">Keyinroq tanlanadi</option>
              {tables.map((t) => {
                const taken = busy.get(t.id);
                return (
                  <option key={t.id} value={t.id} disabled={Boolean(taken)}>
                    {t.number} · {t.seats ?? '–'} oʻrin · {zoneName(t.zone)}{taken ? ` — band (${taken})` : ''}
                  </option>
                );
              })}
            </select>
            {tooSmall && <span className="field__hint" style={{ color: 'var(--warning)' }}>Bu stol {chosen.seats} kishilik — {party} kishi uchun stol qoʻshish kerak boʻladi</span>}
          </div>
          <div className="field">
            <label htmlFor="rf-note">Izoh</label>
            <textarea id="rf-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tugʻilgan kun, bolalar stuli, deraza yoni…" />
          </div>
        </fieldset>
      </form>
    </Drawer>
  );
}
