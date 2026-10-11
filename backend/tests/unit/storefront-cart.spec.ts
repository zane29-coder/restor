import type { MenuModifierGroup, MenuProduct } from '@restor/shared-types';
import {
  cartLineKey,
  defaultModifierIds,
  defaultVariantId,
  estimateUnitPrice,
  formatPortion,
  missingProfileFields,
  needsConfiguration,
  requirementLabel,
  validateModifierSelection,
} from '@restor/shared-utils';
import {
  checkoutSchema,
  saveRecommendationListSchema,
  updateCustomerProfileSchema,
} from '@restor/validation';

/**
 * The storefront rules the Mini App and the API share. The product sheet
 * enables "Savatga qo'shish" with exactly these functions, so a regression
 * here is a button that lets through what the server will refuse.
 */

const spice: MenuModifierGroup = {
  id: 'spice',
  name: 'Achchiqlik',
  minSelect: 1,
  maxSelect: 1,
  modifiers: [
    { id: 'hot', name: 'Achchiq', price: 0, isDefault: false },
    { id: 'mild', name: 'Achchiq emas', price: 0, isDefault: true },
  ],
};

const extras: MenuModifierGroup = {
  id: 'extras',
  name: 'Qoʻshimchalar',
  minSelect: 0,
  maxSelect: 2,
  modifiers: [
    { id: 'cheese', name: 'Pishloq', price: 5_000, isDefault: false },
    { id: 'sauce', name: 'Sous', price: 3_000, isDefault: false },
    { id: 'meat', name: 'Goʻsht', price: 10_000, isDefault: false },
  ],
};

function product(partial: Partial<MenuProduct> = {}): MenuProduct {
  return {
    id: 'lavash',
    name: 'Lavash',
    description: null,
    imageUrl: null,
    price: 30_000,
    oldPrice: null,
    preparationTime: 10,
    portionSize: null,
    portionUnit: null,
    isAvailable: true,
    variants: [],
    modifierGroups: [],
    ...partial,
  };
}

describe('needsConfiguration', () => {
  it('quick-adds a plain product', () => {
    expect(needsConfiguration(product())).toBe(false);
  });

  it('quick-adds a product whose groups are all optional', () => {
    expect(needsConfiguration(product({ modifierGroups: [extras] }))).toBe(false);
  });

  it('opens the sheet for a required group, even one a default would satisfy', () => {
    expect(needsConfiguration(product({ modifierGroups: [spice] }))).toBe(true);
  });

  it('opens the sheet when there is a size to choose', () => {
    expect(
      needsConfiguration(
        product({
          variants: [
            { id: 's', name: 'S', priceDelta: -5_000, isDefault: false },
            { id: 'm', name: 'M', priceDelta: 0, isDefault: true },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe('defaults', () => {
  it('pre-selects the restaurant’s defaults', () => {
    expect(defaultModifierIds([spice, extras])).toEqual(['mild']);
  });

  it('never pre-selects more than a group allows', () => {
    const misconfigured: MenuModifierGroup = {
      ...spice,
      modifiers: spice.modifiers.map((m) => ({ ...m, isDefault: true })),
    };
    expect(defaultModifierIds([misconfigured])).toHaveLength(1);
  });

  it('opens on the default variant, else the first', () => {
    const variants = [
      { id: 's', name: 'S', priceDelta: 0, isDefault: false },
      { id: 'm', name: 'M', priceDelta: 0, isDefault: true },
    ];
    expect(defaultVariantId({ variants })).toBe('m');
    expect(defaultVariantId({ variants: variants.map((v) => ({ ...v, isDefault: false })) })).toBe('s');
    expect(defaultVariantId({ variants: [] })).toBeNull();
  });
});

describe('validateModifierSelection', () => {
  it('accepts a valid selection', () => {
    expect(validateModifierSelection([spice, extras], ['hot', 'cheese'])).toEqual([]);
  });

  it('flags an unanswered required group with what to do', () => {
    expect(validateModifierSelection([spice], [])).toEqual([
      { groupId: 'spice', message: 'Bittasini tanlang' },
    ]);
  });

  it('flags too many choices', () => {
    const issues = validateModifierSelection([extras], ['cheese', 'sauce', 'meat']);
    expect(issues).toEqual([{ groupId: 'extras', message: 'Koʻpi bilan 2 ta tanlash mumkin' }]);
  });

  it('flags an id from another product, as the server would', () => {
    expect(validateModifierSelection([extras], ['other'])[0]?.groupId).toBe('');
  });
});

describe('requirementLabel', () => {
  it.each([
    [{ minSelect: 1, maxSelect: 1 }, 'Bittasini tanlang'],
    [{ minSelect: 2, maxSelect: 2 }, '2 tasini tanlang'],
    [{ minSelect: 1, maxSelect: 3 }, '1 tadan 3 tagacha tanlang'],
    [{ minSelect: 0, maxSelect: 1 }, 'Ixtiyoriy'],
    [{ minSelect: 0, maxSelect: 2 }, 'Ixtiyoriy, 2 tagacha'],
  ])('%o reads "%s"', (group, label) => {
    expect(requirementLabel(group)).toBe(label);
  });
});

describe('cartLineKey', () => {
  it('is the same line whatever order the boxes were ticked in', () => {
    expect(cartLineKey('p', null, ['b', 'a'])).toBe(cartLineKey('p', null, ['a', 'b']));
  });

  it('keeps different modifiers as different lines', () => {
    expect(cartLineKey('p', null, ['cheese'])).not.toBe(cartLineKey('p', null, []));
  });

  it('keeps different sizes as different lines', () => {
    expect(cartLineKey('p', 's', [])).not.toBe(cartLineKey('p', 'm', []));
  });
});

describe('estimateUnitPrice', () => {
  const lavash = product({
    variants: [{ id: 's', name: 'S', priceDelta: -40_000, isDefault: false }],
    modifierGroups: [extras],
  });

  it('adds modifiers per unit', () => {
    expect(estimateUnitPrice(lavash, null, ['cheese', 'sauce'])).toBe(38_000);
  });

  it('clamps a negative variant price at zero, like the server', () => {
    expect(estimateUnitPrice(lavash, 's', [])).toBe(0);
  });
});

describe('formatPortion', () => {
  it.each([
    [450, 'G', '450 g'],
    [1200, 'G', '1,2 kg'],
    [300, 'ML', '300 ml'],
    [1500, 'ML', '1,5 l'],
    [6, 'PCS', '6 dona'],
  ] as const)('%d %s → %s', (size, unit, text) => {
    expect(formatPortion(size, unit)).toBe(text);
  });

  it('is nothing when either half is missing', () => {
    expect(formatPortion(null, 'G')).toBeNull();
    expect(formatPortion(450, null)).toBeNull();
  });
});

describe('missingProfileFields', () => {
  it('asks only for what is missing', () => {
    expect(missingProfileFields({ firstName: 'Elbek', lastName: null, phone: '+998932063015' })).toEqual([
      'lastName',
    ]);
  });

  it('treats whitespace as missing', () => {
    expect(missingProfileFields({ firstName: '  ', lastName: 'Q', phone: 'x' })).toEqual(['firstName']);
  });
});

describe('storefront schemas', () => {
  it('normalises an Uzbek phone in any common format', () => {
    const parsed = updateCustomerProfileSchema.parse({ phone: '93 206 30 15' });
    expect(parsed.phone).toBe('+998932063015');
  });

  it('refuses a non-Uzbek number at checkout', () => {
    expect(updateCustomerProfileSchema.safeParse({ phone: '+7 912 345 67 89' }).success).toBe(false);
  });

  it('accepts Uzbek names with their apostrophes', () => {
    expect(updateCustomerProfileSchema.safeParse({ firstName: 'Gʻofur', lastName: "O'g'iloy" }).success).toBe(
      true,
    );
  });

  it('refuses digits in a name', () => {
    expect(updateCustomerProfileSchema.safeParse({ firstName: 'Elbek99' }).success).toBe(false);
  });

  const checkout = {
    branchId: '00000000-0000-4000-8000-000000000001',
    items: [{ productId: '00000000-0000-4000-8000-000000000002', quantity: 1 }],
    paymentOption: 'CASH',
    clientUuid: '00000000-0000-4000-8000-000000000003',
  };

  it('requires an address for delivery', () => {
    expect(checkoutSchema.safeParse({ ...checkout, type: 'DELIVERY' }).success).toBe(false);
  });

  it('does not require one for pickup', () => {
    expect(checkoutSchema.safeParse({ ...checkout, type: 'PICKUP' }).success).toBe(true);
  });

  it('accepts no price anywhere — there is no field for one', () => {
    const parsed = checkoutSchema.parse({ ...checkout, type: 'PICKUP', total: 1, price: 1 }) as Record<
      string,
      unknown
    >;
    expect(parsed).not.toHaveProperty('total');
    expect(parsed).not.toHaveProperty('price');
  });

  it('refuses a dine-in order through the storefront checkout', () => {
    expect(checkoutSchema.safeParse({ ...checkout, type: 'DINE_IN' }).success).toBe(false);
  });

  it('keeps cart recommendations restaurant-wide', () => {
    expect(
      saveRecommendationListSchema.safeParse({
        placement: 'CART',
        sourceProductId: '00000000-0000-4000-8000-000000000002',
        targets: [],
      }).success,
    ).toBe(false);
  });
});
