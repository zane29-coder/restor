import { CashTransactionType, PaymentMethod } from '@restor/shared-types';
import { shiftDeltaFor, type ShiftDelta } from '../../src/modules/cash/cash.service';

/**
 * Cash shift arithmetic (TZ §19).
 *
 * A cashier is personally answerable for the difference between this number
 * and what is physically in the drawer at close. A sign error does not crash
 * anything — it makes an honest cashier look short.
 *
 * The invariant:
 *
 *     expectedCash = openingCash + cash sales − cash refunds
 *                    + cashIn − cashOut + handovers − withdrawals
 */

const CASH = PaymentMethod.CASH;
const CARD = PaymentMethod.CARD;

/** Applies a sequence of movements to a freshly opened shift. */
function apply(
  movements: Array<[CashTransactionType, PaymentMethod, number]>,
): ShiftDelta {
  return movements.reduce<ShiftDelta>(
    (total, [type, method, amount]) => {
      const delta = shiftDeltaFor(type, method, amount);
      return {
        expectedCash: total.expectedCash + delta.expectedCash,
        cashTotal: total.cashTotal + delta.cashTotal,
        cardTotal: total.cardTotal + delta.cardTotal,
        onlineTotal: total.onlineTotal + delta.onlineTotal,
        refundTotal: total.refundTotal + delta.refundTotal,
        orderCount: total.orderCount + delta.orderCount,
      };
    },
    {
      expectedCash: 0,
      cashTotal: 0,
      cardTotal: 0,
      onlineTotal: 0,
      refundTotal: 0,
      orderCount: 0,
    },
  );
}

describe('a cash sale', () => {
  it('goes into the drawer and the takings', () => {
    const delta = shiftDeltaFor(CashTransactionType.SALE, CASH, 50_000);
    expect(delta.expectedCash).toBe(50_000);
    expect(delta.cashTotal).toBe(50_000);
    expect(delta.orderCount).toBe(1);
  });
});

describe('a card sale', () => {
  // The distinction that matters most here: revenue that never reaches the
  // drawer. Adding it to expectedCash makes every shift look short by the
  // day's card takings.
  it('is revenue but does NOT touch the drawer', () => {
    const delta = shiftDeltaFor(CashTransactionType.SALE, CARD, 50_000);
    expect(delta.expectedCash).toBe(0);
    expect(delta.cardTotal).toBe(50_000);
    expect(delta.cashTotal).toBe(0);
    expect(delta.orderCount).toBe(1);
  });

  it('counts a terminal the same way', () => {
    expect(shiftDeltaFor(CashTransactionType.SALE, PaymentMethod.TERMINAL, 10_000)).toEqual(
      shiftDeltaFor(CashTransactionType.SALE, CARD, 10_000),
    );
  });
});

describe('an online sale', () => {
  it.each([PaymentMethod.SUBO, PaymentMethod.CLICK, PaymentMethod.PAYME, PaymentMethod.QR])(
    '%s counts as online and not as cash',
    (method) => {
      const delta = shiftDeltaFor(CashTransactionType.SALE, method, 75_000);
      expect(delta.onlineTotal).toBe(75_000);
      expect(delta.expectedCash).toBe(0);
      expect(delta.cashTotal).toBe(0);
    },
  );
});

describe('a bonus redemption', () => {
  it('is an order but not money taken', () => {
    // Loyalty points are not revenue. Counting them would overstate takings
    // and leave the drawer expecting cash that was never handed over.
    const delta = shiftDeltaFor(CashTransactionType.SALE, PaymentMethod.BONUS, 20_000);
    expect(delta.orderCount).toBe(1);
    expect(delta.expectedCash).toBe(0);
    expect(delta.cashTotal).toBe(0);
    expect(delta.cardTotal).toBe(0);
    expect(delta.onlineTotal).toBe(0);
  });
});

describe('refunds', () => {
  it('takes cash back out of the drawer', () => {
    const delta = shiftDeltaFor(CashTransactionType.REFUND, CASH, 30_000);
    expect(delta.expectedCash).toBe(-30_000);
    expect(delta.refundTotal).toBe(30_000);
  });

  it('leaves the drawer alone when it was a card payment', () => {
    const delta = shiftDeltaFor(CashTransactionType.REFUND, CARD, 30_000);
    expect(delta.expectedCash).toBe(0);
    expect(delta.refundTotal).toBe(30_000);
  });

  it('never counts as a sale', () => {
    const delta = shiftDeltaFor(CashTransactionType.REFUND, CASH, 30_000);
    expect(delta.orderCount).toBe(0);
    expect(delta.cashTotal).toBe(0);
  });
});

describe('a courier hand-over', () => {
  // The second distinction that matters: this cash is arriving, but the sale
  // it came from was counted when the customer paid the courier. Adding it to
  // cashTotal would count one delivery's revenue twice.
  it('fills the drawer without counting a second sale', () => {
    const delta = shiftDeltaFor(CashTransactionType.COURIER_HANDOVER, CASH, 200_000);
    expect(delta.expectedCash).toBe(200_000);
    expect(delta.cashTotal).toBe(0);
    expect(delta.orderCount).toBe(0);
  });
});

describe('manual movements', () => {
  it('cash in raises the drawer without being revenue', () => {
    const delta = shiftDeltaFor(CashTransactionType.CASH_IN, CASH, 100_000);
    expect(delta.expectedCash).toBe(100_000);
    expect(delta.cashTotal).toBe(0);
  });

  it('cash out lowers it', () => {
    expect(shiftDeltaFor(CashTransactionType.CASH_OUT, CASH, 40_000).expectedCash).toBe(-40_000);
  });

  it('the opening float raises it', () => {
    expect(shiftDeltaFor(CashTransactionType.OPENING_FLOAT, CASH, 200_000).expectedCash).toBe(
      200_000,
    );
  });

  it('a withdrawal lowers it', () => {
    expect(shiftDeltaFor(CashTransactionType.WITHDRAWAL, CASH, 500_000).expectedCash).toBe(
      -500_000,
    );
  });
});

describe('a whole shift', () => {
  it('adds up the way a cashier would count it', () => {
    const total = apply([
      [CashTransactionType.OPENING_FLOAT, CASH, 200_000],
      [CashTransactionType.SALE, CASH, 45_000],
      [CashTransactionType.SALE, CASH, 82_000],
      [CashTransactionType.SALE, CARD, 150_000],
      [CashTransactionType.SALE, PaymentMethod.SUBO, 64_000],
      [CashTransactionType.REFUND, CASH, 12_000],
      [CashTransactionType.COURIER_HANDOVER, CASH, 310_000],
      [CashTransactionType.CASH_OUT, CASH, 25_000],
    ]);

    // 200 000 + 45 000 + 82 000 − 12 000 + 310 000 − 25 000
    expect(total.expectedCash).toBe(600_000);
    // Only the two over-the-counter cash sales.
    expect(total.cashTotal).toBe(127_000);
    expect(total.cardTotal).toBe(150_000);
    expect(total.onlineTotal).toBe(64_000);
    expect(total.refundTotal).toBe(12_000);
    // Four sales; the hand-over and the manual movements are not orders.
    expect(total.orderCount).toBe(4);
  });

  it('comes back to the float when every sale is refunded', () => {
    const total = apply([
      [CashTransactionType.OPENING_FLOAT, CASH, 100_000],
      [CashTransactionType.SALE, CASH, 60_000],
      [CashTransactionType.REFUND, CASH, 60_000],
    ]);

    expect(total.expectedCash).toBe(100_000);
  });

  it('can go negative, and says so rather than clamping', () => {
    // A drawer paid out beyond its float is a real and urgent state. Clamping
    // it to zero would hide exactly the problem a manager needs to see.
    const total = apply([
      [CashTransactionType.OPENING_FLOAT, CASH, 10_000],
      [CashTransactionType.CASH_OUT, CASH, 50_000],
    ]);

    expect(total.expectedCash).toBe(-40_000);
  });
});
