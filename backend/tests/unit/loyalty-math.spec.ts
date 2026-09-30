import { maxRedeemable, pointsEarned, redeem } from '../../src/modules/customers/loyalty.math';

/**
 * Loyalty arithmetic (TZ §10).
 *
 * Points are a liability the restaurant carries. Getting this wrong gives
 * value away on every order or withholds it on every order, and either way
 * nothing errors — the numbers are simply wrong until someone reconciles a
 * month of them.
 */

describe('earning', () => {
  it('awards the cashback percentage of the bill', () => {
    expect(pointsEarned(100_000, 5)).toBe(5_000);
    expect(pointsEarned(64_000, 10)).toBe(6_400);
  });

  it('rounds down, never up', () => {
    // 3% of 1 010 is 30.3. Awarding 31 compounds into a liability nobody
    // agreed to.
    expect(pointsEarned(1_010, 3)).toBe(30);
    expect(pointsEarned(999, 1)).toBe(9);
  });

  it('earns nothing from a free order or a disabled programme', () => {
    expect(pointsEarned(0, 10)).toBe(0);
    expect(pointsEarned(100_000, 0)).toBe(0);
  });

  it('never returns a negative', () => {
    expect(pointsEarned(-5_000, 10)).toBe(0);
    expect(pointsEarned(100_000, -10)).toBe(0);
  });
});

describe('the redemption ceiling', () => {
  const base = { pointValue: 1_000, orderTotal: 100_000, maxRedeemPercent: 50 };

  it('is capped by the balance when that is the tightest', () => {
    // 10 points at 1 000 = 10 000, well under the 50 000 policy cap.
    expect(maxRedeemable({ ...base, points: 10 })).toEqual({ points: 10, amount: 10_000 });
  });

  it('is capped by the policy share when the balance is larger', () => {
    // 500 points would be 500 000, but only half the 100 000 bill may be paid.
    expect(maxRedeemable({ ...base, points: 500 })).toEqual({ points: 50, amount: 50_000 });
  });

  it('is capped by the bill itself at 100 percent', () => {
    expect(
      maxRedeemable({ ...base, points: 500, maxRedeemPercent: 100 }),
    ).toEqual({ points: 100, amount: 100_000 });
  });

  it('never debits a fraction of a point', () => {
    // A 12 500 cap against a 1 000-soʻm point buys 12 points, not 12.5.
    const result = maxRedeemable({
      points: 500,
      pointValue: 1_000,
      orderTotal: 25_000,
      maxRedeemPercent: 50,
    });
    expect(result).toEqual({ points: 12, amount: 12_000 });
  });

  it('is nothing when the customer has no points', () => {
    expect(maxRedeemable({ ...base, points: 0 })).toEqual({ points: 0, amount: 0 });
  });

  it('is nothing when the policy allows nothing', () => {
    expect(
      maxRedeemable({ ...base, points: 500, maxRedeemPercent: 0 }),
    ).toEqual({ points: 0, amount: 0 });
  });

  it('is nothing on a free order', () => {
    expect(maxRedeemable({ ...base, points: 500, orderTotal: 0 })).toEqual({
      points: 0,
      amount: 0,
    });
  });

  it('treats a percentage above 100 as 100', () => {
    expect(
      maxRedeemable({ ...base, points: 500, maxRedeemPercent: 400 }),
    ).toEqual({ points: 100, amount: 100_000 });
  });
});

describe('redeeming', () => {
  const base = { points: 500, pointValue: 1_000, orderTotal: 100_000, maxRedeemPercent: 50 };

  it('spends exactly what was asked for when it is allowed', () => {
    expect(redeem(base, 20)).toEqual({ points: 20, amount: 20_000 });
  });

  it('trims a request above the ceiling rather than failing', () => {
    // A stale balance in the client is not a reason to reject the order.
    expect(redeem(base, 999)).toEqual({ points: 50, amount: 50_000 });
  });

  it('spends nothing for a zero or negative request', () => {
    expect(redeem(base, 0)).toEqual({ points: 0, amount: 0 });
    expect(redeem(base, -5)).toEqual({ points: 0, amount: 0 });
  });

  it('never lets points exceed the bill', () => {
    const result = redeem(
      { points: 1_000, pointValue: 1_000, orderTotal: 30_000, maxRedeemPercent: 100 },
      1_000,
    );
    expect(result.amount).toBeLessThanOrEqual(30_000);
  });
});
