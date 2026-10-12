import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { CourierStatus, Permission, type Branch, type DeliveryZone } from '@restor/shared-types';
import {
  IconBan,
  IconBarChart,
  IconBasket,
  IconBranch,
  IconChart,
  IconClock,
  IconCourier,
  IconGrid,
  IconMap,
  IconMapPin,
  IconPhone,
  IconPlus,
  IconPolygon,
  IconSearch,
  IconSliders,
  IconTable,
  IconWallet,
} from '@restor/ui';
import { escapeHtml } from '@restor/shared-utils';
import { api, RestorApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { todaysHours } from '../lib/branch';
import { amount, compactSom, count, isoDay, phone, som } from '../lib/format';
import { BranchForm } from '../components/branches/BranchForm';
import { Drawer } from '../components/Drawer';
import { LeafletMap, dotIcon, useLayer } from '../components/map/LeafletMap';
import { ZoneEditor } from '../components/map/ZoneEditor';
import { ErrorState, Loading, Notice } from '../components/States';
import { Kpi, PageHeader, Seg, Switch } from '../components/ui';
import { OpenPill } from '../components/BranchSwitcher';

type OpenFilter = 'all' | 'open' | 'closed';

/**
 * Branches (TZ §8, §11): the network at a glance and every branch's settings.
 *
 * Today's figures come from `/reports/branches`, the same aggregation the
 * dashboard ranks by, so a card and the ranking never disagree.
 */
export function BranchesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'cards' | 'map'>('cards');
  const [filter, setFilter] = useState<OpenFilter>('all');
  const [text, setText] = useState('');
  const [form, setForm] = useState<{ branch: Branch | null; section?: 'hours' | 'delivery' } | null>(null);
  const [zonesFor, setZonesFor] = useState<Branch | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const branches = useQuery({ queryKey: ['branches', 'full'], queryFn: () => api.branches.list({ limit: 100 }) });
  const items = branches.data?.items ?? [];
  const today = isoDay(new Date());

  const report = useQuery({
    queryKey: ['reports', 'branches', 'today', today],
    queryFn: () => api.reports.branches({ dateFrom: today, dateTo: today }),
    enabled: can(Permission.REPORTS_VIEW),
    refetchInterval: 60_000,
  });
  const tables = useQuery({
    queryKey: ['tables', 'all'],
    queryFn: () => api.tables.list(),
    enabled: can(Permission.TABLES_VIEW),
  });
  const couriers = useQuery({
    queryKey: ['couriers', 'all-for-branches'],
    queryFn: () => api.couriers.list({ limit: 100 }),
    enabled: can(Permission.COURIERS_VIEW),
  });
  const zoneQueries = useQueries({
    queries: items.map((b) => ({
      queryKey: ['branches', b.id, 'zones'],
      queryFn: () => api.branches.zones(b.id),
    })),
  });
  const zonesOf = (id: string): DeliveryZone[] =>
    zoneQueries[items.findIndex((b) => b.id === id)]?.data ?? [];

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.branches.update(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['branches'] }),
    onError: (e) => setNotice({ ok: false, text: e instanceof RestorApiError ? e.message : 'Saqlanmadi' }),
  });

  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return items.filter((b) => {
      if (filter === 'open' && !b.isOpenNow) return false;
      if (filter === 'closed' && b.isOpenNow) return false;
      return !needle || `${b.name} ${b.address} ${b.phone ?? ''}`.toLowerCase().includes(needle);
    });
  }, [items, filter, text]);

  if (branches.isLoading) return <Loading />;
  if (branches.isError) return <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />;

  const openCount = items.filter((b) => b.isOpenNow).length;
  const activeCount = items.filter((b) => b.isActive).length;
  const avgPrep = items.length ? Math.round(items.reduce((s, b) => s + b.averagePrepMinutes, 0) / items.length) : 0;
  const todayRevenue = report.data?.reduce((s, r) => s + r.revenue, 0) ?? 0;
  const todayOrders = report.data?.reduce((s, r) => s + r.ordersCount, 0) ?? 0;

  return (
    <div className="page">
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

      <PageHeader
        crumb="Filiallar"
        title="Filiallar boshqaruvi"
        badge={<span className="pill tone-primary">{items.length} ta nuqta</span>}
        subtitle="Filiallar tarmogʻi, ish vaqti, yetkazib berish sozlamalari va zonalar"
        actions={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setView('map')}>
              <IconMap size={16} /> Zonalar xaritasi
            </button>
            {can(Permission.REPORTS_VIEW) && (
              <button type="button" className="btn btn--ghost" onClick={() => navigate('/reports?tab=branches')}>
                <IconChart size={16} /> Tarmoq hisoboti
              </button>
            )}
            {can(Permission.BRANCHES_CREATE) && (
              <button type="button" className="btn" onClick={() => setForm({ branch: null })}>
                <IconPlus size={17} /> Yangi filial
              </button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi
          label="Jami filiallar"
          value={items.length}
          unit="ta"
          Icon={IconBranch}
          tone="tone-primary"
          foot={<span>{activeCount === items.length ? 'Hammasi faol' : `${items.length - activeCount} tasi nofaol`}</span>}
        />
        <Kpi
          label="Hozir ochiq"
          value={openCount}
          unit="ta filial"
          Icon={IconClock}
          tone="tone-success"
          foot={<span>{items.length ? `${Math.round((openCount / items.length) * 100)}% ochiq` : '—'}</span>}
        />
        <Kpi
          label="Oʻrtacha tayyorlash"
          value={avgPrep}
          unit="daqiqa"
          Icon={IconCourier}
          tone="tone-info"
          foot={<span>Filiallar meʼyori boʻyicha</span>}
        />
        {can(Permission.REPORTS_VIEW) && (
          <Kpi
            label="Bugungi tarmoq tushumi"
            value={amount(todayRevenue)}
            unit="soʻm"
            Icon={IconWallet}
            tone="tone-warning"
            foot={<span>{count(todayOrders)} ta yakunlangan buyurtma</span>}
          />
        )}
      </div>

      <div className="toolbar">
        <div className="search-input">
          <IconSearch size={16} />
          <input type="search" placeholder="Filial nomi, manzil yoki telefon…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filiallarni qidirish" />
        </div>
        <Seg
          label="Holat"
          quiet
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Ochiq', count: openCount },
            { value: 'all', label: 'Barchasi', count: items.length },
            { value: 'closed', label: 'Yopiq', count: items.length - openCount },
          ]}
        />
        <span className="spacer" />
        <Seg
          label="Koʻrinish"
          quiet
          value={view}
          onChange={setView}
          options={[
            { value: 'cards', label: <><IconGrid size={15} /> Kartalar</> },
            { value: 'map', label: <><IconMap size={15} /> Xarita</> },
          ]}
        />
      </div>

      {view === 'map' ? (
        <NetworkMap branches={filtered} zonesOf={zonesOf} onEditZones={(b) => setZonesFor(b)} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
          {filtered.map((branch) => {
            const today = report.data?.find((r) => r.branchId === branch.id);
            const zones = zonesOf(branch.id);
            const tableCount = tables.data?.filter((t) => t.branchId === branch.id && t.isActive).length;
            const onShift = couriers.data?.items.filter((c) => c.branchId === branch.id && c.status !== CourierStatus.OFFLINE).length;
            const hours = todaysHours(branch);
            return (
              <article key={branch.id} className="card stack" style={{ gap: 14, opacity: branch.isActive ? 1 : 0.7 }}>
                <header className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span className="kpi__icon tone-primary"><IconBranch size={20} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 className="card__title">{branch.name}</h2>
                    <div className="row cell-sub" style={{ gap: 6 }}>
                      <OpenPill open={branch.isOpenNow ?? false} />
                      <IconClock size={13} />
                      {hours ?? 'Bugun dam olish'}
                      {!branch.isActive && <span className="pill tone-neutral">Nofaol</span>}
                    </div>
                  </div>
                  {can(Permission.REPORTS_VIEW) && (
                    <button type="button" className="icon-btn icon-btn--sm" title="Hisobot" aria-label="Filial hisoboti" onClick={() => navigate(`/reports?branch=${branch.id}`)}>
                      <IconBarChart size={16} />
                    </button>
                  )}
                </header>

                <div className="stack" style={{ gap: 6, fontSize: 13 }}>
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><IconMapPin size={15} style={{ color: 'var(--text-muted)' }} /> {branch.address}</span>
                  {branch.phone && <span className="row" style={{ gap: 6 }}><IconPhone size={15} style={{ color: 'var(--text-muted)' }} /> {phone(branch.phone)}</span>}
                </div>

                <div className="row" style={{ gap: 6 }}>
                  <span className={`pill ${branch.acceptsDelivery ? 'tone-success' : 'tone-neutral'}`}><IconCourier size={13} /> Yetkazish</span>
                  <span className={`pill ${branch.acceptsPickup ? 'tone-success' : 'tone-neutral'}`}><IconBasket size={13} /> Olib ketish</span>
                  <span className={`pill ${branch.acceptsDineIn ? 'tone-success' : 'tone-neutral'}`}>
                    {branch.acceptsDineIn ? <IconTable size={13} /> : <IconBan size={13} />}
                    {branch.acceptsDineIn ? `Zalda${tableCount !== undefined ? ` · ${tableCount} stol` : ''}` : 'Zal yoʻq'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  <div className="soft-box stat-mini"><span className="stat-mini__label">Min. buyurtma</span><span className="stat-mini__value">{som(branch.minOrderAmount)}</span></div>
                  <div className="soft-box stat-mini">
                    <span className="stat-mini__label">Yetkazish haqi</span>
                    <span className="stat-mini__value">
                      {zones.some((z) => z.isActive) ? `${zones.filter((z) => z.isActive).length} ta zona` : branch.deliveryPrice === 0 && !branch.deliveryPricePerKm ? 'Bepul' : `${som(branch.deliveryPrice)}${branch.deliveryPricePerKm ? ` +${amount(branch.deliveryPricePerKm)}/km` : ''}`}
                    </span>
                  </div>
                  <div className="soft-box stat-mini">
                    <span className="stat-mini__label">Xizmat hududi</span>
                    <span className="stat-mini__value">
                      {zones.some((z) => z.isActive) ? 'Poligon zonalar' : branch.deliveryRadiusM ? `${(branch.deliveryRadiusM / 1000).toFixed(1).replace('.', ',')} km radius` : 'Cheklovsiz'}
                    </span>
                  </div>
                  <div className="soft-box stat-mini"><span className="stat-mini__label">Oʻrt. tayyorlash</span><span className="stat-mini__value">{branch.averagePrepMinutes} daq</span></div>
                </div>

                {(today || onShift !== undefined) && (
                  <div className="banner banner--info" style={{ padding: '8px 10px', fontSize: 12.5 }}>
                    <IconChart size={15} />
                    <span>
                      Bugun:{' '}
                      {today && <><strong>{today.ordersCount}</strong> ta buyurtma · <strong>{compactSom(today.revenue)}</strong> soʻm</>}
                      {today && onShift !== undefined && ' · '}
                      {onShift !== undefined && `${onShift} ta kuryer smenada`}
                    </span>
                  </div>
                )}

                <footer className="row" style={{ gap: 8, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <Switch
                    checked={branch.isActive}
                    disabled={!can(Permission.BRANCHES_UPDATE) || toggleActive.isPending}
                    onChange={(isActive) => toggleActive.mutate({ id: branch.id, isActive })}
                    label="Buyurtma qabul qilish"
                  />
                  <span className="spacer" />
                  {can(Permission.BRANCHES_UPDATE) && (
                    <>
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm({ branch, section: 'hours' })}>
                        <IconClock size={14} /> Ish vaqti
                      </button>
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setZonesFor(branch)}>
                        <IconPolygon size={14} /> Zonalar
                      </button>
                      <button type="button" className="btn btn--sm btn--soft" onClick={() => setForm({ branch })}>
                        <IconSliders size={14} /> Sozlash
                      </button>
                    </>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {can(Permission.BRANCHES_UPDATE) && items.length > 0 && view === 'cards' && (
        <div className="banner" style={{ background: 'var(--sidebar-bg)', color: '#fff', padding: '16px 18px' }}>
          <span className="banner__icon" style={{ background: 'var(--primary)' }}><IconPolygon size={16} /></span>
          <div className="banner__body">
            <div className="banner__title">Poligon yetkazish zonalari</div>
            <div style={{ opacity: 0.8, fontSize: 12.5 }}>
              Har filial uchun xaritada yetkazish hududini chizing va har bir zonaga alohida narx, minimal buyurtma va bepul yetkazish chegarasini belgilang.
            </div>
          </div>
          <button type="button" className="btn" onClick={() => setZonesFor(items[0]!)}>Muharrirni ochish</button>
        </div>
      )}

      {form && (
        <BranchForm
          branch={form.branch}
          section={form.section}
          onClose={() => setForm(null)}
          onSaved={(text) => {
            setForm(null);
            setNotice({ ok: true, text });
          }}
        />
      )}

      {zonesFor && (
        <Drawer
          width="full"
          title={
            <span className="row" style={{ gap: 10 }}>
              Yetkazish zonalari ·
              <select
                value={zonesFor.id}
                onChange={(e) => setZonesFor(items.find((b) => b.id === e.target.value) ?? zonesFor)}
                aria-label="Filial"
                style={{ minHeight: 32 }}
              >
                {items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </span>
          }
          onClose={() => setZonesFor(null)}
        >
          <ZoneEditor key={zonesFor.id} branch={zonesFor} canEdit={can(Permission.BRANCHES_UPDATE)} />
        </Drawer>
      )}
    </div>
  );
}

/** Every branch and its zones on one map. */
function NetworkMap({
  branches,
  zonesOf,
  onEditZones,
}: {
  branches: Branch[];
  zonesOf: (id: string) => DeliveryZone[];
  onEditZones: (branch: Branch) => void;
}) {
  const [map, setMap] = useState<L.Map | null>(null);
  const zoneKey = branches.map((b) => `${b.id}:${zonesOf(b.id).length}`).join('|');

  useLayer(
    map,
    (group) => {
      const points: L.LatLngExpression[] = [];
      for (const b of branches) {
        for (const z of zonesOf(b.id)) {
          if (z.polygon.length < 3) continue;
          L.polygon(z.polygon, { color: z.color, weight: 2, fillOpacity: z.isActive ? 0.15 : 0.04, dashArray: z.isActive ? undefined : '6 6' })
            .bindTooltip(`${escapeHtml(b.name)}: ${escapeHtml(z.name)} · ${z.deliveryPrice ? som(z.deliveryPrice) : 'bepul'}`, { sticky: true })
            .addTo(group);
          points.push(...z.polygon);
        }
        if (b.latitude != null && b.longitude != null) {
          const marker = L.marker([b.latitude, b.longitude], { icon: dotIcon(b.isOpenNow ? '#1baf7a' : '#8a93a8', b.name, 18) }).addTo(group);
          marker.on('click', () => onEditZones(b));
          points.push([b.latitude, b.longitude]);
          if (b.deliveryRadiusM && !zonesOf(b.id).some((z) => z.isActive)) {
            L.circle([b.latitude, b.longitude], { radius: b.deliveryRadiusM, color: '#ff6b00', weight: 1, dashArray: '6 6', fillOpacity: 0.05 }).addTo(group);
          }
        }
      }
      if (points.length > 0 && map) map.fitBounds(L.latLngBounds(points as L.LatLngTuple[]), { padding: [30, 30], maxZoom: 14 });
    },
    [zoneKey],
  );

  return (
    <div className="card" style={{ padding: 10 }}>
      <LeafletMap height="min(70vh, 640px)" onReady={(m) => setMap(m)} />
      <p className="cell-sub" style={{ margin: '8px 4px 0' }}>
        Yashil — hozir ochiq filial. Filial belgisini bossangiz uning zonalari muharriri ochiladi. Toʻq chiziq — chizilgan zona, punktir — radius.
      </p>
    </div>
  );
}
