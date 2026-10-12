import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CourierStatus,
  HandoverStatus,
  OrderStatus,
  OrderType,
  Permission,
  type CashHandover,
  type Courier,
  type Order,
} from '@restor/shared-types';
import {
  IconAlert,
  IconBolt,
  IconCash,
  IconCheckCircle,
  IconCourier,
  IconDownload,
  IconEdit,
  IconMap,
  IconMapPin,
  IconNavigation,
  IconPhone,
  IconSearch,
  IconUserPlus,
  IconWallet,
} from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { ago, amount, dateTimeOf, initialsOf, phone, som } from '../lib/format';
import { COURIER_STATUS_LABELS, COURIER_STATUS_TONES, PAYMENT_METHOD_LABELS, VEHICLE_LABELS } from '../lib/labels';
import { CourierForm } from '../components/couriers/CourierForm';
import { CourierMap } from '../components/map/CourierMap';
import { ErrorState, Loading, Notice } from '../components/States';
import { Kpi, LivePill, PageHeader, Seg, Switch, downloadCsv } from '../components/ui';
import { digits } from '../components/menu/CatalogManagers';

type FleetFilter = 'all' | 'free' | 'busy' | 'off';

/**
 * Dispatch (TZ §23-§28): who is free, what is waiting, and the cash the
 * couriers carry — in the three columns a dispatcher works across.
 *
 * Polled because it is a live board: a stale "available" assigned to someone
 * who went offline ten minutes ago is the failure this avoids.
 */
export function CouriersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { branchId, branches, current } = useBranch();
  const [filter, setFilter] = useState<FleetFilter>('all');
  const [text, setText] = useState('');
  const [view, setView] = useState<'board' | 'map'>('board');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [form, setForm] = useState<{ courier: Courier | null } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const scope = branchId || undefined;

  const couriers = useQuery({
    queryKey: ['couriers', 'board', branchId],
    queryFn: () => api.couriers.list({ branchId: scope, limit: 100 }),
    refetchInterval: 15_000,
  });
  const live = useQuery({
    queryKey: ['couriers', 'live', branchId],
    queryFn: () => api.couriers.liveLocations(scope),
    enabled: can(Permission.COURIERS_TRACK),
    refetchInterval: 15_000,
  });
  const waiting = useQuery({
    queryKey: ['orders', 'awaiting-courier', branchId],
    queryFn: () =>
      api.orders.list({
        branchId: scope,
        type: OrderType.DELIVERY,
        status: [OrderStatus.READY, OrderStatus.WAITING_COURIER],
        limit: 50,
      }),
    refetchInterval: 10_000,
  });
  const handovers = useQuery({
    queryKey: ['handovers', branchId],
    queryFn: () => api.couriers.listHandovers({ branchId: scope, limit: 100 }),
    enabled: can(Permission.COURIER_WALLET_VIEW),
    refetchInterval: 20_000,
  });
  const branchFull = useQuery({
    queryKey: ['branches', 'one', branchId],
    queryFn: () => api.branches.get(branchId),
    enabled: Boolean(branchId) && can(Permission.BRANCHES_VIEW),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['couriers'] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['handovers'] });
    void queryClient.invalidateQueries({ queryKey: ['live'] });
  };

  const dispatch = useMutation({
    mutationFn: () => api.couriers.dispatchWaiting(scope),
    onSuccess: (r) => {
      setNotice({
        ok: true,
        text: r.assigned
          ? `${r.assigned} ta buyurtma kuryerga biriktirildi${r.waiting ? `, ${r.waiting} tasi boʻsh kuryer kutmoqda` : ''}`
          : r.waiting
            ? `Hozir boʻsh kuryer yoʻq — ${r.waiting} ta buyurtma kutmoqda`
            : 'Kuryer kutayotgan buyurtma yoʻq',
      });
      invalidate();
    },
    onError: (e) => setNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Taqsimlanmadi' }),
  });

  const toggleAuto = useMutation({
    mutationFn: (on: boolean) => api.branches.update(branchId, { autoDispatch: on }),
    onSuccess: (b) => {
      setNotice({ ok: true, text: b.autoDispatch ? `${b.name}: avto-dispatch yoqildi` : `${b.name}: avto-dispatch oʻchirildi` });
      void queryClient.invalidateQueries({ queryKey: ['branches'] });
      if (b.autoDispatch) dispatch.mutate();
    },
    onError: (e) => setNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Saqlanmadi' }),
  });

  // Live positions are a separate, permission-gated endpoint; fold them in.
  const fleet = useMemo(() => {
    const positions = new Map((live.data ?? []).map((c) => [c.id, c.lastLocation]));
    return (couriers.data?.items ?? []).map((c) => ({ ...c, lastLocation: positions.get(c.id) ?? c.lastLocation }));
  }, [couriers.data, live.data]);

  if (couriers.isLoading) return <Loading />;
  if (couriers.isError) return <ErrorState error={couriers.error} onRetry={() => void couriers.refetch()} />;

  const active = fleet.filter((c) => c.isActive);
  const free = active.filter((c) => c.status === CourierStatus.AVAILABLE);
  const busy = active.filter((c) => c.status === CourierStatus.ON_DELIVERY);
  const off = active.filter((c) => c.status === CourierStatus.OFFLINE || c.status === CourierStatus.BREAK);
  const cashHeld = active.reduce((s, c) => s + Math.max(0, c.wallet?.balance ?? 0), 0);
  const unassigned = (waiting.data?.items ?? []).filter((o) => !o.courierId);
  const pending = (handovers.data?.items ?? []).filter((h) => h.status === HandoverStatus.PENDING);
  const todayKey = new Date().toDateString();
  const collectedToday = (handovers.data?.items ?? [])
    .filter((h) => h.confirmedAt && new Date(h.confirmedAt).toDateString() === todayKey)
    .reduce((s, h) => s + h.amount, 0);

  const needle = text.trim().toLowerCase();
  const shown = active
    .filter((c) =>
      filter === 'free' ? c.status === CourierStatus.AVAILABLE : filter === 'busy' ? c.status === CourierStatus.ON_DELIVERY : filter === 'off' ? off.includes(c) : true,
    )
    .filter((c) => !needle || `${c.fullName} ${c.phone}`.toLowerCase().includes(needle))
    .sort((a, b) => rank(a.status) - rank(b.status));

  const autoOn = branchFull.data?.autoDispatch ?? false;

  return (
    <div className="page">
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
      <PageHeader
        crumb="Kuryerlar"
        title="Kuryerlar va jonli dispetcher"
        badge={<LivePill label="Jonli efir" />}
        subtitle="Buyurtmalarni biriktirish, kuryerlar joylashuvi, naqd pul va inkassatsiya nazorati"
        actions={
          <>
            <Seg
              label="Koʻrinish"
              quiet
              value={view}
              onChange={setView}
              options={[
                { value: 'board', label: <><IconCourier size={15} /> Doska</> },
                { value: 'map', label: <><IconMap size={15} /> Jonli xarita</> },
              ]}
            />
            {can(Permission.COURIER_WALLET_VIEW) && (
              <button type="button" className="btn btn--ghost" onClick={() => exportHandovers(handovers.data?.items ?? [])}>
                <IconDownload size={16} /> Inkassatsiya
              </button>
            )}
            {can(Permission.COURIERS_CREATE) && (
              <button type="button" className="btn" onClick={() => setForm({ courier: null })}>
                <IconUserPlus size={17} /> Yangi kuryer
              </button>
            )}
          </>
        }
      />

      {can(Permission.ORDERS_ASSIGN_COURIER) && (
        <div className="toolbar" style={{ justifyContent: 'space-between', background: autoOn ? 'var(--success-soft)' : undefined }}>
          <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
            <span className={`kpi__icon ${autoOn ? 'tone-success' : 'tone-primary'}`} style={{ width: 36, height: 36 }}><IconBolt size={18} /></span>
            <div>
              <div className="cell-main">Avto-dispatch {current ? `· ${current.name}` : ''}</div>
              <div className="cell-sub">
                {current
                  ? autoOn
                    ? 'Yoqilgan: tayyor boʻlgan yetkazish buyurtmasi eng kam band va eng yaqin boʻsh kuryerga avtomatik beriladi'
                    : 'Oʻchirilgan: buyurtmalarni dispetcher biriktiradi'
                  : 'Filialni yuqoridagi tanlagichdan tanlang — avto-dispatch har filial uchun alohida yoqiladi'}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            {current && can(Permission.BRANCHES_UPDATE) && (
              <Switch checked={autoOn} disabled={toggleAuto.isPending || branchFull.isLoading} onChange={(on) => toggleAuto.mutate(on)} label={autoOn ? 'Yoqilgan' : 'Oʻchirilgan'} />
            )}
            <button type="button" className="btn btn--sm" disabled={dispatch.isPending || unassigned.length === 0} onClick={() => dispatch.mutate()}>
              <IconBolt size={14} /> Hozir taqsimlash ({unassigned.length})
            </button>
          </div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
        <Kpi label="Jami kuryerlar" value={active.length} unit="nafar" Icon={IconCourier} tone="tone-primary" foot={<span>{active.length - off.length} tasi smenada</span>} />
        <Kpi label="Yoʻldagi kuryerlar" value={busy.length} unit="nafar" Icon={IconNavigation} tone="tone-info" foot={<span>{active.length ? `Band: ${Math.round((busy.length / active.length) * 100)}%` : '—'}</span>} />
        <Kpi label="Boʻsh kuryerlar" value={free.length} unit="nafar" Icon={IconCheckCircle} tone="tone-success" foot={<span>Buyurtmaga tayyor</span>} />
        {can(Permission.COURIER_WALLET_VIEW) && (
          <Kpi label="Qoʻldagi naqd pul" value={amount(cashHeld)} unit="soʻm" Icon={IconWallet} tone="tone-warning" foot={<span>Kassaga topshirilishi kerak</span>} />
        )}
        <Kpi
          label="Kuryer kutmoqda"
          value={unassigned.length}
          unit="ta buyurtma"
          Icon={IconAlert}
          tone={unassigned.length ? 'tone-danger' : 'tone-success'}
          alert={unassigned.length > 0 && free.length === 0}
          foot={<span>{unassigned.length && free.length === 0 ? 'Boʻsh kuryer yoʻq!' : 'Tayyor yetkazishlar'}</span>}
        />
      </div>

      {view === 'map' ? (
        <div className="card" style={{ padding: 10 }}>
          {can(Permission.COURIERS_TRACK) ? (
            <>
              <CourierMap couriers={active} branches={branchId ? branches.filter((b) => b.id === branchId) : branches} waiting={unassigned} focusId={focusId} height="min(68vh, 640px)" />
              <div className="legend" style={{ margin: '10px 4px 0' }}>
                <span className="legend__item"><span className="swatch" style={{ background: '#1baf7a', borderRadius: '50%' }} /> Boʻsh</span>
                <span className="legend__item"><span className="swatch" style={{ background: '#2a78d6', borderRadius: '50%' }} /> Yoʻlda</span>
                <span className="legend__item"><span className="swatch" style={{ background: '#eda100', borderRadius: '50%' }} /> Tanaffus</span>
                <span className="legend__item"><span className="swatch" style={{ background: '#ff6b00', borderRadius: '50%' }} /> Kuryer kutayotgan manzil</span>
                <span className="subtle">Joylashuv faqat smenada va ruxsat berilganda yuboriladi (~20 soniyada)</span>
              </div>
            </>
          ) : (
            <p className="muted" style={{ padding: 30, textAlign: 'center' }}>Xaritani koʻrish uchun “Kuryerlarni kuzatish” huquqi kerak</p>
          )}
        </div>
      ) : (
        <div className="dispatch-grid">
          {/* Waiting orders */}
          <section className="card stack" style={{ alignContent: 'start' }}>
            <div className="card__head" style={{ margin: 0 }}>
              <h2 className="card__title">Kuryer kutayotgan buyurtmalar</h2>
              <span className="pill tone-primary pill--lg">{unassigned.length} ta</span>
            </div>
            {unassigned.length === 0 ? (
              <p className="muted" style={{ textAlign: 'center', padding: '28px 0' }}>Hozir kuryer kutayotgan buyurtma yoʻq</p>
            ) : (
              unassigned.map((order) => (
                <WaitingCard key={order.id} order={order} canAssign={can(Permission.ORDERS_ASSIGN_COURIER)} onDone={(text) => { setNotice({ ok: true, text }); invalidate(); }} onError={(text) => setNotice({ ok: false, text })} />
              ))
            )}
          </section>

          {/* Fleet */}
          <section className="card stack" style={{ alignContent: 'start' }}>
            <div className="card__head" style={{ margin: 0 }}>
              <h2 className="card__title">Kuryerlar</h2>
              {live.dataUpdatedAt > 0 && <span className="cell-sub">GPS: {ago(new Date(live.dataUpdatedAt).toISOString())}</span>}
            </div>
            <Seg
              label="Holat"
              quiet
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Barchasi', count: active.length },
                { value: 'free', label: 'Boʻsh', count: free.length },
                { value: 'busy', label: 'Yoʻlda', count: busy.length },
                { value: 'off', label: 'Smenada emas', count: off.length },
              ]}
            />
            <div className="search-input" style={{ flex: 'none' }}>
              <IconSearch size={16} />
              <input type="search" placeholder="Ism yoki telefon…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Kuryerlarni qidirish" />
            </div>
            {shown.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>Kuryer topilmadi</p>}
            {shown.map((c) => (
              <article key={c.id} className="soft-box stack" style={{ gap: 8 }}>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <span className="avatar">{initialsOf(c.fullName)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cell-main ellipsis">{c.fullName}</div>
                    <div className="cell-sub row" style={{ gap: 4 }}><IconPhone size={12} /> {phone(c.phone)} · {VEHICLE_LABELS[c.vehicleType] ?? c.vehicleType}</div>
                  </div>
                  <span className={`pill ${COURIER_STATUS_TONES[c.status] ?? 'tone-neutral'}`}>{COURIER_STATUS_LABELS[c.status] ?? c.status}</span>
                </div>
                <div className="row cell-sub" style={{ justifyContent: 'space-between' }}>
                  <span>{c.activeDeliveryCount ? `${c.activeDeliveryCount} ta buyurtma yetkazmoqda` : 'Buyurtmasi yoʻq'}</span>
                  {c.wallet && can(Permission.COURIER_WALLET_VIEW) && (
                    <span>Qoʻlida: <strong style={{ color: c.wallet.balance > 0 ? 'var(--warning-ink)' : 'var(--text)' }}>{som(c.wallet.balance)}</strong></span>
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {c.lastLocation && can(Permission.COURIERS_TRACK) && (
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setFocusId(c.id); setView('map'); }}>
                      <IconMapPin size={13} /> Xaritada · {ago(c.lastLocation.recordedAt)}
                    </button>
                  )}
                  {can(Permission.COURIERS_UPDATE) && (
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm({ courier: c })}>
                      <IconEdit size={13} /> Tahrirlash
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>

          {/* Cash */}
          {can(Permission.COURIER_WALLET_VIEW) && (
            <section className="card stack" style={{ alignContent: 'start' }}>
              <div className="card__head" style={{ margin: 0 }}>
                <h2 className="card__title"><IconCash size={18} /> Kassa inkassatsiyasi</h2>
                <span className="pill tone-warning pill--lg">{pending.length}</span>
              </div>
              <p className="cell-sub">Kuryer ilovada naqd topshirganini eʼlon qiladi; kassir sanab, shu yerda tasdiqlaydi. Farq boʻlsa — qayd etiladi.</p>
              {pending.length === 0 && <p className="muted" style={{ textAlign: 'center', padding: '16px 0' }}>Tasdiq kutayotgan topshiruv yoʻq</p>}
              {pending.map((h) => (
                <HandoverCard key={h.id} handover={h} canSettle={can(Permission.COURIER_WALLET_SETTLE)} onDone={(text) => { setNotice({ ok: true, text }); invalidate(); }} onError={(text) => setNotice({ ok: false, text })} />
              ))}
              <div className="banner banner--info" style={{ padding: '10px 12px' }}>
                <IconCheckCircle size={16} />
                <span>Bugun topshirilgan naqd: <strong>{som(collectedToday)}</strong></span>
              </div>
            </section>
          )}
        </div>
      )}

      {form && (
        <CourierForm
          courier={form.courier}
          branches={branches}
          onClose={() => setForm(null)}
          onSaved={(text) => {
            setForm(null);
            setNotice({ ok: true, text });
          }}
        />
      )}
    </div>
  );
}

function WaitingCard({
  order,
  canAssign,
  onDone,
  onError,
}: {
  order: Order;
  canAssign: boolean;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const suggestions = useQuery({
    queryKey: ['orders', 'one', order.id, 'courier-suggestions'],
    queryFn: () => api.couriers.suggestions(order.id),
    enabled: open,
  });
  const assign = useMutation({
    mutationFn: (courierId: string) => api.couriers.assign(order.id, { courierId }),
    onSuccess: (o) => onDone(`#${o.displayNumber} kuryerga biriktirildi`),
    onError: (e) => onError(e instanceof RestorApiError ? e.message : 'Biriktirilmadi'),
  });
  const a = order.deliveryAddress;
  const paid = order.paymentStatus === 'PAID';

  return (
    <article className="soft-box stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>#{order.displayNumber}</strong>
        <span className="cell-main num">{som(order.total)}</span>
      </div>
      <div className="cell-sub">{order.readyAt ? `${ago(order.readyAt)} tayyor boʻlgan` : `${ago(order.createdAt)} kelgan`}</div>
      {a && (
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start', fontSize: 13 }}>
          <IconMapPin size={14} style={{ marginTop: 2, color: 'var(--text-muted)' }} />
          <div>
            {a.address}
            {a.landmark && <div className="cell-sub">Moʻljal: {a.landmark}</div>}
          </div>
        </div>
      )}
      <div className="cell-sub">
        Toʻlov: <strong>{order.paymentMethod ? (PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod) : '—'}</strong>
        {paid ? ' (toʻlangan)' : order.paymentMethod === 'CASH' ? ' — kuryer naqd oladi' : ' — hali toʻlanmagan'}
      </div>
      {canAssign && (
        <button type="button" className="btn btn--sm btn--dark" onClick={() => setOpen((v) => !v)}>
          <IconCourier size={14} /> Kuryer biriktirish
        </button>
      )}
      {open && (
        <div className="stack" style={{ gap: 4 }}>
          {suggestions.isLoading && <div className="skeleton" style={{ height: 40 }} />}
          {suggestions.data?.length === 0 && <p className="cell-sub">Boʻsh kuryer yoʻq</p>}
          {suggestions.data?.map((c) => (
            <button key={c.id} type="button" className="menu-item" style={{ background: 'var(--surface)' }} disabled={assign.isPending} onClick={() => assign.mutate(c.id)}>
              <span className="avatar avatar--sm">{initialsOf(c.fullName)}</span>
              <span className="menu-item__body">
                <span className="menu-item__title">{c.fullName}</span>
                <span className="menu-item__sub">
                  {COURIER_STATUS_LABELS[c.status]}
                  {c.activeDeliveryCount ? ` · ${c.activeDeliveryCount} ta` : ''}
                  {c.distanceM !== undefined ? ` · ${(c.distanceM / 1000).toFixed(1).replace('.', ',')} km` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * Two-sided cash hand-off: pre-filled with what the courier declared, and a
 * different counted figure is recorded as a discrepancy rather than smoothed
 * over — that difference is the reason the handshake has two sides.
 */
function HandoverCard({
  handover,
  canSettle,
  onDone,
  onError,
}: {
  handover: CashHandover;
  canSettle: boolean;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [counted, setCounted] = useState(String(handover.amount));
  const [comment, setComment] = useState('');
  const value = digits(counted);
  const diff = value - handover.amount;

  const confirm = useMutation({
    mutationFn: () => api.couriers.confirmHandover(handover.id, { amount: value, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
    onSuccess: () => onDone(`${handover.courierName}: ${som(value)} qabul qilindi${diff ? ' (farq bilan)' : ''}`),
    onError: (e) => onError(e instanceof RestorApiError ? e.message : 'Tasdiqlanmadi'),
  });

  return (
    <article className="soft-box stack" style={{ gap: 8, outline: diff ? '1px solid var(--warning)' : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{handover.courierName}</strong>
        <span className={`pill ${diff === 0 ? 'tone-success' : 'tone-danger'}`}>
          Farq: {diff > 0 ? '+' : ''}{som(diff)}{diff < 0 ? ' (kamomad)' : ''}
        </span>
      </div>
      <div className="row cell-sub" style={{ justifyContent: 'space-between' }}>
        <span>Eʼlon qilingan</span>
        <strong style={{ color: 'var(--text)' }}>{som(handover.amount)}</strong>
      </div>
      <label className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <span className="cell-sub" style={{ whiteSpace: 'nowrap' }}>Sanalgan</span>
        <input inputMode="numeric" value={counted} disabled={!canSettle} onChange={(e) => setCounted(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
      </label>
      {diff !== 0 && (
        <input placeholder="Farq sababi (ixtiyoriy)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Farq sababi" />
      )}
      {canSettle && (
        <button type="button" className={`btn btn--sm ${diff ? 'btn--dark' : ''}`} disabled={value <= 0 || confirm.isPending} onClick={() => confirm.mutate()}>
          <IconCheckCircle size={14} /> {diff ? 'Farq bilan tasdiqlash' : 'Qabul qilish va tasdiqlash'}
        </button>
      )}
      <span className="cell-sub">Eʼlon: {dateTimeOf(handover.declaredAt)}</span>
    </article>
  );
}

function exportHandovers(rows: CashHandover[]) {
  downloadCsv(`inkassatsiya_${new Date().toISOString().slice(0, 10)}`, [
    ['Kuryer', 'Summa (soʻm)', 'Holat', 'Eʼlon qilingan', 'Tasdiqlangan', 'Kassir', 'Izoh'],
    ...rows.map((h) => [
      h.courierName,
      h.amount,
      h.status === HandoverStatus.CONFIRMED ? 'Tasdiqlangan' : h.status === HandoverStatus.DISPUTED ? 'Farq bilan' : h.status === HandoverStatus.PENDING ? 'Kutilmoqda' : 'Bekor',
      dateTimeOf(h.declaredAt),
      h.confirmedAt ? dateTimeOf(h.confirmedAt) : '',
      h.cashierName ?? '',
      h.comment ?? '',
    ]),
  ]);
}

/** Who can take a job right now comes first. */
function rank(status: string): number {
  return status === CourierStatus.AVAILABLE ? 0 : status === CourierStatus.ON_DELIVERY ? 1 : status === CourierStatus.BREAK ? 2 : 3;
}
