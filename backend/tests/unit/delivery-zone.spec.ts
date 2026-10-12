import { isPointInPolygon, toLatLngRing as ringFrom } from '@restor/shared-utils';
import {
  zoneFeeFor,
  zoneFor,
  type PricingZone,
} from '../../src/modules/orders/order-pricing.service';

/**
 * Drawn delivery zones (TZ §11).
 *
 * Which zone contains an address decides both whether the order is accepted
 * and what it is charged, so the geometry and the tariff are tested without
 * a database. Coordinates are around Chilonzor, Tashkent.
 */

// A ~2 km square around (41.30, 69.20).
const SQUARE: Array<[number, number]> = [
  [41.29, 69.19],
  [41.29, 69.21],
  [41.31, 69.21],
  [41.31, 69.19],
];

// A concave "L": the notch at the top right is outside.
const L_SHAPE: Array<[number, number]> = [
  [41.29, 69.19],
  [41.29, 69.23],
  [41.30, 69.23],
  [41.30, 69.21],
  [41.32, 69.21],
  [41.32, 69.19],
];

const zone = (over: Partial<PricingZone>): PricingZone => ({
  id: 'z',
  name: 'Zona',
  polygon: SQUARE,
  deliveryPrice: 10_000,
  minOrderAmount: null,
  freeDeliveryFrom: null,
  sortOrder: 0,
  ...over,
});

describe('isPointInPolygon', () => {
  it('finds a point inside a square', () => {
    expect(isPointInPolygon({ latitude: 41.3, longitude: 69.2 }, SQUARE)).toBe(true);
  });

  it('rejects a point outside it', () => {
    expect(isPointInPolygon({ latitude: 41.32, longitude: 69.2 }, SQUARE)).toBe(false);
    expect(isPointInPolygon({ latitude: 41.3, longitude: 69.25 }, SQUARE)).toBe(false);
  });

  it('respects a concave notch', () => {
    expect(isPointInPolygon({ latitude: 41.295, longitude: 69.22 }, L_SHAPE)).toBe(true);
    // Inside the bounding box, but in the cut-out corner.
    expect(isPointInPolygon({ latitude: 41.31, longitude: 69.22 }, L_SHAPE)).toBe(false);
  });

  it('does not care which way the ring is wound', () => {
    const reversed = [...SQUARE].reverse();
    expect(isPointInPolygon({ latitude: 41.3, longitude: 69.2 }, reversed)).toBe(true);
  });

  it('treats fewer than three vertices as enclosing nothing', () => {
    expect(isPointInPolygon({ latitude: 41.3, longitude: 69.2 }, [])).toBe(false);
    expect(isPointInPolygon({ latitude: 41.3, longitude: 69.2 }, SQUARE.slice(0, 2))).toBe(false);
  });
});

describe('zoneFor', () => {
  const inner = zone({ id: 'inner', name: 'Ichki', deliveryPrice: 0, sortOrder: 0, polygon: SQUARE });
  const outer = zone({
    id: 'outer',
    name: 'Tashqi',
    deliveryPrice: 15_000,
    sortOrder: 1,
    polygon: [
      [41.27, 69.17],
      [41.27, 69.23],
      [41.33, 69.23],
      [41.33, 69.17],
    ],
  });

  it('lets the lower sortOrder win where zones overlap', () => {
    expect(zoneFor({ latitude: 41.3, longitude: 69.2 }, [outer, inner])?.id).toBe('inner');
  });

  it('falls through to the outer zone outside the inner one', () => {
    expect(zoneFor({ latitude: 41.325, longitude: 69.2 }, [inner, outer])?.id).toBe('outer');
  });

  it('returns null outside every zone', () => {
    expect(zoneFor({ latitude: 41.4, longitude: 69.2 }, [inner, outer])).toBeNull();
  });
});

describe('zoneFeeFor', () => {
  it('charges the zone price', () => {
    expect(zoneFeeFor({ deliveryPrice: 12_000, freeDeliveryFrom: null }, 50_000)).toBe(12_000);
  });

  it('is free at the threshold, not only above it', () => {
    expect(zoneFeeFor({ deliveryPrice: 12_000, freeDeliveryFrom: 100_000 }, 100_000)).toBe(0);
  });

  it('still charges just below the threshold', () => {
    expect(zoneFeeFor({ deliveryPrice: 12_000, freeDeliveryFrom: 100_000 }, 99_999)).toBe(12_000);
  });

  it('can be a free zone outright', () => {
    expect(zoneFeeFor({ deliveryPrice: 0, freeDeliveryFrom: null }, 1)).toBe(0);
  });
});

describe('ringFrom', () => {
  it('keeps well-formed pairs', () => {
    expect(ringFrom(SQUARE)).toHaveLength(4);
  });

  it('drops anything malformed rather than throwing', () => {
    expect(ringFrom([[41.3, 69.2], [1], 'x', [Number.NaN, 2], [41.31, 69.21]])).toEqual([
      [41.3, 69.2],
      [41.31, 69.21],
    ]);
    expect(ringFrom(null)).toEqual([]);
    expect(ringFrom({})).toEqual([]);
  });
});
