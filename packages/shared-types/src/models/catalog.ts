import type { BaseEntity } from '../api';

/** Menu category (TZ §9). Categories may nest one level for sub-menus. */
export interface Category extends BaseEntity {
  tenantId: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
  children?: Category[];
}

export interface Product extends BaseEntity {
  tenantId: string;
  categoryId: string;
  category?: Pick<Category, 'id' | 'name'>;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  /** Base price in minor units. */
  price: number;
  /** Promotional price; when set and lower than `price` it is what is charged. */
  discountPrice: number | null;
  /** Minutes the kitchen needs — feeds the KDS timer and the customer ETA. */
  preparationTime: number;
  sortOrder: number;
  isActive: boolean;
  variants: ProductVariant[];
  modifierGroups: ModifierGroup[];
  /** Per-branch availability and price overrides (TZ §9). */
  branchSettings?: ProductBranchSetting[];
}

/** Size/option of a product, e.g. Pizza Small / Medium / Large (TZ §9). */
export interface ProductVariant extends BaseEntity {
  productId: string;
  name: string;
  sku: string | null;
  /**
   * Added to the product price. Use a negative value for a cheaper size — the
   * effective price is clamped at zero.
   */
  priceDelta: number;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
}

/**
 * A set of modifiers offered together, with selection bounds.
 * `minSelect: 1, maxSelect: 1` renders as a radio group; otherwise checkboxes.
 */
export interface ModifierGroup extends BaseEntity {
  tenantId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  modifiers: Modifier[];
}

/** Single add-on, e.g. "Extra cheese +5000" (TZ §9). */
export interface Modifier extends BaseEntity {
  groupId: string;
  name: string;
  price: number;
  sortOrder: number;
  isActive: boolean;
}

/** Availability / price of one product at one branch. */
export interface ProductBranchSetting {
  productId: string;
  branchId: string;
  isAvailable: boolean;
  /** Overrides `Product.price` at this branch when set. */
  priceOverride: number | null;
  /** Temporary stop-list flag the floor staff can toggle. */
  isStopListed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Customer-facing menu                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The whole menu for one branch, already filtered to available items and with
 * branch price overrides applied. Built for a single request from the
 * customer web / mini app so they never have to merge availability client-side.
 */
export interface BranchMenu {
  branchId: string;
  categories: MenuCategory[];
  generatedAt: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  imageUrl: string | null;
  sortOrder: number;
  products: MenuProduct[];
}

export interface MenuProduct {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** Effective price after branch override and discount. */
  price: number;
  /** Original price when a discount applies, so the UI can strike it through. */
  oldPrice: number | null;
  preparationTime: number;
  isAvailable: boolean;
  variants: Array<Pick<ProductVariant, 'id' | 'name' | 'priceDelta' | 'isDefault'>>;
  modifierGroups: Array<{
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    modifiers: Array<Pick<Modifier, 'id' | 'name' | 'price'>>;
  }>;
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export interface CreateCategoryRequest {
  name: string;
  parentId?: string | null;
  description?: string;
  imageUrl?: string;
  sortOrder?: number;
}

export type UpdateCategoryRequest = Partial<CreateCategoryRequest> & {
  isActive?: boolean;
};

export interface CreateProductRequest {
  categoryId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  price: number;
  discountPrice?: number | null;
  preparationTime?: number;
  sortOrder?: number;
  variants?: Array<Omit<CreateProductVariantRequest, 'productId'>>;
  modifierGroupIds?: string[];
  branchIds?: string[];
}

export type UpdateProductRequest = Partial<CreateProductRequest> & {
  isActive?: boolean;
};

export interface CreateProductVariantRequest {
  productId: string;
  name: string;
  priceDelta: number;
  sku?: string;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface CreateModifierGroupRequest {
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder?: number;
  modifiers: Array<{ name: string; price: number; sortOrder?: number }>;
}
