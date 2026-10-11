import {
  CheckoutPaymentOption,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@restor/shared-types';
import {
  addressDetailsPatch,
  addressLine,
  availablePaymentOptions,
  canRetryPayment,
  paymentIntentFor,
  promoUsesLeft,
} from '../../src/modules/storefront/storefront.math';

describe('availablePaymentOptions', () => {
  const settings = { cashEnabled: true, onlineProviders: ['CLICK', 'ATMOS'] };

  it('offers enabled online providers in a fixed order, cash last', () => {
    expect(availablePaymentOptions(settings, true)).toEqual(['ATMOS', 'CLICK', 'CASH']);
  });

  it('hides every online option while Subo is not active, whatever the settings say', () => {
    expect(availablePaymentOptions(settings, false)).toEqual(['CASH']);
  });

  it('offers nothing online that the restaurant did not enable', () => {
    expect(availablePaymentOptions({ cashEnabled: true, onlineProviders: [] }, true)).toEqual(['CASH']);
  });

  it('can be online-only', () => {
    expect(availablePaymentOptions({ cashEnabled: false, onlineProviders: ['PAYME'] }, true)).toEqual([
      'PAYME',
    ]);
  });

  it('ignores a provider name Subo does not know', () => {
    expect(
      availablePaymentOptions({ cashEnabled: false, onlineProviders: ['UZCARD'] }, true),
    ).toEqual([]);
  });
});

describe('paymentIntentFor', () => {
  it('records cash as CASH with no provider', () => {
    expect(paymentIntentFor(CheckoutPaymentOption.CASH)).toEqual({
      method: PaymentMethod.CASH,
      provider: null,
    });
  });

  it.each(['ATMOS', 'CLICK', 'PAYME'] as const)('records %s as a Subo payment through it', (option) => {
    expect(paymentIntentFor(option)).toEqual({ method: PaymentMethod.SUBO, provider: option });
  });
});

describe('canRetryPayment', () => {
  const unpaidOnline = {
    paymentMethod: PaymentMethod.SUBO,
    status: OrderStatus.NEW,
    paymentStatus: PaymentStatus.UNPAID,
    total: 54_000,
    paidTotal: 0,
  };

  it('allows an unpaid online order', () => {
    expect(canRetryPayment(unpaidOnline)).toBe(true);
  });

  it('allows the rest of a partly paid one', () => {
    expect(
      canRetryPayment({ ...unpaidOnline, paymentStatus: PaymentStatus.PARTIALLY_PAID, paidTotal: 10_000 }),
    ).toBe(true);
  });

  it('refuses a cash order — the courier settles that', () => {
    expect(canRetryPayment({ ...unpaidOnline, paymentMethod: PaymentMethod.CASH })).toBe(false);
  });

  it('refuses an order already paid', () => {
    expect(
      canRetryPayment({ ...unpaidOnline, paymentStatus: PaymentStatus.PAID, paidTotal: 54_000 }),
    ).toBe(false);
  });

  it('refuses a cancelled order, so money is never taken for food not coming', () => {
    expect(canRetryPayment({ ...unpaidOnline, status: OrderStatus.CANCELLED })).toBe(false);
  });

  it('refuses an order with nothing owed even if the status lags', () => {
    expect(canRetryPayment({ ...unpaidOnline, paidTotal: 54_000 })).toBe(false);
  });
});

describe('addressDetailsPatch', () => {
  const saved = {
    house: '280A',
    apartment: null,
    entrance: null,
    floor: null,
    intercom: null,
    comment: 'Darvoza kodi 1234',
  };

  it('writes back only what the customer filled in and that differs', () => {
    expect(addressDetailsPatch(saved, { apartment: '12', floor: '3', house: '280A' })).toEqual({
      apartment: '12',
      floor: '3',
    });
  });

  it('leaves untouched fields alone', () => {
    expect(addressDetailsPatch(saved, {})).toEqual({});
  });

  it('clears a field the customer emptied', () => {
    expect(addressDetailsPatch(saved, { comment: '   ' })).toEqual({ comment: null });
  });

  it('trims what it stores', () => {
    expect(addressDetailsPatch(saved, { intercom: ' 12K ' })).toEqual({ intercom: '12K' });
  });
});

describe('addressLine', () => {
  it('joins the street and the house', () => {
    expect(addressLine('Uzum Bogʻi 2-tor koʻchasi', '280A')).toBe('Uzum Bogʻi 2-tor koʻchasi, 280A');
  });

  it('does not repeat a house number the street line already ends with', () => {
    expect(addressLine('Amir Temur koʻchasi, 15', '15')).toBe('Amir Temur koʻchasi, 15');
  });

  it('is just the street without a house', () => {
    expect(addressLine(' Chilonzor 9 ', null)).toBe('Chilonzor 9');
  });
});

describe('promoUsesLeft', () => {
  it('is unlimited without a per-customer limit', () => {
    expect(promoUsesLeft(null, 5)).toBeNull();
  });

  it('counts down and never goes negative', () => {
    expect(promoUsesLeft(2, 1)).toBe(1);
    expect(promoUsesLeft(2, 3)).toBe(0);
  });
});
