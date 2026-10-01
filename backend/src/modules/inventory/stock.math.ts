import { StockMovementType } from '@restor/shared-types';

/**
 * Stock movement arithmetic (TZ §29).
 *
 * Pure, because a sign error here does not crash anything — it silently makes
 * a kitchen believe it has flour it does not, and the first anyone hears is a
 * dish coming off the menu mid-service.
 *
 * Quantities are handled as strings on the wire and as numbers here. That is
 * safe for the arithmetic itself, but the STORED total is NUMERIC in Postgres
 * and incremented there: deducting 0.1 kg three hundred times must come to
 * exactly 30 kg, and binary floating point does not.
 */

/** Which way a movement type pushes a stock level. */
export function directionOf(type: StockMovementType): 1 | -1 | 0 {
  switch (type) {
    case StockMovementType.RECEIPT:
    case StockMovementType.TRANSFER_IN:
      return 1;

    case StockMovementType.CONSUMPTION:
    case StockMovementType.WASTE:
    case StockMovementType.TRANSFER_OUT:
      return -1;

    // An adjustment carries its own sign: a stock-take can find more or less
    // than the books said, and forcing a direction here would make one of
    // those two cases impossible to express.
    case StockMovementType.ADJUSTMENT:
      return 0;

    default:
      return 0;
  }
}

/**
 * The signed quantity to store for a movement.
 *
 * Callers pass a magnitude for directional types and a signed value for an
 * adjustment. Storing the sign means summing the ledger reproduces the level
 * without the reader knowing each type's rules.
 */
export function signedQuantity(type: StockMovementType, quantity: number): number {
  const direction = directionOf(type);
  if (direction === 0) return quantity;
  return direction * Math.abs(quantity);
}

export interface RecipeLine {
  stockItemId: string;
  /** Per ONE unit of the product, in the stock item's own unit. */
  quantity: number;
}

/**
 * What a basket consumes.
 *
 * Lines for the same stock item are merged: two dishes that each use 200 g of
 * cheese must produce one deduction of 400 g, not two rows racing to update
 * the same level.
 */
export function consumptionFor(
  items: Array<{ productId: string; quantity: number }>,
  recipes: Map<string, RecipeLine[]>,
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const item of items) {
    const recipe = recipes.get(item.productId);
    // No recipe means the product is not stock-tracked. Not an error — it is
    // the incremental path that lets a restaurant cost ten dishes first.
    if (!recipe) continue;

    for (const line of recipe) {
      const needed = line.quantity * item.quantity;
      if (needed <= 0) continue;
      totals.set(line.stockItemId, (totals.get(line.stockItemId) ?? 0) + needed);
    }
  }

  return totals;
}

/** Whether a level has reached the point where somebody should reorder. */
export function isLow(quantity: number, minQuantity: number | null): boolean {
  if (minQuantity == null) return false;
  return quantity <= minQuantity;
}

/**
 * Rounds to the three decimal places the column stores.
 *
 * Applied before writing so a recipe of 0.3333 kg does not accumulate a
 * fourth-place remainder the database will silently drop anyway.
 */
export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}
