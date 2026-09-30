import { PaymentStatus } from '@restor/shared-types';
import { paymentStatusFor } from '../../src/modules/payments/payments.service';
import { SuboApiClient } from '../../src/integrations/subo/subo-api.client';

/**
 * An order's payment state (TZ §35, §36).
 *
 * Two failure modes this exists to prevent: food leaving the kitchen against
 * an order that was never paid, and a customer being asked to pay a second
 * time for one already settled. Both are silent — nothing throws, the status
 * is simply wrong — so the arithmetic is pinned exhaustively.
 */
describe('paymentStatusFor', () => {
  it('is UNPAID before anything is taken', () => {
    expect(paymentStatusFor(100_000, 0, 0)).toBe(PaymentStatus.UNPAID);
  });

  it('is PARTIALLY_PAID part of the way there', () => {
    expect(paymentStatusFor(100_000, 40_000, 0)).toBe(PaymentStatus.PARTIALLY_PAID);
    expect(paymentStatusFor(100_000, 99_999, 0)).toBe(PaymentStatus.PARTIALLY_PAID);
  });

  it('is PAID on the exact amount', () => {
    expect(paymentStatusFor(100_000, 100_000, 0)).toBe(PaymentStatus.PAID);
  });

  it('is PAID when the customer overpaid', () => {
    // Change owed is the cashier's problem, not the order's status. Leaving
    // this PARTIALLY_PAID would have the POS chase a customer who has already
    // handed over more than the bill.
    expect(paymentStatusFor(100_000, 120_000, 0)).toBe(PaymentStatus.PAID);
  });

  it('is PAID when nothing is owed', () => {
    // A fully discounted order owes nothing. Leaving it UNPAID would have the
    // POS demand a payment of zero before releasing the food.
    expect(paymentStatusFor(0, 0, 0)).toBe(PaymentStatus.PAID);
  });

  describe('refunds', () => {
    it('is PARTIALLY_REFUNDED when some of it comes back', () => {
      expect(paymentStatusFor(100_000, 100_000, 30_000)).toBe(
        PaymentStatus.PARTIALLY_REFUNDED,
      );
    });

    it('is REFUNDED when all of it does', () => {
      expect(paymentStatusFor(100_000, 100_000, 100_000)).toBe(PaymentStatus.REFUNDED);
    });

    it('outranks the paid state', () => {
      // A refunded order is refunded, whatever it was before.
      expect(paymentStatusFor(100_000, 40_000, 40_000)).toBe(PaymentStatus.REFUNDED);
    });
  });
});

/**
 * Subo speaks tiyin; RESTOR stores whole soʻm, because UZS has no circulating
 * subunit. Getting the factor wrong charges a customer 100× or 1/100× the
 * bill, which is the single most expensive bug available in this integration.
 */
describe('tiyin conversion', () => {
  it('multiplies by a hundred on the way out', () => {
    expect(SuboApiClient.toTiyin(156_000)).toBe(15_600_000);
    expect(SuboApiClient.toTiyin(1)).toBe(100);
  });

  it('divides by a hundred on the way back', () => {
    expect(SuboApiClient.fromTiyin(15_600_000)).toBe(156_000);
    expect(SuboApiClient.fromTiyin(5_000_000)).toBe(50_000);
  });

  it('round-trips every realistic order total', () => {
    for (const amount of [1_000, 12_500, 64_000, 156_000, 999_999, 4_999_999]) {
      expect(SuboApiClient.fromTiyin(SuboApiClient.toTiyin(amount))).toBe(amount);
    }
  });

  it('recognises a sandbox key by its prefix', () => {
    expect(SuboApiClient.isSandbox('sk_test_abc123')).toBe(true);
    expect(SuboApiClient.isSandbox('sk_live_abc123')).toBe(false);
    expect(SuboApiClient.isSandbox('sk_abc123')).toBe(false);
  });
});
