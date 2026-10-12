import { useEffect, useRef, useState, type CSSProperties } from 'react';
import L from 'leaflet';
import { escapeHtml } from '@restor/shared-utils';
import 'leaflet/dist/leaflet.css';

/** Tashkent city centre: where a map with nothing on it opens. */
export const DEFAULT_CENTER: [number, number] = [41.3111, 69.2797];

/**
 * A Leaflet map owned by React.
 *
 * Leaflet keeps its own DOM, so the map is created once per mount and handed
 * to the caller through `onReady`; layers are then added and removed
 * imperatively by the feature that owns them. Tiles are OpenStreetMap's,
 * with the attribution their usage policy requires.
 */
export function LeafletMap({
  center = DEFAULT_CENTER,
  zoom = 12,
  height = 420,
  onReady,
  style,
}: {
  center?: [number, number];
  zoom?: number;
  height?: number | string;
  onReady: (map: L.Map) => void | (() => void);
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, { center, zoom, zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const cleanup = readyRef.current(map);
    // The container may have been sized after mount (a drawer sliding in).
    const t = setTimeout(() => map.invalidateSize(), 200);

    return () => {
      clearTimeout(t);
      if (typeof cleanup === 'function') cleanup();
      map.remove();
    };
    // Created once; later centre/zoom changes are the caller's to apply.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={ref} className="leaflet-host" style={{ height, borderRadius: 'var(--radius)', ...style }} />;
}

/** A coloured dot marker that needs no image assets (bundlers lose Leaflet's). */
export function dotIcon(color: string, label?: string, size = 16): L.DivIcon {
  return L.divIcon({
    className: 'map-dot',
    html: `<span style="background:${color};width:${size}px;height:${size}px"></span>${
      label ? `<em>${escapeHtml(label)}</em>` : ''
    }`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Re-renders a layer group from data whenever `deps` change. */
export function useLayer(
  map: L.Map | null,
  draw: (group: L.LayerGroup) => void,
  deps: unknown[],
) {
  const [group] = useState(() => L.layerGroup());
  useEffect(() => {
    if (!map) return;
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, group]);
  useEffect(() => {
    group.clearLayers();
    if (map) draw(group);
  }, [map, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}
