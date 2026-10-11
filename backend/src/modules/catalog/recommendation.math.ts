import type { MenuRecommendations, RecommendationPlacement } from '@restor/shared-types';

/**
 * Turning a restaurant's recommendation rules into what one branch's menu
 * actually shows.
 *
 * Extracted and pure for the reason the money helpers are: nothing crashes
 * when this is wrong — the customer is simply offered a dish that ran out, or
 * the same drink twice, or the burger they are looking at as "you might also
 * like". Each of those is pinned by a test.
 */

/** Enough to fill a horizontal row without making it a second menu. */
export const RECOMMENDATION_LIMIT = 12;

export interface RecommendationRule {
  placement: RecommendationPlacement;
  sourceProductId: string | null;
  targetProductId: string | null;
  targetCategoryId: string | null;
  sortOrder: number;
}

/** The branch's menu as the resolver needs it. */
export interface RecommendationMenuIndex {
  /** Product ids on sale at the branch, per category, in menu order. */
  productsByCategory: ReadonlyMap<string, readonly string[]>;
  /** Every product id on sale at the branch. */
  available: ReadonlySet<string>;
}

/**
 * One list, in the restaurant's order.
 *
 * - A product rule survives only if that product is on sale here.
 * - A category rule expands to whatever of the category is on sale here, so
 *   a dish that runs out disappears from the row without anyone editing it.
 * - Duplicates keep their first position: "Ichimliklar" after "Coca-Cola"
 *   does not show Coca-Cola twice.
 * - `excludeProductId` (the product being viewed) never recommends itself.
 */
export function expandRecommendationList(
  rules: readonly RecommendationRule[],
  index: RecommendationMenuIndex,
  excludeProductId: string | null = null,
  limit = RECOMMENDATION_LIMIT,
): string[] {
  const ordered = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);
  const result: string[] = [];
  const seen = new Set<string>();

  const push = (productId: string) => {
    if (result.length >= limit) return;
    if (productId === excludeProductId) return;
    if (!index.available.has(productId)) return;
    if (seen.has(productId)) return;
    seen.add(productId);
    result.push(productId);
  };

  for (const rule of ordered) {
    if (rule.targetProductId) {
      push(rule.targetProductId);
    } else if (rule.targetCategoryId) {
      for (const productId of index.productsByCategory.get(rule.targetCategoryId) ?? []) {
        push(productId);
      }
    }
    if (result.length >= limit) break;
  }

  return result;
}

/**
 * Every list a storefront needs, resolved once per menu build.
 *
 * A product whose own list resolves to nothing — every target sold out — is
 * left out of `byProduct`, so the client falls back to `productDefault`
 * rather than showing an empty row.
 */
export function resolveMenuRecommendations(
  rules: readonly RecommendationRule[],
  index: RecommendationMenuIndex,
  limit = RECOMMENDATION_LIMIT,
): MenuRecommendations {
  const lists = new Map<string, RecommendationRule[]>();
  for (const rule of rules) {
    const key = `${rule.placement}:${rule.sourceProductId ?? ''}`;
    const list = lists.get(key) ?? [];
    list.push(rule);
    lists.set(key, list);
  }

  const byProduct: Record<string, string[]> = {};
  for (const [key, list] of lists) {
    const [placement, source] = key.split(':') as [string, string];
    if (placement !== 'PRODUCT_DETAIL' || !source) continue;
    // Nobody can open the sheet of a product that is not on sale here.
    if (!index.available.has(source)) continue;

    const resolved = expandRecommendationList(list, index, source, limit);
    if (resolved.length > 0) byProduct[source] = resolved;
  }

  return {
    cart: expandRecommendationList(lists.get('CART:') ?? [], index, null, limit),
    productDefault: expandRecommendationList(lists.get('PRODUCT_DETAIL:') ?? [], index, null, limit),
    byProduct,
  };
}
