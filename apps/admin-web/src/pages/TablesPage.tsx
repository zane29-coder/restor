import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Permission, TableShape, WaiterCallStatus, WaiterCallType, type FloorTable } from '@restor/shared-types';
import {
  IconCalendar,
  IconCash,
  IconGrid,
  IconLayers,
  IconMap,
  IconPlus,
  IconPrint,
  IconTable,
  IconUsers,
  IconWallet,
} from '@restor/ui';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useBranch } from '../lib/branch';
import { compactSom, minutesBetween, percent, timeOf } from '../lib/format';
import { printQrSheet } from '../lib/print';
import {
  SHAPE_LABELS,
  TABLE_STATE_LABELS,
  TABLE_STATE_TONES,
  asksForBill,
  planPositions,
  tableState,
  zoneName,
  type PlanPoint,
} from '../lib/tables';
import { ErrorState, Loading, Notice } from '../components/States';
import { FloorPlan } from '../components/tables/FloorPlan';
import { ReservationsBoard } from '../components/tables/Reservations';
import { TableForm } from '../components/tables/TableForm';
import { TablePanel } from '../components/tables/TablePanel';
import { Kpi, LivePill, PageHeader, Seg, Tabs } from '../components/ui';

type Tab = 'floor' | 'reservations';
type View = 'plan' | 'grid';
const ALL = '__all';

/**
 * Tables, the live floor and bookings (TZ 20).
 *
 * One screen for the host stand: the plan shows at a glance which tables are
 * eating, which are booked and which are free, a table glows while its guests
 * wait for a waiter, and the bookings board sits one tab away. The floor
 * refreshes every 15 seconds — a guest who pressed the button is waiting.
 */
export function TablesPage() {
  const { can, user } = useAuth();
  const queryClient = useQueryClient();
  const { branches, branchId: headerBranch } = useBranch();
  const [pickedBranch, setPickedBranch] = useState('');
  const branchId = headerBranch || pickedBranch || branches[0]?.id || '';
  const branch = branches.find((b) => b.id === branchId);

  const [tab, setTab] = useState<Tab>('floor');
  const [zone, setZone] = useState(ALL);
  const [view, setView] = useState<View>('plan');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, PlanPoint>>({});
  const [shapes, setShapes] = useState<Record<string, TableShape>>({});
  const [form, setForm] = useState<{ tableId: string | null } | null>(null);
  const [reserveFor, setReserveFor] = useState<{ tableId: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const canManage = can(Permission.TABLES_MANAGE);
  const canHandle = can(Permission.WAITER_CALLS_HANDLE);
  const canReserve = can(Permission.RESERVATIONS_MANAGE);

  const floor = useQuery({
    queryKey: ['tables', 'floor', branchId],
    queryFn: () => api.tables.floor(branchId),
    enabled: Boolean(branchId),
    refetchInterval: editing ? false : 15_000,
  });

  // A different branch is a different floor: drop what belonged to the last.
  useEffect(() => {
    setSelectedId(null);
    setEditing(false);
    setZone(ALL);
  }, [branchId]);

  const tables = useMemo<FloorTable[]>(
    () => (floor.data?.tables ?? []).map((t) => (editing && shapes[t.id] ? { ...t, shape: shapes[t.id]! } : t)),
    [floor.data, shapes, editing],
  );
  const zones = useMemo(() => [...new Set(tables.map((t) => zoneName(t.zone)))], [tables]);
  const saved = useMemo(() => {
    const byZone: Record<string, PlanPoint> = {};
    for (const z of zones) Object.assign(byZone, planPositions(tables.filter((t) => zoneName(t.zone) === z)));
    return byZone;
  }, [tables, zones]);
  const positions = editing ? { ...saved, ...draft } : saved;

  const saveLayout = useMutation({
    mutationFn: () =>
      api.tables.saveLayout(
        tables
          .filter((t) => zone === ALL || zoneName(t.zone) === zone)
          .map((t) => ({ id: t.id, x: Math.round(positions[t.id]!.x), y: Math.round(positions[t.id]!.y), shape: t.shape })),
      ),
    onSuccess: () => {
      setEditing(false);
      setDraft({});
      setShapes({});
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      setNotice({ ok: true, text: 'Zal sxemasi saqlandi' });
    },
    onError: (e) => setNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Saqlanmadi' }),
  });

  if (!branchId) return <Loading />;
  if (floor.isLoading) return <Loading />;
  if (floor.isError) return <ErrorState error={floor.error} onRetry={() => void floor.refetch()} />;

  const data = floor.data!;
  const states = tables.map(tableState);
  const busy = states.filter((s) => s === 'busy').length;
  const free = states.filter((s) => s === 'free').length;
  const reserved = states.filter((s) => s === 'reserved').length;
  const activeCount = tables.filter((t) => t.isActive).length;
  const seats = tables.reduce((sum, t) => sum + (t.isActive ? t.seats ?? 0 : 0), 0);
  const calls = tables.flatMap((t) => t.calls.map((call) => ({ ...call, table: t })));
  const visible = zone === ALL ? tables : tables.filter((t) => zoneName(t.zone) === zone);
  const selected = tables.find((t) => t.id === selectedId) ?? null;
  const editingTable = form?.tableId ? tables.find((t) => t.id === form.tableId) ?? null : null;

  const cancelEditing = () => {
    setEditing(false);
    setDraft({});
    setShapes({});
  };

  const printAll = (list: FloorTable[]) => {
    if (!printQrSheet(list.filter((t) => t.isActive), user?.tenantName ?? 'RESTOR', branch?.name ?? '')) {
      setNotice({ ok: false, text: 'Brauzer yangi oynani bloklab qoʻydi — ruxsat bering' });
    }
  };

  return (
    <div className="page">
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
      <PageHeader
        crumb="Stollar va QR"
        title="Stollar va QR menyu"
        badge={<LivePill />}
        subtitle="Zal holati, bronlar, QR kodlar va ofitsiant chaqiruvlari"
        actions={
          <>
            {tables.length > 0 && (
              <button type="button" className="btn btn--ghost" onClick={() => printAll(visible)}>
                <IconPrint size={16} /> QR kodlarni chop etish
              </button>
            )}
            {canManage && tab === 'floor' && tables.length > 0 && !editing && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setView('plan');
                  setEditing(true);
                }}
              >
                <IconLayers size={16} /> Zal muharriri
              </button>
            )}
            {canManage && (
              <button type="button" className="btn" onClick={() => setForm({ tableId: null })}>
                <IconPlus size={17} /> Yangi stol
              </button>
            )}
          </>
        }
      />

      {!headerBranch && branches.length > 1 && (
        <div className="toolbar">
          <Seg label="Filial" options={branches.map((b) => ({ value: b.id, label: b.name }))} value={branchId} onChange={setPickedBranch} />
        </div>
      )}

      <div className="kpi-grid">
        <Kpi
          label="Jami stollar"
          value={activeCount}
          unit="ta"
          Icon={IconTable}
          tone="tone-primary"
          foot={<span>{seats} oʻrin · {zones.length} ta zal{branch ? ` · ${branch.name}` : ''}</span>}
        />
        <Kpi
          label="Band stollar"
          value={busy}
          unit="ta"
          Icon={IconUsers}
          tone="tone-warning"
          foot={<span>{percent(activeCount ? (busy / activeCount) * 100 : null, 0)} bandlik</span>}
        />
        <Kpi
          label="Erkin stollar"
          value={free}
          unit="ta"
          Icon={IconCalendar}
          tone="tone-success"
          foot={<span>{reserved > 0 ? `${reserved} tasi yaqin 3 soatda bron` : 'Mehmon qabul qilishga tayyor'}</span>}
        />
        <Kpi
          label="Zaldan bugungi tushum"
          value={compactSom(data.today.revenue)}
          unit="soʻm"
          Icon={IconWallet}
          tone="tone-info"
          foot={<span>{data.today.orders} ta chek · bugun {data.today.reservations} ta bron</span>}
        />
      </div>

      {canHandle && calls.length > 0 && (
        <section className="card" style={{ borderColor: 'var(--warning)' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 className="card__title">Chaqiruvlar ({calls.length})</h2>
            <span className="muted" style={{ fontSize: 12 }}>Eng uzoq kutayotgan birinchi</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {calls
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((call) => (
                <button
                  key={call.id}
                  type="button"
                  className={`pill pill--lg ${call.status === WaiterCallStatus.PENDING ? 'tone-warning' : 'tone-info'}`}
                  style={{ cursor: 'pointer', border: 0 }}
                  onClick={() => {
                    setTab('floor');
                    setSelectedId(call.table.id);
                  }}
                >
                  {call.type === WaiterCallType.REQUEST_BILL ? <IconCash size={13} /> : null}
                  <b>{call.table.number}</b> {call.type === WaiterCallType.REQUEST_BILL ? 'hisob' : 'chaqirdi'} · {minutesBetween(call.createdAt)} daq
                  {call.status === WaiterCallStatus.ACKNOWLEDGED ? ' · yoʻlda' : ''}
                </button>
              ))}
          </div>
        </section>
      )}

      <Tabs
        value={tab}
        onChange={(t) => {
          setTab(t);
          if (t !== 'floor') cancelEditing();
        }}
        options={[
          { value: 'floor', label: 'Zal xaritasi', count: tables.length, Icon: IconMap },
          { value: 'reservations', label: 'Bronlar', count: data.today.reservations, Icon: IconCalendar },
        ]}
      />

      {tab === 'reservations' ? (
        <ReservationsBoard
          key={`${branchId}-${reserveFor?.tableId ?? ''}`}
          branchId={branchId}
          tables={tables}
          canManage={canReserve}
          initialForm={reserveFor}
          onFormClosed={() => setReserveFor(null)}
          onNotice={setNotice}
        />
      ) : tables.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="muted">Bu filialda stol yoʻq. Har bir stolga QR kod beriladi — mehmon uni skanerlab menyuni koʻradi, buyurtma beradi va ofitsiantni chaqiradi.</p>
          {canManage && (
            <button type="button" className="btn" onClick={() => setForm({ tableId: null })}>
              <IconPlus size={16} /> Birinchi stolni qoʻshish
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <Seg
              label="Zal"
              options={[
                { value: ALL, label: 'Barcha zallar', count: tables.length },
                ...zones.map((z) => ({ value: z, label: z, count: tables.filter((t) => zoneName(t.zone) === z).length })),
              ]}
              value={zone}
              onChange={setZone}
            />
            <div className="row" style={{ gap: 10 }}>
              <div className="floor-legend">
                {(['busy', 'free', 'reserved'] as const).map((s) => (
                  <span key={s} className={`pill ${TABLE_STATE_TONES[s]}`}>
                    {TABLE_STATE_LABELS[s]} ({states.filter((x) => x === s).length})
                  </span>
                ))}
              </div>
              {!editing && (
                <Seg
                  label="Koʻrinish"
                  quiet
                  options={[
                    { value: 'plan' as View, label: <><IconMap size={14} /> Sxema</> },
                    { value: 'grid' as View, label: <><IconGrid size={14} /> Kataklar</> },
                  ]}
                  value={view}
                  onChange={setView}
                />
              )}
            </div>
          </div>

          {editing && (
            <div className="banner banner--info">
              <div style={{ flex: 1 }}>
                <b>Zal muharriri.</b> Stollarni sudrab joylashtiring
                {selected ? (
                  <span className="row" style={{ display: 'inline-flex', gap: 6, marginLeft: 10 }}>
                    · {selected.number}-stol shakli:
                    <Seg
                      label="Shakli"
                      quiet
                      options={Object.values(TableShape).map((value) => ({ value, label: SHAPE_LABELS[value] }))}
                      value={selected.shape}
                      onChange={(shape) => setShapes((s) => ({ ...s, [selected.id]: shape }))}
                    />
                  </span>
                ) : (
                  ' — shaklini oʻzgartirish uchun stolni tanlang.'
                )}
              </div>
              <button type="button" className="btn btn--sm btn--ghost" onClick={cancelEditing}>Bekor</button>
              <button type="button" className="btn btn--sm" disabled={saveLayout.isPending} onClick={() => saveLayout.mutate()}>
                {saveLayout.isPending ? 'Saqlanmoqda…' : 'Sxemani saqlash'}
              </button>
            </div>
          )}

          <div className={`split${selected && !editing ? '' : ' split--single'}`}>
            <div className="stack" style={{ gap: 18 }}>
              {view === 'plan' || editing ? (
                (zone === ALL ? zones : [zone]).map((z) => (
                  <section key={z} className="stack" style={{ gap: 8 }}>
                    {zone === ALL && zones.length > 1 && <h2 className="section-title">{z}</h2>}
                    <FloorPlan
                      tables={tables.filter((t) => zoneName(t.zone) === z)}
                      positions={positions}
                      selectedId={selectedId}
                      editing={editing}
                      onSelect={(id) => setSelectedId((current) => (current === id && !editing ? null : id))}
                      onMove={(id, point) => setDraft((d) => ({ ...d, [id]: point }))}
                    />
                  </section>
                ))
              ) : (
                <div className="table-tiles">
                  {visible.map((t) => (
                    <TableTile key={t.id} table={t} selected={t.id === selectedId} onSelect={() => setSelectedId(t.id === selectedId ? null : t.id)} />
                  ))}
                </div>
              )}
            </div>

            {selected && !editing && (
              <TablePanel
                key={selected.id}
                table={selected}
                canManage={canManage}
                canHandle={canHandle}
                canReserve={canReserve}
                onClose={() => setSelectedId(null)}
                onEdit={() => setForm({ tableId: selected.id })}
                onReserve={() => {
                  setReserveFor({ tableId: selected.id });
                  setTab('reservations');
                }}
                onPrint={() => printAll([selected])}
                onNotice={setNotice}
              />
            )}
          </div>
        </>
      )}

      {form && (
        <TableForm
          table={editingTable}
          branches={branches}
          branchId={branchId}
          zones={zones}
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

/** The grid view's card: what the design calls "kataklar". */
function TableTile({ table, selected, onSelect }: { table: FloorTable; selected: boolean; onSelect: () => void }) {
  const state = tableState(table);
  return (
    <button
      type="button"
      className={`table-tile is-${state}${table.calls.length ? ' has-call' : ''}${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          <b style={{ fontSize: 16 }}>{table.number}</b>
          <span className="cell-sub"> · {table.seats ?? '–'} kishilik</span>
        </span>
        <span className={`pill ${TABLE_STATE_TONES[state]}`}>{TABLE_STATE_LABELS[state]}</span>
      </div>
      <div className="cell-sub">{zoneName(table.zone)}{table.name ? ` · ${table.name}` : ''}</div>
      {table.openOrder ? (
        <div className="soft-box" style={{ display: 'grid', gap: 2 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>#{table.openOrder.displayNumber}</span>
            <b className="num">{compactSom(table.openOrder.total)}</b>
          </div>
          <span className="cell-sub">
            {minutesBetween(table.openOrder.createdAt)} daqiqa{table.openOrder.createdByName ? ` · ${table.openOrder.createdByName}` : ''}
          </span>
        </div>
      ) : table.reservation ? (
        <div className="soft-box cell-sub">
          {timeOf(table.reservation.startsAt)} — {table.reservation.guestName}, {table.reservation.partySize} kishi
        </div>
      ) : (
        <div className="cell-sub">{table.isActive ? 'Tayyor, mehmon kutmoqda' : 'Stol oʻchiq'}</div>
      )}
      {table.calls.length > 0 && (
        <span className="pill tone-warning">{asksForBill(table) ? 'Hisob soʻradi' : 'Ofitsiant chaqirdi'}</span>
      )}
    </button>
  );
}
