import { StockMovementType } from '@restor/shared-types';
import {
  consumptionFor,
  directionOf,
  isLow,
  roundQuantity,
  signedQuantity,
  type RecipeLine,
} from '../../src/modules/inventory/stock.math';

/**
 * Stock arithmetic (TZ §29).
 *
 * A sign error here crashes nothing. It makes a kitchen believe it has flour
 * it does not, and the first anyone hears is a dish coming off the menu in the
 * middle of service.
 */

describe('movement direction', () => {
  it('raises the level on a delivery or an inbound transfer', () => {
    expect(directionOf(StockMovementType.RECEIPT)).toBe(1);
    expect(directionOf(StockMovementType.TRANSFER_IN)).toBe(1);
  });

  it('lowers it on consumption, waste and an outbound transfer', () => {
    expect(directionOf(StockMovementType.CONSUMPTION)).toBe(-1);
    expect(directionOf(StockMovementType.WASTE)).toBe(-1);
    expect(directionOf(StockMovementType.TRANSFER_OUT)).toBe(-1);
  });

  it('leaves an adjustment to carry its own sign', () => {
    // A stock-take can find more or less than the books said. Forcing a
    // direction would make one of those two cases impossible to record.
    expect(directionOf(StockMovementType.ADJUSTMENT)).toBe(0);
  });
});

describe('the quantity stored', () => {
  it('ignores a sign the caller got wrong on a directional type', () => {
    // A receipt of -50 is a typo, not a removal of fifty.
    expect(signedQuantity(StockMovementType.RECEIPT, -50)).toBe(50);
    expect(signedQuantity(StockMovementType.CONSUMPTION, 2)).toBe(-2);
    expect(signedQuantity(StockMovementType.CONSUMPTION, -2)).toBe(-2);
  });

  it('keeps the sign on an adjustment, both ways', () => {
    expect(signedQuantity(StockMovementType.ADJUSTMENT, 5)).toBe(5);
    expect(signedQuantity(StockMovementType.ADJUSTMENT, -5)).toBe(-5);
  });
});

describe('what a basket consumes', () => {
  const recipes = new Map<string, RecipeLine[]>([
    [
      'pizza',
      [
        { stockItemId: 'cheese', quantity: 0.2 },
        { stockItemId: 'dough', quantity: 1 },
      ],
    ],
    ['lasagna', [{ stockItemId: 'cheese', quantity: 0.3 }]],
  ]);

  it('multiplies a recipe by the line quantity', () => {
    const totals = consumptionFor([{ productId: 'pizza', quantity: 3 }], recipes);
    expect(totals.get('cheese')).toBeCloseTo(0.6, 6);
    expect(totals.get('dough')).toBe(3);
  });

  it('MERGES lines that share a stock item', () => {
    // Two dishes using cheese must produce ONE deduction. Two rows racing to
    // update the same level is how a level ends up wrong under load.
    const totals = consumptionFor(
      [
        { productId: 'pizza', quantity: 1 },
        { productId: 'lasagna', quantity: 1 },
      ],
      recipes,
    );
    expect(totals.size).toBe(2);
    expect(totals.get('cheese')).toBeCloseTo(0.5, 6);
  });

  it('ignores products with no recipe', () => {
    // Not an error: a product without ingredients is simply not tracked, which
    // is what lets a restaurant cost ten dishes before modelling the menu.
    const totals = consumptionFor(
      [
        { productId: 'pizza', quantity: 1 },
        { productId: 'cola', quantity: 5 },
      ],
      recipes,
    );
    expect(totals.size).toBe(2);
    expect(totals.has('cola')).toBe(false);
  });

  it('consumes nothing from an empty basket', () => {
    expect(consumptionFor([], recipes).size).toBe(0);
  });

  it('skips a recipe line of zero rather than writing a no-op movement', () => {
    const zero = new Map<string, RecipeLine[]>([
      ['soup', [{ stockItemId: 'salt', quantity: 0 }]],
    ]);
    expect(consumptionFor([{ productId: 'soup', quantity: 10 }], zero).size).toBe(0);
  });
});

describe('the low-stock threshold', () => {
  it('is reached at the threshold, not below it', () => {
    // "Reorder at 5 kg" has to fire AT 5, or the order goes in at 4.9.
    expect(isLow(5, 5)).toBe(true);
    expect(isLow(4.9, 5)).toBe(true);
    expect(isLow(5.1, 5)).toBe(false);
  });

  it('never fires for an item with no threshold set', () => {
    expect(isLow(0, null)).toBe(false);
    expect(isLow(-10, null)).toBe(false);
  });

  it('fires for a level that has gone negative', () => {
    // Negative stock is wrong but real — a missed delivery, an unrecorded
    // waste. Hiding it would hide the problem.
    expect(isLow(-2, 1)).toBe(true);
  });
});

describe('rounding', () => {
  it('matches the three decimal places the column stores', () => {
    expect(roundQuantity(0.3333)).toBe(0.333);
    expect(roundQuantity(0.3335)).toBe(0.334);
    expect(roundQuantity(30)).toBe(30);
  });

  it('leaves a whole number alone', () => {
    expect(roundQuantity(1)).toBe(1);
    expect(roundQuantity(-1)).toBe(-1);
  });
});
