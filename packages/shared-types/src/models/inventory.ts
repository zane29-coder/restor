import type { BaseEntity } from '../api';
import type { StockMovementType, StockUnit } from '../enums';

/* -------------------------------------------------------------------------- */
/* Inventory (TZ §29-§31)                                                     */
/* -------------------------------------------------------------------------- */

export interface Supplier extends BaseEntity {
  tenantId: string;
  name: string;
  phone: string | null;
  contact: string | null;
  comment: string | null;
  isActive: boolean;
}

/**
 * One tracked ingredient or supply, held AT A BRANCH.
 *
 * Never pooled per tenant: flour in Chilonzor cannot be used by Yunusobod, and
 * one shared figure would let a branch sell a dish it has no ingredients for.
 *
 * Quantities cross the wire as strings. They are NUMERIC(14,3) in Postgres, and
 * putting them through a JSON number would reintroduce exactly the float drift
 * the column type exists to avoid.
 */
export interface StockItem extends BaseEntity {
  tenantId: string;
  branchId: string;
  branchName?: string;
  name: string;
  unit: StockUnit;
  /** On hand, as a decimal string. */
  quantity: string;
  /** Reorder threshold; `null` means never flagged as low. */
  minQuantity: string | null;
  /** Last known purchase cost of ONE unit, in minor units. */
  costPerUnit: number;
  /** `quantity <= minQuantity`. Computed server-side so every screen agrees. */
  isLow: boolean;
  /** `quantity × costPerUnit`, in minor units — what is sitting on the shelf. */
  stockValue: number;
  isActive: boolean;
}

export interface StockMovement extends BaseEntity {
  tenantId: string;
  stockItemId: string;
  stockItemName?: string;
  unit?: StockUnit;
  type: StockMovementType;
  /** Signed, as a decimal string: the sign is the direction. */
  quantity: string;
  costPerUnit: number | null;
  supplierId: string | null;
  supplierName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  comment: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
}

/** What one unit of a product consumes. */
export interface ProductIngredient {
  id: string;
  productId: string;
  stockItemId: string;
  stockItemName: string;
  unit: StockUnit;
  /** Per one unit of the product, in the stock item's unit. */
  quantity: string;
  /** `quantity × costPerUnit` — the ingredient cost of one serving. */
  cost: number;
}

/** A product's recipe and what it costs to make (TZ §31). */
export interface ProductRecipe {
  productId: string;
  productName: string;
  /** Selling price, for the margin beside it. */
  price: number;
  ingredients: ProductIngredient[];
  /** Summed ingredient cost of one serving, in minor units. */
  totalCost: number;
  /** `price − totalCost`. Negative means the dish loses money. */
  margin: number;
  /** Margin as a percentage of price; `null` when the price is zero. */
  marginPercent: number | null;
}

/** Headline inventory figures for one branch (TZ §30). */
export interface StockSummary {
  branchId: string | null;
  itemsCount: number;
  lowCount: number;
  /** Total value on the shelves, in minor units. */
  totalValue: number;
  /** Items at or below their reorder threshold, lowest first. */
  lowItems: StockItem[];
  /** Waste recorded in the window, in minor units — the number to act on. */
  wasteValue: number;
}
