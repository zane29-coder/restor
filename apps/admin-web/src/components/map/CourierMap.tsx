import { useState } from 'react';
import L from 'leaflet';
import { CourierStatus, type BranchSummary, type Courier, type Order } from '@restor/shared-types';
import { escapeHtml } from '@restor/shared-utils';
import { ago, som } from '../../lib/format';
import { COURIER_STATUS_LABELS } from '../../lib/labels';
import { LeafletMap, dotIcon, useLayer } from './LeafletMap';

const STATUS_COLOR: Record<string, string> = {
  [CourierStatus.AVAILABLE]: '#1baf7a',
  [CourierStatus.ON_DELIVERY]: '#2a78d6',
  [CourierStatus.BREAK]: '#eda100',
  [CourierStatus.OFFLINE]: '#8a93a8',
};

/**
 * The dispatcher's live map: couriers at their last reported position,
 * branches, and the addresses of deliveries still waiting for a courier.
 *
 * A courier's position is only as fresh as their last ping (the app reports
 * on shift only, every ~20 s); the tooltip says how old it is, because a dot
 * from an hour ago is not where that person is.
 */
export function CourierMap({
  couriers,
  branches,
  waiting,
  focusId,
  height = 460,
}: {
  couriers: Courier[];
  branches: BranchSummary[];
  waiting: Order[];
  focusId?: string | null;
  height?: number | string;
}) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [fitted, setFitted] = useState(false);

  useLayer(
    map,
    (group) => {
      const points: L.LatLngTuple[] = [];
      for (const b of branches) {
        if (b.latitude == null || b.longitude == null) continue;
        L.marker([b.latitude, b.longitude], { icon: dotIcon('#0b1c30', b.name, 18), interactive: false }).addTo(group);
        points.push([b.latitude, b.longitude]);
      }
      for (const o of waiting) {
        const a = o.deliveryAddress;
        if (a?.latitude == null || a.longitude == null) continue;
        // Tooltips render HTML and the address is the customer's own text.
        L.marker([a.latitude, a.longitude], { icon: dotIcon('#ff6b00', `#${o.displayNumber}`, 14) })
          .bindTooltip(`#${escapeHtml(o.displayNumber)} · ${som(o.total)}<br>${escapeHtml(a.address)}`)
          .addTo(group);
        points.push([a.latitude, a.longitude]);
      }
      for (const c of couriers) {
        const loc = c.lastLocation;
        if (!loc) continue;
        const marker = L.marker([loc.latitude, loc.longitude], {
          icon: dotIcon(STATUS_COLOR[c.status] ?? '#8a93a8', c.fullName.split(' ')[0], c.id === focusId ? 22 : 16),
          zIndexOffset: c.id === focusId ? 1000 : 0,
        })
          .bindTooltip(
            `<strong>${escapeHtml(c.fullName)}</strong><br>${COURIER_STATUS_LABELS[c.status] ?? c.status}` +
              `${c.activeDeliveryCount ? ` · ${c.activeDeliveryCount} ta buyurtma` : ''}<br>Joylashuv: ${ago(loc.recordedAt)}`,
          )
          .addTo(group);
        if (c.id === focusId) marker.openTooltip();
        points.push([loc.latitude, loc.longitude]);
      }

      const focus = couriers.find((c) => c.id === focusId)?.lastLocation;
      if (focus && map) map.setView([focus.latitude, focus.longitude], 15);
      else if (!fitted && points.length > 0 && map) {
        map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 14 });
        setFitted(true);
      }
    },
    [couriers, branches, waiting, focusId],
  );

  return <LeafletMap height={height} onReady={(m) => setMap(m)} />;
}
