import type {
  Paginated,
  PaginationQuery,
  ProductRecipe,
  StockItem,
  StockMovement,
  StockMovementType,
  StockSummary,
  StockUnit,
  Supplier,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

/**
 * Inventory (TZ §29-§31).
 *
 * Quantities cross the wire as strings. They are NUMERIC in Postgres, and
 * routing them through a JSON number would reintroduce exactly the float drift
 * the column type exists to avoid — so this sends strings and expects them
 * back.
 */
export class InventoryResource {
  constructor(private readonly http: HttpClient) {}

  /* ------------------------------ Suppliers ------------------------- */

  listSuppliers(): Promise<Supplier[]> {
    return this.http.get<Supplier[]>('suppliers');
  }

  createSupplier(payload: {
    name: string;
    phone?: string | null;
    contact?: string | null;
    comment?: string | null;
  }): Promise<Supplier> {
    return this.http.post<Supplier>('suppliers', payload);
  }

  updateSupplier(
    id: string,
    payload: { name?: string; phone?: string | null; isActive?: boolean },
  ): Promise<Supplier> {
    return this.http.patch<Supplier>(`suppliers/${id}`, payload);
  }

  /* -------------------------------- Stock --------------------------- */

  /** What is low, what the shelves are worth, what has been wasted. */
  summary(branchId?: string, days?: number): Promise<StockSummary> {
    return this.http.get<StockSummary>('stock/summary', { query: { branchId, days } });
  }

  listItems(query?: {
    branchId?: string;
    lowOnly?: boolean;
    search?: string;
  }): Promise<StockItem[]> {
    return this.http.get<StockItem[]>('stock/items', { query });
  }

  getItem(id: string): Promise<StockItem> {
    return this.http.get<StockItem>(`stock/items/${id}`);
  }

  createItem(payload: {
    branchId: string;
    name: string;
    unit: StockUnit;
    quantity?: number;
    minQuantity?: number | null;
    costPerUnit?: number;
  }): Promise<StockItem> {
    return this.http.post<StockItem>('stock/items', payload);
  }

  /**
   * Note what this cannot change: the quantity.
   *
   * A level moves only through a movement, so no call changes a figure without
   * leaving a row explaining why.
   */
  updateItem(
    id: string,
    payload: {
      name?: string;
      unit?: StockUnit;
      minQuantity?: number | null;
      costPerUnit?: number;
      isActive?: boolean;
    },
  ): Promise<StockItem> {
    return this.http.patch<StockItem>(`stock/items/${id}`, payload);
  }

  removeItem(id: string): Promise<void> {
    return this.http.delete<void>(`stock/items/${id}`);
  }

  listMovements(
    query?: PaginationQuery & {
      stockItemId?: string;
      branchId?: string;
      type?: StockMovementType;
    },
  ): Promise<Paginated<StockMovement>> {
    return this.http.getPaginated<StockMovement>('stock/movements', { query });
  }

  /** Receipt, waste, adjustment or transfer. Consumption is automatic. */
  addMovement(payload: {
    stockItemId: string;
    type: StockMovementType;
    quantity: number;
    costPerUnit?: number;
    supplierId?: string;
    comment?: string;
  }): Promise<StockMovement> {
    return this.http.post<StockMovement>('stock/movements', payload);
  }

  /* ------------------------------- Recipes -------------------------- */

  /** A dish's ingredients, what it costs to make, and the margin. */
  getRecipe(productId: string): Promise<ProductRecipe> {
    return this.http.get<ProductRecipe>(`products/${productId}/recipe`);
  }

  /** Replaced wholesale — send the complete list. */
  setRecipe(
    productId: string,
    ingredients: Array<{ stockItemId: string; quantity: number }>,
  ): Promise<ProductRecipe> {
    return this.http.patch<ProductRecipe>(`products/${productId}/recipe`, { ingredients });
  }
}
