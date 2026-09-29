import type {
  BranchMenu,
  Category,
  CreateCategoryRequest,
  CreateModifierGroupRequest,
  CreateProductRequest,
  ModifierGroup,
  Paginated,
  PaginationQuery,
  Product,
  UpdateCategoryRequest,
  UpdateProductRequest,
  UploadResult,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

export class CatalogResource {
  constructor(private readonly http: HttpClient) {}

  /* --- Categories --- */

  listCategories(query?: { includeInactive?: boolean }): Promise<Category[]> {
    return this.http.get<Category[]>('categories', { query });
  }

  createCategory(payload: CreateCategoryRequest): Promise<Category> {
    return this.http.post<Category>('categories', payload);
  }

  updateCategory(id: string, payload: UpdateCategoryRequest): Promise<Category> {
    return this.http.patch<Category>(`categories/${id}`, payload);
  }

  deleteCategory(id: string): Promise<void> {
    return this.http.delete<void>(`categories/${id}`);
  }

  reorderCategories(ids: string[]): Promise<void> {
    return this.http.post<void>('categories/reorder', { ids });
  }

  /* --- Products --- */

  listProducts(
    query?: PaginationQuery & { categoryId?: string; branchId?: string; isActive?: boolean },
  ): Promise<Paginated<Product>> {
    return this.http.getPaginated<Product>('products', { query });
  }

  getProduct(id: string): Promise<Product> {
    return this.http.get<Product>(`products/${id}`);
  }

  createProduct(payload: CreateProductRequest): Promise<Product> {
    return this.http.post<Product>('products', payload);
  }

  updateProduct(id: string, payload: UpdateProductRequest): Promise<Product> {
    return this.http.patch<Product>(`products/${id}`, payload);
  }

  deleteProduct(id: string): Promise<void> {
    return this.http.delete<void>(`products/${id}`);
  }

  /** Stop-list toggle the floor staff uses when something runs out. */
  setAvailability(
    productId: string,
    payload: { branchId: string; isAvailable?: boolean; isStopListed?: boolean; priceOverride?: number | null },
  ): Promise<void> {
    return this.http.patch<void>(`products/${productId}/availability`, payload);
  }

  /** Uploads a product image; returns the stored URL to put on the product. */
  uploadImage(file: File | Blob, fileName = 'image.jpg'): Promise<UploadResult> {
    const form = new FormData();
    form.append('file', file, fileName);
    return this.http.upload<UploadResult>('files/images', form);
  }

  /* --- Modifiers --- */

  listModifierGroups(): Promise<ModifierGroup[]> {
    return this.http.get<ModifierGroup[]>('modifier-groups');
  }

  createModifierGroup(payload: CreateModifierGroupRequest): Promise<ModifierGroup> {
    return this.http.post<ModifierGroup>('modifier-groups', payload);
  }

  updateModifierGroup(
    id: string,
    payload: Partial<CreateModifierGroupRequest>,
  ): Promise<ModifierGroup> {
    return this.http.patch<ModifierGroup>(`modifier-groups/${id}`, payload);
  }

  deleteModifierGroup(id: string): Promise<void> {
    return this.http.delete<void>(`modifier-groups/${id}`);
  }

  /**
   * The full menu for one branch, availability already applied.
   * Public: no token needed, the tenant comes from the slug.
   */
  branchMenu(branchId: string): Promise<BranchMenu> {
    return this.http.get<BranchMenu>(`menu/${branchId}`, { skipAuth: true });
  }
}
