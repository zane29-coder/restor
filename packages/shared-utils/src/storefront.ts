/**
 * Storefront rules that both the Mini App and the API need to agree on.
 *
 * Kept pure and shared for the same reason the Zod schemas are: the product
 * sheet decides whether "Savatga qo'shish" is enabled with the very function
 * the tests pin, so the UI cannot quietly accept a selection the server will
 * refuse. The server still re-validates everything — this is the courtesy
 * check, not the control.
 */

import type { MenuModifierGroup, MenuProduct, PortionUnit, RequiredProfileField } from '@restor/shared-types';

/* -------------------------------------------------------------------------- */
/* Modifiers                                                                  */
/* -------------------------------------------------------------------------- */

/** A group is required when it demands at least one choice. */
export function isRequiredGroup(group: Pick<MenuModifierGroup, 'minSelect'>): boolean {
  return group.minSelect >= 1;
}

/** One choice at most renders as radio buttons; more as checkboxes. */
export function isSingleChoiceGroup(group: Pick<MenuModifierGroup, 'maxSelect'>): boolean {
  return group.maxSelect === 1;
}

/**
 * Whether tapping "+" on a card can add the product straight to the cart.
 *
 * Not when there is a size to pick (more than one variant) or any group the
 * customer must answer — even if its defaults would satisfy it: a required
 * choice is one the restaurant wants the customer to actually make.
 */
export function needsConfiguration(
  product: Pick<MenuProduct, 'variants' | 'modifierGroups'>,
): boolean {
  return product.variants.length > 1 || product.modifierGroups.some(isRequiredGroup);
}

/**
 * The selection a sheet opens with, and what a quick add sends.
 *
 * The restaurant's defaults, capped at each group's maximum so a
 * misconfigured group with three defaults and `maxSelect: 1` cannot produce a
 * selection the server rejects.
 */
export function defaultModifierIds(groups: MenuModifierGroup[]): string[] {
  const chosen: string[] = [];
  for (const group of groups) {
    const defaults = group.modifiers.filter((modifier) => modifier.isDefault);
    chosen.push(...defaults.slice(0, Math.max(0, group.maxSelect)).map((modifier) => modifier.id));
  }
  return chosen;
}

/** The variant a sheet opens with: the restaurant's default, else the first. */
export function defaultVariantId(product: Pick<MenuProduct, 'variants'>): string | null {
  const variant = product.variants.find((entry) => entry.isDefault) ?? product.variants[0];
  return variant?.id ?? null;
}

export interface ModifierIssue {
  groupId: string;
  message: string;
}

/**
 * Every group whose current selection the server would refuse, with the
 * Uzbek line the sheet shows under it. Empty means the selection is valid.
 *
 * Ids that belong to no group of this product are reported against the
 * product (`groupId: ''`) — the server rejects those too.
 */
export function validateModifierSelection(
  groups: MenuModifierGroup[],
  selectedIds: readonly string[],
): ModifierIssue[] {
  const selected = new Set(selectedIds);
  const issues: ModifierIssue[] = [];

  for (const group of groups) {
    const count = group.modifiers.filter((modifier) => selected.has(modifier.id)).length;
    for (const modifier of group.modifiers) selected.delete(modifier.id);

    if (count < group.minSelect) {
      issues.push({ groupId: group.id, message: requirementLabel(group) });
    } else if (count > group.maxSelect) {
      issues.push({
        groupId: group.id,
        message: `Koʻpi bilan ${group.maxSelect} ta tanlash mumkin`,
      });
    }
  }

  if (selected.size > 0) {
    issues.push({ groupId: '', message: 'Tanlangan variant bu mahsulotga tegishli emas' });
  }

  return issues;
}

/** The small grey line under a group's name: what the customer must do. */
export function requirementLabel(group: Pick<MenuModifierGroup, 'minSelect' | 'maxSelect'>): string {
  const { minSelect: min, maxSelect: max } = group;

  if (min >= 1) {
    if (min === max) return min === 1 ? 'Bittasini tanlang' : `${min} tasini tanlang`;
    return `${min} tadan ${max} tagacha tanlang`;
  }
  return max > 1 ? `Ixtiyoriy, ${max} tagacha` : 'Ixtiyoriy';
}

/* -------------------------------------------------------------------------- */
/* Cart lines                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Identifies one configuration of a product in a cart.
 *
 * The modifier ids are sorted, so ticking cheese then sauce and sauce then
 * cheese is the same line — while the same burger with and without cheese
 * stays two lines, which is the point: merging them would charge the wrong
 * price for one of them.
 */
export function cartLineKey(
  productId: string,
  variantId: string | null | undefined,
  modifierIds: readonly string[],
): string {
  return [productId, variantId ?? 'base', ...[...modifierIds].sort()].join('|');
}

/**
 * A client-side estimate of one unit, for the running total on screen.
 *
 * Mirrors the server: variant delta clamped at zero, modifiers added per
 * unit. It is only ever displayed — what the customer is charged comes back
 * from the server's own pricing.
 */
export function estimateUnitPrice(
  product: Pick<MenuProduct, 'price' | 'variants' | 'modifierGroups'>,
  variantId: string | null,
  modifierIds: readonly string[],
): number {
  const variant = variantId ? product.variants.find((entry) => entry.id === variantId) : undefined;
  const base = Math.max(0, product.price + (variant?.priceDelta ?? 0));

  const wanted = new Set(modifierIds);
  let extras = 0;
  for (const group of product.modifierGroups) {
    for (const modifier of group.modifiers) {
      if (wanted.has(modifier.id)) extras += modifier.price;
    }
  }

  return base + extras;
}

/* -------------------------------------------------------------------------- */
/* Display                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `450 g`, `1,2 kg`, `300 ml`, `1,5 l`, `6 dona`.
 *
 * A comma decimal, because that is how Uzbek menus print it.
 */
export function formatPortion(size: number | null | undefined, unit: PortionUnit | null | undefined): string | null {
  if (size == null || unit == null || size <= 0) return null;

  const scaled = (value: number) =>
    (Math.round(value * 10) / 10).toString().replace('.', ',');

  switch (unit) {
    case 'G':
      return size >= 1000 ? `${scaled(size / 1000)} kg` : `${size} g`;
    case 'ML':
      return size >= 1000 ? `${scaled(size / 1000)} l` : `${size} ml`;
    case 'PCS':
      return `${size} dona`;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Which of the three fields an order needs are still empty.
 *
 * Whitespace counts as empty: a name of three spaces is not a name a courier
 * can ask for at the door.
 */
export function missingProfileFields(profile: {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  phone: string | null | undefined;
}): RequiredProfileField[] {
  const missing: RequiredProfileField[] = [];
  if (!profile.firstName?.trim()) missing.push('firstName');
  if (!profile.lastName?.trim()) missing.push('lastName');
  if (!profile.phone?.trim()) missing.push('phone');
  return missing;
}

/** `Elbek Qurbonov`, or `null` when neither part is known. */
export function fullNameOf(profile: {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
}): string | null {
  const name = [profile.firstName?.trim(), profile.lastName?.trim()].filter(Boolean).join(' ');
  return name || null;
}
