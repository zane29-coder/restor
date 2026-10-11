import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPickerHandle {
  /** Moves the map so the pin sits on these coordinates. */
  flyTo: (latitude: number, longitude: number) => void;
}

/**
 * Choosing a spot by moving the map under a fixed pin — the way delivery apps
 * do it, and easier with a thumb than dragging a marker.
 *
 * OpenStreetMap tiles through Leaflet: no key, no contract, attribution kept
 * as the tile licence requires. If the tiles cannot load (offline, blocked),
 * the address can still be typed by hand on the same screen.
 */
export const MapPicker = forwardRef<
  MapPickerHandle,
  {
    latitude: number;
    longitude: number;
    /** Fires when the map comes to rest, with the coordinates under the pin. */
    onSettle: (latitude: number, longitude: number) => void;
  }
>(function MapPicker({ latitude, longitude, onSettle }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const [moving, setMoving] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      // One-finger drags pan the map; the page around it does not scroll
      // because the map takes the gesture.
      dragging: true,
      tap: false,
    } as L.MapOptions).setView([latitude, longitude], 16);

    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    tiles.on('tileerror', () => setTilesFailed(true));
    tiles.on('tileload', () => setTilesFailed(false));

    map.on('movestart', () => setMoving(true));
    map.on('moveend', () => {
      setMoving(false);
      const center = map.getCenter();
      onSettleRef.current(center.lat, center.lng);
    });

    mapRef.current = map;
    // The container is sized by CSS after the first paint.
    window.setTimeout(() => map.invalidateSize(), 50);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    flyTo: (lat, lng) => mapRef.current?.flyTo([lat, lng], 17, { duration: 0.6 }),
  }));

  return (
    <div className="map-picker">
      <div ref={containerRef} className="map-picker__map" aria-label="Xarita" />
      <div className={`map-picker__pin${moving ? ' map-picker__pin--lifted' : ''}`} aria-hidden="true">
        <svg width="36" height="48" viewBox="0 0 36 48">
          <path
            d="M18 2C9.2 2 2 9 2 17.6 2 29 18 46 18 46s16-17 16-28.4C34 9 26.8 2 18 2Z"
            fill="var(--primary)"
            stroke="#fff"
            strokeWidth="2.5"
          />
          <circle cx="18" cy="17.5" r="6" fill="#fff" />
        </svg>
        <span className="map-picker__shadow" />
      </div>
      {tilesFailed && <div className="map-picker__offline">Xarita yuklanmadi — manzilni pastda qoʻlda kiriting</div>}
    </div>
  );
});
