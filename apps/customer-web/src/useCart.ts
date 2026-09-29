import { useCallback, useMemo, useState } from 'react';
import type { MenuProduct } from '@restor/shared-types';
import { addMoney, multiplyMoney } from '@restor/shared-utils';

export interface CartLine {
  /** Stable key for a product + variant + modifier combination. */
  key: string;
  productId: string;
  name: string;
  variantId: string | null;
  variantName: string | null;
  modifierIds: string[];
  modifierNames: string[];
  unitPrice: number;
  quantity: number;
}

export interface CartApi {
  lines: CartLine[];
  count: number;
  /** Client-side estimate ONLY — the server re-prices everything (TZ §76). */
  estimatedSubtotal: number;
  add: (product: MenuProduct, variantId?: string, modifierIds?: string[]) => void;
  changeQuantity: (key: string, delta: number) => void;
  clear: () => void;
}

/**
 * Cart state.
 *
 * Deliberately holds no authoritative money: the price shown here is a local
 * estimate so the UI feels instant, and `/orders/preview` is what the customer
 * actually confirms against. A tampered cart cannot change what is charged.
 */
export function useCart(): CartApi {
  const [lines, setLines] = useState<CartLine[]>([]);

  const add = useCallback(
    (product: MenuProduct, variantId?: string, modifierIds: string[] = []) => {
      const variant =
        product.variants.find((entry) => entry.id === variantId) ??
        product.variants.find((entry) => entry.isDefault) ??
        product.variants[0];

      const modifiers = product.modifierGroups
        .flatMap((group) => group.modifiers)
        .filter((modifier) => modifierIds.includes(modifier.id));

      const unitPrice =
        Math.max(0, product.price + (variant?.priceDelta ?? 0)) +
        addMoney(...modifiers.map((modifier) => modifier.price));

      const key = [product.id, variant?.id ?? 'base', ...[...modifierIds].sort()].join('|');

      setLines((current) => {
        const existing = current.find((line) => line.key === key);
        if (existing) {
          return current.map((line) =>
            line.key === key ? { ...line, quantity: line.quantity + 1 } : line,
          );
        }

        return [
          ...current,
          {
            key,
            productId: product.id,
            name: product.name,
            variantId: variant?.id ?? null,
            variantName: variant?.name ?? null,
            modifierIds,
            modifierNames: modifiers.map((modifier) => modifier.name),
            unitPrice,
            quantity: 1,
          },
        ];
      });
    },
    [],
  );

  const changeQuantity = useCallback((key: string, delta: number) => {
    setLines((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const count = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines],
  );

  const estimatedSubtotal = useMemo(
    () => addMoney(...lines.map((line) => multiplyMoney(line.unitPrice, line.quantity))),
    [lines],
  );

  return { lines, count, estimatedSubtotal, add, changeQuantity, clear };
}
