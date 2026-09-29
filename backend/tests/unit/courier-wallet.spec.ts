import { CourierTransactionType } from '@restor/shared-types';
import {
  walletDeltaFor,
  type WalletDelta,
} from '../../src/modules/couriers/courier-wallet.service';

/**
 * Courier wallet arithmetic (TZ §26).
 *
 * This is money a courier is physically holding, reconciled against a till at
 * the end of a shift. A sign error here does not crash anything — it just
 * makes the numbers wrong, and nobody finds out until cash is counted. Hence
 * the exhaustive coverage of a handful of additions.
 *
 * The invariant under test:
 *
 *     balance = cashReceived − cashHandedOver − expenses
 */

/** Applies a sequence of movements to an empty wallet. */
function apply(
  movements: Array<[CourierTransactionType, number]>,
): WalletDelta {
  return movements.reduce<WalletDelta>(
    (total, [type, amount]) => {
      const delta = walletDeltaFor(type, amount);
      return {
        cashReceived: total.cashReceived + delta.cashReceived,
        deliveryIncome: total.deliveryIncome + delta.deliveryIncome,
        expenses: total.expenses + delta.expenses,
        cashHandedOver: total.cashHandedOver + delta.cashHandedOver,
        balance: total.balance + delta.balance,
      };
    },
    { cashReceived: 0, deliveryIncome: 0, expenses: 0, cashHandedOver: 0, balance: 0 },
  );
}

const holdsInvariant = (w: WalletDelta): boolean =>
  w.balance === w.cashReceived - w.cashHandedOver - w.expenses;

describe('walletDeltaFor', () => {
  it('cash collected from a customer increases what the courier holds', () => {
    expect(walletDeltaFor(CourierTransactionType.CASH_RECEIVED, 156_000)).toEqual({
      cashReceived: 156_000,
      deliveryIncome: 0,
      expenses: 0,
      cashHandedOver: 0,
      balance: 156_000,
    });
  });

  it('a hand-off reduces what the courier holds', () => {
    expect(walletDeltaFor(CourierTransactionType.HANDOVER, 100_000)).toEqual({
      cashReceived: 0,
      deliveryIncome: 0,
      expenses: 0,
      cashHandedOver: 100_000,
      balance: -100_000,
    });
  });

  it('an expense reduces what the courier owes', () => {
    expect(walletDeltaFor(CourierTransactionType.EXPENSE, 20_000)).toEqual({
      cashReceived: 0,
      deliveryIncome: 0,
      expenses: 20_000,
      cashHandedOver: 0,
      balance: -20_000,
    });
  });

  /**
   * The distinction that matters most: earnings are not custody. A courier who
   * has earned 50 000 but collected nothing owes the restaurant nothing.
   */
  it('delivery income does NOT change the balance', () => {
    const delta = walletDeltaFor(CourierTransactionType.DELIVERY_INCOME, 15_000);
    expect(delta.deliveryIncome).toBe(15_000);
    expect(delta.balance).toBe(0);
    expect(delta.cashReceived).toBe(0);
  });

  it('an adjustment moves only the balance, in the direction given', () => {
    expect(walletDeltaFor(CourierTransactionType.ADJUSTMENT, 5_000).balance).toBe(5_000);
    expect(walletDeltaFor(CourierTransactionType.ADJUSTMENT, -5_000).balance).toBe(-5_000);
  });

  it('a zero amount is a no-op', () => {
    for (const type of Object.values(CourierTransactionType)) {
      const delta = walletDeltaFor(type, 0);
      expect(Object.values(delta).every((value) => value === 0)).toBe(true);
    }
  });
});

describe('wallet invariant over a realistic shift', () => {
  it('holds after a full day of deliveries', () => {
    const wallet = apply([
      // Three cash deliveries.
      [CourierTransactionType.CASH_RECEIVED, 156_000],
      [CourierTransactionType.DELIVERY_INCOME, 15_000],
      [CourierTransactionType.CASH_RECEIVED, 89_000],
      [CourierTransactionType.DELIVERY_INCOME, 15_000],
      [CourierTransactionType.CASH_RECEIVED, 205_000],
      [CourierTransactionType.DELIVERY_INCOME, 20_000],
      // Fuel, paid out of the collected cash.
      [CourierTransactionType.EXPENSE, 30_000],
      // Two hand-offs to the till.
      [CourierTransactionType.HANDOVER, 200_000],
      [CourierTransactionType.HANDOVER, 150_000],
    ]);

    expect(wallet.cashReceived).toBe(450_000);
    expect(wallet.cashHandedOver).toBe(350_000);
    expect(wallet.expenses).toBe(30_000);
    // 450 000 − 350 000 − 30 000
    expect(wallet.balance).toBe(70_000);

    // Earnings accumulated independently of custody.
    expect(wallet.deliveryIncome).toBe(50_000);
    expect(holdsInvariant(wallet)).toBe(true);
  });

  it('holds when a prepaid order collects no cash', () => {
    // Online-paid delivery: the courier earns but carries nothing.
    const wallet = apply([[CourierTransactionType.DELIVERY_INCOME, 15_000]]);

    expect(wallet.balance).toBe(0);
    expect(wallet.deliveryIncome).toBe(15_000);
    expect(holdsInvariant(wallet)).toBe(true);
  });

  it('holds when everything is handed over', () => {
    const wallet = apply([
      [CourierTransactionType.CASH_RECEIVED, 100_000],
      [CourierTransactionType.HANDOVER, 100_000],
    ]);

    expect(wallet.balance).toBe(0);
    expect(holdsInvariant(wallet)).toBe(true);
  });

  it('goes negative when expenses exceed what was collected', () => {
    // The restaurant owes the courier — a real state, not an error.
    const wallet = apply([
      [CourierTransactionType.CASH_RECEIVED, 50_000],
      [CourierTransactionType.EXPENSE, 80_000],
    ]);

    expect(wallet.balance).toBe(-30_000);
    expect(holdsInvariant(wallet)).toBe(true);
  });

  it('holds for any order of the same movements', () => {
    const movements: Array<[CourierTransactionType, number]> = [
      [CourierTransactionType.CASH_RECEIVED, 120_000],
      [CourierTransactionType.EXPENSE, 15_000],
      [CourierTransactionType.HANDOVER, 60_000],
      [CourierTransactionType.DELIVERY_INCOME, 25_000],
    ];

    const forwards = apply(movements);
    const backwards = apply([...movements].reverse());

    // Addition is commutative, and the ledger must be too — a courier handing
    // over before or after an expense reaches the same balance.
    expect(forwards).toEqual(backwards);
    expect(holdsInvariant(forwards)).toBe(true);
  });
});
