import { PromoCodeType, PromotionType } from '@restor/shared-types';
import {
  assertDiscountMatchesType,
  assertValueMatchesType,
} from '../../src/modules/marketing/marketing.service';

/**
 * What a promotion's `value` means (TZ §10).
 *
 * One number, two readings, and the gap between them is the whole shop: `50`
 * on a PERCENTAGE_DISCOUNT is half off, `50` on a FIXED_DISCOUNT is fifty
 * soʻm. A manager who picks the wrong type and keeps the number they had in
 * mind creates a promotion that discounts every order to nothing — and
 * nothing downstream questions it, because both are valid integers.
 *
 * The check also has to survive a PATCH that changes only the type. That is
 * why the service runs it against the merged row rather than the request body.
 */
describe('a promotion value against its type', () => {
  describe('percentage', () => {
    it.each([1, 10, 50, 99, 100])('accepts %i%%', (value) => {
      expect(() =>
        assertValueMatchesType(PromotionType.PERCENTAGE_DISCOUNT, value),
      ).not.toThrow();
    });

    it('rejects an amount of soʻm typed into a percentage', () => {
      // The exact mistake this exists for.
      expect(() =>
        assertValueMatchesType(PromotionType.PERCENTAGE_DISCOUNT, 50_000),
      ).toThrow();
    });

    it('rejects zero and 101', () => {
      expect(() => assertValueMatchesType(PromotionType.PERCENTAGE_DISCOUNT, 0)).toThrow();
      expect(() => assertValueMatchesType(PromotionType.PERCENTAGE_DISCOUNT, 101)).toThrow();
    });

    it('rejects a negative', () => {
      expect(() => assertValueMatchesType(PromotionType.PERCENTAGE_DISCOUNT, -10)).toThrow();
    });
  });

  describe('fixed amount', () => {
    it('accepts any positive amount', () => {
      expect(() => assertValueMatchesType(PromotionType.FIXED_DISCOUNT, 1)).not.toThrow();
      expect(() => assertValueMatchesType(PromotionType.FIXED_DISCOUNT, 50_000)).not.toThrow();
    });

    it('rejects zero, which would discount nothing', () => {
      expect(() => assertValueMatchesType(PromotionType.FIXED_DISCOUNT, 0)).toThrow();
    });

    it('rejects a negative, which would raise the bill', () => {
      expect(() => assertValueMatchesType(PromotionType.FIXED_DISCOUNT, -5_000)).toThrow();
    });
  });

  describe('types that carry no value', () => {
    it('leaves free delivery and happy hour alone', () => {
      // Their behaviour comes from elsewhere -- a zero here is not an error.
      expect(() => assertValueMatchesType(PromotionType.FREE_DELIVERY, 0)).not.toThrow();
      expect(() => assertValueMatchesType(PromotionType.HAPPY_HOUR, 0)).not.toThrow();
      expect(() => assertValueMatchesType(PromotionType.BUY_X_GET_Y, 0)).not.toThrow();
    });
  });
});

describe('a promo code discount against its type', () => {
  it('accepts a valid percentage', () => {
    expect(() => assertDiscountMatchesType(PromoCodeType.PERCENTAGE, 15)).not.toThrow();
  });

  it('rejects soʻm typed into a percentage code', () => {
    expect(() => assertDiscountMatchesType(PromoCodeType.PERCENTAGE, 15_000)).toThrow();
  });

  it('accepts a positive fixed discount', () => {
    expect(() => assertDiscountMatchesType(PromoCodeType.FIXED, 15_000)).not.toThrow();
  });

  it('rejects a zero fixed discount', () => {
    expect(() => assertDiscountMatchesType(PromoCodeType.FIXED, 0)).toThrow();
  });

  it('leaves free delivery alone', () => {
    expect(() => assertDiscountMatchesType(PromoCodeType.FREE_DELIVERY, 0)).not.toThrow();
  });
});
