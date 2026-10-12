import type { Product } from '@restor/shared-types';

/**
 * What a branch does with a dish, exactly as the pricing service decides it:
 * no branch row, or one switched off, means the dish is not sold there at
 * all; a stop-listed row means it is sold but has run out for now.
 */
export function availabilityAt(p: Product, branchId: string): 'selling' | 'stopped' | 'off' {
  const setting = p.branchSettings?.find((s) => s.branchId === branchId);
  if (!setting || !setting.isAvailable) return 'off';
  return setting.isStopListed ? 'stopped' : 'selling';
}
