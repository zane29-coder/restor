import type { BaseEntity } from '../api';
import type { StockMovementType, StockUnit, SupplierOrderStatus } from '../enums';

/* -------------------------------------------------------------------------- */
/* Inventory (TZ §29-§31)                                                     */
/* -------------------------------------------------------------------------- */

export interface Supplier extends BaseEntity {
  tenantId: string;
  name: string;
  phone: string | null;
  contact: string | null;
  comment: string | null;
  /** A chat the bot shares with the supplier; purchase orders go there. */
  telegramChatId: string | null;
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
  category: string | null;
  sku: string | null;
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
  /** On a RECEIPT: the batch's use-by date and code. */
  expiresAt: string | null;
  batchCode: string | null;
  supplierOrderId: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
}

/**
 * A received batch and what is estimated to be left of it.
 *
 * Estimated first-in first-out: stock leaves through automatic consumption,
 * which cannot know which batch a cook reached for, so the current level is
 * attributed to the newest receipts and the oldest are taken as used first.
 */
export interface StockBatch {
  movementId: string;
  stockItemId: string;
  stockItemName: string;
  unit: StockUnit;
  branchId: string;
  supplierName: string | null;
  batchCode: string | null;
  receivedAt: string;
  expiresAt: string;
  received: string;
  remaining: string;
  /** `remaining × cost`, in minor units — what is lost if it goes off. */
  value: number;
  /** Whole days to the use-by date; negative once it has passed. */
  daysLeft: number;
}

/** One line of a purchase order, snapshotted when it was sent. */
export interface SupplierOrderLine {
  stockItemId: string;
  name: string;
  unit: StockUnit;
  quantity: string;
  /** Estimated cost of one unit at ordering time, in minor units. */
  unitCost: number;
}

export interface SupplierOrder extends BaseEntity {
  number: number;
  branchId: string;
  branchName: string | null;
  supplierId: string;
  supplierName: string;
  status: SupplierOrderStatus;
  lines: SupplierOrderLine[];
  total: number;
  note: string | null;
  expectedAt: string | null;
  /** QUEUED — sent to the supplier's chat; NO_CHAT / NO_BOT — not sent. */
  telegramStatus: 'QUEUED' | 'NO_CHAT' | 'NO_BOT';
  receivedAt: string | null;
  cancelledAt: string | null;
  createdByName: string | null;
  /** The message as sent (or as it would be), for copying by hand. */
  messageText: string;
}

export interface StockTakeLine {
  stockItemId: string;
  name: string;
  unit: StockUnit;
  /** The books at the moment the count was saved. */
  expected: string;
  counted: string;
  /** `counted − expected`; negative is a shortage. */
  difference: string;
  costPerUnit: number;
  /** `difference × costPerUnit`, signed, in minor units. */
  value: number;
}

/** A saved stock-take — the act staff sign. */
export interface StockTake {
  id: string;
  branchId: string;
  branchName: string | null;
  note: string | null;
  lines: StockTakeLine[];
  itemsCount: number;
  matchedCount: number;
  shortageValue: number;
  surplusValue: number;
  createdByName: string | null;
  createdAt: string;
}

/** What the item card shows: how fast it goes and what it goes into. */
export interface StockItemInsight {
  stockItemId: string;
  /** The last seven days, oldest first. Positive magnitudes as strings. */
  days: Array<{ date: string; consumed: string; wasted: string }>;
  /** Average daily consumption over the window. */
  avgDaily: string;
  /** At that rate, whole days until the shelf is empty; null without usage. */
  daysLeft: number | null;
  /** Dishes whose recipe uses it, with the amount per serving. */
  products: Array<{ id: string; name: string; quantity: string }>;
  /** Where it last came from — the default for a reorder. */
  lastReceipt: { supplierId: string | null; supplierName: string | null; costPerUnit: number | null; createdAt: string } | null;
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
  /** What sales consumed in the same window, so waste can be read as a share. */
  consumptionValue: number;
  /** Batches already past their use-by date with stock estimated left. */
  expiredBatches: number;
  /** Batches going off within the next three days. */
  expiringBatches: number;
}
