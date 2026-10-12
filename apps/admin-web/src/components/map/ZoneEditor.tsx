import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Branch, DeliveryZone, DeliveryZoneRequest } from '@restor/shared-types';
import { IconPlus, IconPolygon, IconSave, IconTrash } from '@restor/ui';
import { escapeHtml } from '@restor/shared-utils';
import { api, RestorApiError } from '../../lib/api';
import { som } from '../../lib/format';
import { digits } from '../menu/CatalogManagers';
import { Switch } from '../ui';
import { ErrorState, Loading } from '../States';
import { DEFAULT_CENTER, LeafletMap, dotIcon, useLayer } from './LeafletMap';

/** Zone colours in order; a new zone takes the next unused one. */
const ZONE_COLORS = ['#1BAF7A', '#FF6B00', '#2A78D6', '#E34948', '#9085E9', '#EDA100'];

type Draft = DeliveryZoneRequest & { key: string };

let seq = 0;
const keyOf = () => `z${++seq}`;

function toDraft(zone: DeliveryZone): Draft {
  return {
    key: zone.id,
    name: zone.name,
    color: zone.color,
    polygon: zone.polygon,
    deliveryPrice: zone.deliveryPrice,
    minOrderAmount: zone.minOrderAmount,
    freeDeliveryFrom: zone.freeDeliveryFrom,
    isActive: zone.isActive,
  };
}

/**
 * Draws a branch's delivery zones on the map.
 *
 * Click "Yangi zona", click the map to place corners, then "Yakunlash". A
 * selected zone's corners can be dragged; right-click a corner to remove it.
 * Nothing reaches the server until "Saqlash", which replaces the branch's
 * zones in one go — and from then on orders are priced by them.
 */
export function ZoneEditor({ branch, canEdit }: { branch: Branch; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [map, setMap] = useState<L.Map | null>(null);
  const [zones, setZones] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Array<[number, number]>>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const query = useQuery({
    queryKey: ['branches', branch.id, 'zones'],
    queryFn: () => api.branches.zones(branch.id),
  });

  useEffect(() => {
    if (query.data) {
      setZones(query.data.map(toDraft));
      setDirty(false);
    }
  }, [query.data]);

  const origin: [number, number] | null =
    branch.latitude != null && branch.longitude != null ? [branch.latitude, branch.longitude] : null;

  // Fit the view to the zones once they load.
  useEffect(() => {
    if (!map || !query.data) return;
    const points = query.data.flatMap((z) => z.polygon);
    if (points.length > 0) map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
    else if (origin) map.setView(origin, 13);
  }, [map, query.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map clicks place corners while drawing.
  useEffect(() => {
    if (!map) return;
    const onClick = (event: L.LeafletMouseEvent) => {
      if (!drawing) return;
      setDraft((d) => [...d, [round(event.latlng.lat), round(event.latlng.lng)]]);
    };
    map.on('click', onClick);
    map.getContainer().style.cursor = drawing ? 'crosshair' : '';
    return () => {
      map.off('click', onClick);
    };
  }, [map, drawing]);

  const change = (key: string, patch: Partial<Draft>) => {
    setZones((all) => all.map((z) => (z.key === key ? { ...z, ...patch } : z)));
    setDirty(true);
    setSaved(false);
  };

  // Branch marker and, as a reference, the old radius.
  useLayer(
    map,
    (group) => {
      if (!origin) return;
      L.marker(origin, { icon: dotIcon('#0b1c30', branch.name, 18), interactive: false }).addTo(group);
      if (branch.deliveryRadiusM && zones.length === 0) {
        L.circle(origin, {
          radius: branch.deliveryRadiusM,
          color: '#8a93a8',
          weight: 1,
          dashArray: '6 6',
          fill: false,
          interactive: false,
        }).addTo(group);
      }
    },
    [branch.id, zones.length],
  );

  // The zones themselves, with draggable corners on the selected one.
  useLayer(
    map,
    (group) => {
      zones.forEach((zone) => {
        if (zone.polygon.length < 3 || drawing === zone.key) return;
        const isSel = zone.key === selected;
        const poly = L.polygon(zone.polygon, {
          color: zone.color,
          weight: isSel ? 3 : 2,
          fillOpacity: zone.isActive ? (isSel ? 0.32 : 0.18) : 0.05,
          dashArray: zone.isActive ? undefined : '6 6',
          interactive: !drawing,
        }).addTo(group);
        poly.bindTooltip(`${escapeHtml(zone.name)} · ${zone.deliveryPrice ? som(zone.deliveryPrice) : 'bepul'}`, { sticky: true });
        poly.on('click', () => setSelected(zone.key));

        if (isSel && canEdit && !drawing) {
          zone.polygon.forEach((point, index) => {
            const vertex = L.marker(point, {
              draggable: true,
              icon: L.divIcon({ className: 'map-vertex', iconSize: [12, 12], iconAnchor: [6, 6] }),
            }).addTo(group);
            vertex.on('dragend', () => {
              const ll = vertex.getLatLng();
              change(zone.key, {
                polygon: zone.polygon.map((p, i) => (i === index ? [round(ll.lat), round(ll.lng)] : p)),
              });
            });
            vertex.on('contextmenu', () => {
              if (zone.polygon.length > 3) change(zone.key, { polygon: zone.polygon.filter((_, i) => i !== index) });
            });
          });
        }
      });
    },
    [zones, selected, drawing, canEdit],
  );

  // The zone being drawn.
  useLayer(
    map,
    (group) => {
      if (!drawing || draft.length === 0) return;
      L.polyline(draft.length > 2 ? [...draft, draft[0]!] : draft, { color: '#ff6b00', weight: 2, dashArray: '4 6' }).addTo(group);
      draft.forEach((p) =>
        L.marker(p, { icon: L.divIcon({ className: 'map-vertex', iconSize: [12, 12], iconAnchor: [6, 6] }), interactive: false }).addTo(group),
      );
    },
    [draft, drawing],
  );

  const startNew = () => {
    setDrawing('new');
    setDraft([]);
    setSelected(null);
  };

  const finishDrawing = () => {
    if (draft.length < 3) return;
    if (drawing === 'new') {
      const used = new Set(zones.map((z) => z.color.toUpperCase()));
      const key = keyOf();
      setZones((all) => [
        ...all,
        {
          key,
          name: `Zona ${all.length + 1}`,
          color: ZONE_COLORS.find((c) => !used.has(c)) ?? ZONE_COLORS[all.length % ZONE_COLORS.length]!,
          polygon: draft,
          deliveryPrice: branch.deliveryPrice,
          minOrderAmount: null,
          freeDeliveryFrom: null,
          isActive: true,
        },
      ]);
      setSelected(key);
    } else if (drawing) {
      change(drawing, { polygon: draft });
      setSelected(drawing);
    }
    setDirty(true);
    setDrawing(null);
    setDraft([]);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= zones.length) return;
    const next = [...zones];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setZones(next);
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => api.branches.saveZones(branch.id, zones.map(({ key: _key, ...zone }) => zone)),
    onSuccess: (result) => {
      setError(null);
      setSaved(true);
      queryClient.setQueryData(['branches', branch.id, 'zones'], result);
      void queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (e) => setError(e instanceof RestorApiError ? e.message : 'Saqlanmadi'),
  });

  const center = useMemo<[number, number]>(() => origin ?? DEFAULT_CENTER, [branch.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isLoading) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <div className="zone-editor">
      <div style={{ position: 'relative', minWidth: 0 }}>
        <LeafletMap center={center} zoom={13} height="min(68vh, 620px)" onReady={(m) => setMap(m)} />
        {drawing && (
          <div className="zone-editor__hint">
            <span>
              Xaritaga bosib burchaklarni qoʻying ({draft.length} ta nuqta
              {draft.length < 3 ? `, yana ${3 - draft.length} ta kerak` : ''})
            </span>
            <button type="button" className="btn btn--sm" disabled={draft.length < 3} onClick={finishDrawing}>
              Yakunlash
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length}>
              Oxirgisini oʻchirish
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setDrawing(null); setDraft([]); }}>
              Bekor
            </button>
          </div>
        )}
      </div>

      <div className="stack" style={{ alignContent: 'start' }}>
        <div className="soft-box" style={{ fontSize: 12.5 }}>
          {zones.length === 0
            ? `Zona chizilmagan — ${branch.deliveryRadiusM ? `buyurtmalar ${(branch.deliveryRadiusM / 1000).toFixed(1)} km radius boʻyicha` : 'buyurtmalar masofa cheklovisiz'} qabul qilinadi.`
            : 'Zonalar filialning yetkazish hududi: manzil biror zonaga tushmasa buyurtma qabul qilinmaydi. Ustma-ust tushganda roʻyxatdagi yuqoriroq zona amal qiladi.'}
        </div>

        {zones.map((zone, index) => (
          <div
            key={zone.key}
            className="soft-box stack"
            style={{ gap: 8, outline: zone.key === selected ? '2px solid var(--primary)' : undefined }}
            onClick={() => setSelected(zone.key)}
          >
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <input
                type="color"
                value={zone.color}
                disabled={!canEdit}
                onChange={(e) => change(zone.key, { color: e.target.value.toUpperCase() })}
                aria-label="Rang"
                style={{ width: 32, height: 32, padding: 0, border: 'none', background: 'none' }}
              />
              <input
                value={zone.name}
                disabled={!canEdit}
                onChange={(e) => change(zone.key, { name: e.target.value })}
                aria-label="Zona nomi"
                style={{ flex: 1, minWidth: 0 }}
              />
              <Switch checked={zone.isActive} disabled={!canEdit} onChange={(v) => change(zone.key, { isActive: v })} title="Faol" />
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <label className="stack" style={{ gap: 2 }}>
                <span className="cell-sub">Yetkazish</span>
                <input inputMode="numeric" style={{ width: '100%', minWidth: 0 }} disabled={!canEdit} value={String(zone.deliveryPrice)} onChange={(e) => change(zone.key, { deliveryPrice: digits(e.target.value) })} />
              </label>
              <label className="stack" style={{ gap: 2 }}>
                <span className="cell-sub">Min. buyurtma</span>
                <input
                  inputMode="numeric"
                  style={{ width: '100%', minWidth: 0 }}
                  placeholder="filialniki"
                  disabled={!canEdit}
                  value={zone.minOrderAmount ?? ''}
                  onChange={(e) => change(zone.key, { minOrderAmount: e.target.value.trim() ? digits(e.target.value) : null })}
                />
              </label>
              <label className="stack" style={{ gap: 2 }}>
                <span className="cell-sub">Shundan bepul</span>
                <input
                  inputMode="numeric"
                  style={{ width: '100%', minWidth: 0 }}
                  placeholder="—"
                  disabled={!canEdit}
                  value={zone.freeDeliveryFrom ?? ''}
                  onChange={(e) => change(zone.key, { freeDeliveryFrom: e.target.value.trim() ? digits(e.target.value) || null : null })}
                />
              </label>
            </div>
            {canEdit && (
              <div className="row" style={{ gap: 4 }}>
                <span className="cell-sub" style={{ flex: 1 }}>{zone.polygon.length} ta nuqta</span>
                <button type="button" className="btn btn--sm btn--ghost" onClick={(e) => { e.stopPropagation(); setDrawing(zone.key); setDraft([]); }}>
                  Qayta chizish
                </button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label="Yuqoriga" disabled={index === 0} onClick={(e) => { e.stopPropagation(); move(index, -1); }}>▲</button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label="Pastga" disabled={index === zones.length - 1} onClick={(e) => { e.stopPropagation(); move(index, 1); }}>▼</button>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm icon-btn--danger"
                  aria-label="Zonani oʻchirish"
                  onClick={(e) => {
                    e.stopPropagation();
                    setZones((all) => all.filter((z) => z.key !== zone.key));
                    setDirty(true);
                  }}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            )}
          </div>
        ))}

        {canEdit && (
          <button type="button" className="btn btn--ghost" disabled={Boolean(drawing)} onClick={startNew}>
            <IconPlus size={16} /> <IconPolygon size={16} /> Yangi zona chizish
          </button>
        )}

        {error && <div className="alert alert--error" style={{ margin: 0 }}>{error}</div>}
        {saved && !dirty && <div className="alert alert--info" style={{ margin: 0 }}>Zonalar saqlandi — yangi buyurtmalar shu boʻyicha narxlanadi</div>}
        {canEdit && (
          <button type="button" className="btn" disabled={!dirty || save.isPending || Boolean(drawing)} onClick={() => save.mutate()}>
            <IconSave size={16} />
            {save.isPending ? 'Saqlanmoqda…' : 'Zonalarni saqlash'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Six decimals is ~10 cm — plenty, and keeps the stored JSON short. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
