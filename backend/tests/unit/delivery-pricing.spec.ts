import {
  deliveryFeeFor,
  type DeliveryPricing,
} from '../../src/modules/orders/order-pricing.service';

/**
 * Delivery charge rules (TZ §11).
 *
 * This decides what a customer is charged at checkout. Nothing crashes when
 * it is wrong — the number is simply off, on every order, until someone
 * reconciles a month of takings and asks why. Hence exhaustive coverage of
 * what is, in the end, a handful of comparisons.
 */

const FLAT: DeliveryPricing = {
  deliveryPrice: 15_000,
  freeDeliveryRadiusM: null,
  freeDeliveryFrom: null,
  deliveryPricePerKm: null,
};

const KM = 1000;

describe('a branch with one flat price', () => {
  it('charges it at any distance', () => {
    expect(deliveryFeeFor(FLAT, 200, 50_000)).toBe(15_000);
    expect(deliveryFeeFor(FLAT, 9 * KM, 50_000)).toBe(15_000);
  });

  it('charges it when the distance is unknown', () => {
    expect(deliveryFeeFor(FLAT, null, 50_000)).toBe(15_000);
  });
});

describe('a branch that delivers free', () => {
  // The simplest configuration, and the one that must keep working: price
  // zero, no other rule set.
  const free: DeliveryPricing = { ...FLAT, deliveryPrice: 0 };

  it('charges nothing, near or far', () => {
    expect(deliveryFeeFor(free, 100, 10_000)).toBe(0);
    expect(deliveryFeeFor(free, 20 * KM, 10_000)).toBe(0);
    expect(deliveryFeeFor(free, null, 10_000)).toBe(0);
  });
});

describe('free within a radius', () => {
  const branch: DeliveryPricing = { ...FLAT, freeDeliveryRadiusM: 1 * KM };

  it('is free inside the zone', () => {
    expect(deliveryFeeFor(branch, 1, 30_000)).toBe(0);
    expect(deliveryFeeFor(branch, 999, 30_000)).toBe(0);
  });

  it('is free exactly on the boundary', () => {
    // Inclusive: a customer standing on the 1 km line is "within 1 km".
    expect(deliveryFeeFor(branch, 1 * KM, 30_000)).toBe(0);
  });

  it('charges the base price one metre beyond it', () => {
    expect(deliveryFeeFor(branch, 1 * KM + 1, 30_000)).toBe(15_000);
  });

  it('charges the base price when the distance is unknown', () => {
    // The rule cannot be applied, so it does not apply. Guessing in the
    // customer's favour would let anyone claim the free zone by omitting a pin.
    expect(deliveryFeeFor(branch, null, 30_000)).toBe(15_000);
  });
});

describe('free above an order amount', () => {
  const branch: DeliveryPricing = { ...FLAT, freeDeliveryFrom: 100_000 };

  it('charges below the threshold', () => {
    expect(deliveryFeeFor(branch, 5 * KM, 99_999)).toBe(15_000);
  });

  it('is free exactly at the threshold', () => {
    expect(deliveryFeeFor(branch, 5 * KM, 100_000)).toBe(0);
  });

  it('beats every distance rule', () => {
    const far: DeliveryPricing = {
      ...branch,
      freeDeliveryRadiusM: 1 * KM,
      deliveryPricePerKm: 5_000,
    };
    expect(deliveryFeeFor(far, 20 * KM, 100_000)).toBe(0);
  });
});

describe('charging per kilometre beyond the free zone', () => {
  const branch: DeliveryPricing = {
    ...FLAT,
    deliveryPrice: 10_000,
    freeDeliveryRadiusM: 1 * KM,
    deliveryPricePerKm: 3_000,
  };

  it('is free inside the free zone', () => {
    expect(deliveryFeeFor(branch, 800, 40_000)).toBe(0);
  });

  it('counts a started kilometre as a whole one', () => {
    // 1 200 m is 200 m past the free zone: one chargeable kilometre, not two.
    expect(deliveryFeeFor(branch, 1_200, 40_000)).toBe(13_000);
    expect(deliveryFeeFor(branch, 2 * KM, 40_000)).toBe(13_000);
    expect(deliveryFeeFor(branch, 2_001, 40_000)).toBe(16_000);
  });

  it('measures from the edge of the free zone, not the branch', () => {
    // 4 km out with 1 km free is 3 chargeable km. Measuring from the branch
    // would give 4 and quietly overcharge every order.
    expect(deliveryFeeFor(branch, 4 * KM, 40_000)).toBe(10_000 + 3 * 3_000);
  });

  it('falls back to the flat price when the distance is unknown', () => {
    expect(deliveryFeeFor(branch, null, 40_000)).toBe(10_000);
  });

  it('measures from the branch when there is no free zone', () => {
    const noFreeZone: DeliveryPricing = { ...branch, freeDeliveryRadiusM: null };
    expect(deliveryFeeFor(noFreeZone, 2_500, 40_000)).toBe(10_000 + 3 * 3_000);
  });
});

describe('all the rules together', () => {
  // What a real branch might configure: 10 000 base, free within 1 km,
  // 3 000/km beyond that, and free for orders over 150 000.
  const branch: DeliveryPricing = {
    deliveryPrice: 10_000,
    freeDeliveryRadiusM: 1 * KM,
    freeDeliveryFrom: 150_000,
    deliveryPricePerKm: 3_000,
  };

  it.each([
    ['next door, small order', 300, 50_000, 0],
    ['3 km, small order', 3 * KM, 50_000, 16_000],
    ['3 km, large order', 3 * KM, 150_000, 0],
    ['no coordinates, small order', null, 50_000, 10_000],
  ])('%s', (_label, distanceM, goodsTotal, expected) => {
    expect(deliveryFeeFor(branch, distanceM as number | null, goodsTotal as number)).toBe(
      expected,
    );
  });

  it('never returns a negative charge', () => {
    for (const distanceM of [0, 1, 999, 1_000, 1_001, 50_000]) {
      expect(deliveryFeeFor(branch, distanceM, 1)).toBeGreaterThanOrEqual(0);
    }
  });
});
