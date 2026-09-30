/**
 * Loyalty point arithmetic (TZ §10).
 *
 * Points are money in every way that matters: they are earned against a real
 * bill, they reduce a real bill, and a restaurant carries them as a liability.
 * A rounding error here does not crash anything — it quietly gives away or
 * withholds value on every order, which is why the arithmetic is pure and
 * tested exhaustively rather than woven into a service.
 *
 * Two rounding decisions, both deliberate and both in the customer's favour
 * only where it costs nothing:
 *
 *  - **Earning rounds DOWN.** Awarding a fraction of a point the customer did
 *    not earn compounds across thousands of orders into a liability nobody
 *    agreed to.
 *  - **Redemption rounds DOWN** to whole soʻm, and is capped by three separate
 *    limits. The tightest one wins.
 */

/** What an order earns, in points. Rounds down. */
export function pointsEarned(orderTotal: number, cashbackPercent: number): number {
  if (orderTotal <= 0 || cashbackPercent <= 0) return 0;
  return Math.floor((orderTotal * cashbackPercent) / 100);
}

export interface RedemptionLimits {
  /** Points the customer holds. */
  points: number;
  /** What one point is worth, in minor units. */
  pointValue: number;
  /** The bill being paid. */
  orderTotal: number;
  /** The share of a bill points may cover, as a percent. */
  maxRedeemPercent: number;
}

export interface Redemption {
  /** Points to debit. */
  points: number;
  /** The discount those points produce, in minor units. */
  amount: number;
}

/**
 * The most a customer may pay with points on this order.
 *
 * Three ceilings, and the tightest applies: what they hold, what the
 * restaurant allows as a share of the bill, and the bill itself. Returning
 * more than any one of them would let points pay for an order twice over.
 */
export function maxRedeemable(limits: RedemptionLimits): Redemption {
  const { points, pointValue, orderTotal, maxRedeemPercent } = limits;

  if (points <= 0 || pointValue <= 0 || orderTotal <= 0) {
    return { points: 0, amount: 0 };
  }

  const byBalance = points * pointValue;
  const byPolicy = Math.floor((orderTotal * clampPercent(maxRedeemPercent)) / 100);
  const amount = Math.min(byBalance, byPolicy, orderTotal);

  if (amount <= 0) return { points: 0, amount: 0 };

  // Only whole points can be spent, so the amount is snapped back down to
  // what an exact number of points actually buys. Without this, a cap of
  // 12 500 against a point worth 1 000 would debit 13 points for 12 500 --
  // charging the customer half a point they still had.
  const spendablePoints = Math.floor(amount / pointValue);
  return { points: spendablePoints, amount: spendablePoints * pointValue };
}

/**
 * Applies a customer's requested redemption, clamped to what is allowed.
 *
 * A client asking to spend more than it may is not an error worth failing the
 * order over — it is a stale balance or an optimistic UI. The request is
 * trimmed to the legal maximum and the caller is told what actually happened.
 */
export function redeem(limits: RedemptionLimits, requestedPoints: number): Redemption {
  const ceiling = maxRedeemable(limits);
  if (requestedPoints <= 0) return { points: 0, amount: 0 };

  const points = Math.min(requestedPoints, ceiling.points);
  return { points, amount: points * limits.pointValue };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 100);
}
