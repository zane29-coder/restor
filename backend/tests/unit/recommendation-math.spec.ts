import {
  expandRecommendationList,
  resolveMenuRecommendations,
  type RecommendationRule,
} from '../../src/modules/catalog/recommendation.math';

/**
 * Menu: drinks = cola, fanta (sprite is stop-listed, so absent); sauces =
 * ketchup; burgers = burger, cheeseburger.
 */
const index = {
  productsByCategory: new Map<string, string[]>([
    ['drinks', ['cola', 'fanta']],
    ['sauces', ['ketchup']],
    ['burgers', ['burger', 'cheeseburger']],
  ]),
  available: new Set(['cola', 'fanta', 'ketchup', 'burger', 'cheeseburger']),
};

function rule(partial: Partial<RecommendationRule>): RecommendationRule {
  return {
    placement: 'PRODUCT_DETAIL',
    sourceProductId: null,
    targetProductId: null,
    targetCategoryId: null,
    sortOrder: 0,
    ...partial,
  };
}

describe('expandRecommendationList', () => {
  it('expands a category into what is on sale, in menu order', () => {
    expect(expandRecommendationList([rule({ targetCategoryId: 'drinks' })], index)).toEqual([
      'cola',
      'fanta',
    ]);
  });

  it('keeps the restaurant’s order across rules', () => {
    const rules = [
      rule({ targetCategoryId: 'sauces', sortOrder: 1 }),
      rule({ targetProductId: 'fanta', sortOrder: 0 }),
    ];
    expect(expandRecommendationList(rules, index)).toEqual(['fanta', 'ketchup']);
  });

  it('drops a product that is not on sale here', () => {
    expect(expandRecommendationList([rule({ targetProductId: 'sprite' })], index)).toEqual([]);
  });

  it('never shows the same product twice', () => {
    const rules = [
      rule({ targetProductId: 'cola', sortOrder: 0 }),
      rule({ targetCategoryId: 'drinks', sortOrder: 1 }),
    ];
    expect(expandRecommendationList(rules, index)).toEqual(['cola', 'fanta']);
  });

  it('never recommends the product being viewed', () => {
    expect(
      expandRecommendationList([rule({ targetCategoryId: 'burgers' })], index, 'burger'),
    ).toEqual(['cheeseburger']);
  });

  it('stops at the limit', () => {
    const rules = [rule({ targetCategoryId: 'drinks' }), rule({ targetCategoryId: 'burgers', sortOrder: 1 })];
    expect(expandRecommendationList(rules, index, null, 3)).toEqual(['cola', 'fanta', 'burger']);
  });
});

describe('resolveMenuRecommendations', () => {
  const rules: RecommendationRule[] = [
    rule({ placement: 'CART', targetCategoryId: 'sauces' }),
    rule({ placement: 'PRODUCT_DETAIL', targetCategoryId: 'drinks' }),
    rule({ placement: 'PRODUCT_DETAIL', sourceProductId: 'burger', targetProductId: 'ketchup' }),
    // Every target sold out: the product falls back to the default list.
    rule({ placement: 'PRODUCT_DETAIL', sourceProductId: 'cheeseburger', targetProductId: 'sprite' }),
    // The source itself is not on sale here: nobody can open its sheet.
    rule({ placement: 'PRODUCT_DETAIL', sourceProductId: 'sprite', targetProductId: 'cola' }),
  ];

  const resolved = resolveMenuRecommendations(rules, index);

  it('resolves the cart list', () => {
    expect(resolved.cart).toEqual(['ketchup']);
  });

  it('resolves the default product-sheet list', () => {
    expect(resolved.productDefault).toEqual(['cola', 'fanta']);
  });

  it('keeps per-product lists that resolve to something', () => {
    expect(resolved.byProduct.burger).toEqual(['ketchup']);
  });

  it('leaves out a per-product list that resolved to nothing', () => {
    expect(resolved.byProduct).not.toHaveProperty('cheeseburger');
  });

  it('leaves out a list for a product not sold here', () => {
    expect(resolved.byProduct).not.toHaveProperty('sprite');
  });

  it('is empty, not missing, with no rules at all', () => {
    expect(resolveMenuRecommendations([], index)).toEqual({ cart: [], productDefault: [], byProduct: {} });
  });
});
