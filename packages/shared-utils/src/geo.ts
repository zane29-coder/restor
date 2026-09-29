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
