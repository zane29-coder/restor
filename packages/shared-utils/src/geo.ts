/**
 * Geospatial helpers for delivery-radius checks and courier tracking.
 *
 * Distances are straight-line (haversine) metres. That is deliberately
 * conservative for a radius check — real driving distance is always longer —
 * and is enough for the MVP; a routing provider can be swapped in later
 * without changing any caller.
 */

const EARTH_RADIUS_M = 6_371_008.8;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function isValidCoordinates(point: Partial<Coordinates>): point is Coordinates {
  return (
    typeof point.latitude === 'number' &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

/** Great-circle distance between two points, in metres, rounded to an integer. */
export function distanceMeters(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)));
}

/**
 * Whether `point` falls inside a branch's delivery radius.
 * A `null` radius means the branch has no limit configured.
 */
export function isWithinRadius(
  center: Coordinates,
  point: Coordinates,
  radiusM: number | null,
): boolean {
  if (radiusM == null) return true;
  return distanceMeters(center, point) <= radiusM;
}

/** A ring of `[latitude, longitude]` pairs; the last point joins the first. */
export type LatLngRing = ReadonlyArray<readonly [number, number]>;

/**
 * Whether `point` lies inside the polygon `ring` (even-odd ray casting).
 *
 * Planar on purpose: delivery zones span a few kilometres, where treating
 * degrees as a flat grid is off by centimetres — far below a map pin's own
 * error. A point exactly on an edge may land either side; a zone is drawn
 * by hand and no one can place a pin that precisely anyway.
 *
 * Fewer than three vertices encloses nothing and returns false.
 */
export function isPointInPolygon(point: Coordinates, ring: LatLngRing): boolean {
  if (ring.length < 3) return false;
  const { latitude: y, longitude: x } = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Reads a stored polygon (JSON) defensively: malformed points are dropped,
 * and anything that is not an array encloses nothing.
 */
export function toLatLngRing(json: unknown): Array<[number, number]> {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (p): p is [number, number] =>
      Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  );
}

/** Picks the nearest entry, or `null` for an empty list. */
export function findNearest<T extends Coordinates>(
  origin: Coordinates,
  candidates: readonly T[],
): { item: T; distanceM: number } | null {
  let best: { item: T; distanceM: number } | null = null;
  for (const candidate of candidates) {
    const distance = distanceMeters(origin, candidate);
    if (!best || distance < best.distanceM) {
      best = { item: candidate, distanceM: distance };
    }
  }
  return best;
}

/** `1 240` → `1.2 km`, `640` → `640 m`. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
