import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type BranchMenu,
  type Category,
  type ModifierGroup,
  type Paginated,
  type Product,
} from '@restor/shared-types';
import {
  createCategorySchema,
  createModifierGroupSchema,
  createProductSchema,
  updateCategorySchema,
  updateModifierGroupSchema,
  updateProductAvailabilitySchema,
  updateProductSchema,
  type CreateCategoryInput,
  type CreateModifierGroupInput,
  type CreateProductInput,
  type UpdateModifierGroupInput,
  type UpdateProductInput,
} from '@restor/validation';
import { z } from 'zod';
import { Public, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { CategoriesService } from './categories.service';
import { MenuService } from './menu.service';
import { ModifiersService } from './modifiers.service';
import { ProductsService } from './products.service';

const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
    private readonly modifiers: ModifiersService,
    private readonly menu: MenuService,
  ) {}

  /* ---------------------------- Categories ---------------------------- */

  @Get('categories')
  @RequirePermissions(Permission.CATEGORIES_VIEW)
  listCategories(@Query('includeInactive') includeInactive?: string): Promise<Category[]> {
    return this.categories.list({ includeInactive: includeInactive === 'true' });
  }

  @Post('categories')
  @RequirePermissions(Permission.CATEGORIES_CREATE)
  createCategory(
    @Body(zodBody(createCategorySchema)) body: CreateCategoryInput,
  ): Promise<Category> {
    return this.categories.create(body);
  }

  @Patch('categories/:id')
  @RequirePermissions(Permission.CATEGORIES_UPDATE)
  updateCategory(
    @Param('id') id: string,
    @Body(zodBody(updateCategorySchema)) body: Partial<CreateCategoryInput> & { isActive?: boolean },
  ): Promise<Category> {
    return this.categories.update(id, body);
  }

  @Delete('categories/:id')
  @RequirePermissions(Permission.CATEGORIES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(@Param('id') id: string): Promise<void> {
    return this.categories.remove(id);
  }

  @Post('categories/reorder')
  @RequirePermissions(Permission.CATEGORIES_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  reorderCategories(@Body(zodBody(reorderSchema)) body: { ids: string[] }): Promise<void> {
    return this.categories.reorder(body.ids);
  }

  /* ----------------------------- Products ----------------------------- */

  @Get('products')
  @RequirePermissions(Permission.PRODUCTS_VIEW)
  listProducts(
    @Query()
    query: {
      page?: number;
      limit?: number;
      categoryId?: string;
      branchId?: string;
      isActive?: boolean;
      search?: string;
    },
  ): Promise<Paginated<Product>> {
    return this.products.list(query);
  }

  @Get('products/:id')
  @RequirePermissions(Permission.PRODUCTS_VIEW)
  getProduct(@Param('id') id: string): Promise<Product> {
    return this.products.get(id);
  }

  @Post('products')
  @RequirePermissions(Permission.PRODUCTS_CREATE)
  createProduct(@Body(zodBody(createProductSchema)) body: CreateProductInput): Promise<Product> {
    return this.products.create(body);
  }

  /**
   * A price change additionally requires `products.price.update`, so a shift
   * manager can fix a typo in a name without being able to reprice the menu.
   */
  @Patch('products/:id')
  @RequireAnyPermission(Permission.PRODUCTS_UPDATE, Permission.PRODUCTS_PRICE_UPDATE)
  updateProduct(
    @Param('id') id: string,
    @Body(zodBody(updateProductSchema)) body: UpdateProductInput,
  ): Promise<Product> {
    return this.products.update(id, body);
  }

  @Delete('products/:id')
  @RequirePermissions(Permission.PRODUCTS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(@Param('id') id: string): Promise<void> {
    return this.products.remove(id);
  }

  @Patch('products/:id/availability')
  @RequirePermissions(Permission.PRODUCTS_AVAILABILITY_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Toggle a product’s availability / stop-list at one branch' })
  setAvailability(
    @Param('id') id: string,
    @Body(zodBody(updateProductAvailabilitySchema))
    body: { branchId: string; isAvailable?: boolean; isStopListed?: boolean; priceOverride?: number | null },
  ): Promise<void> {
    return this.products.setAvailability(id, body);
  }

  /* ---------------------------- Modifiers ----------------------------- */

  @Get('modifier-groups')
  @RequirePermissions(Permission.MODIFIERS_VIEW)
  listModifierGroups(): Promise<ModifierGroup[]> {
    return this.modifiers.list();
  }

  @Post('modifier-groups')
  @RequirePermissions(Permission.MODIFIERS_MANAGE)
  createModifierGroup(
    @Body(zodBody(createModifierGroupSchema)) body: CreateModifierGroupInput,
  ): Promise<ModifierGroup> {
    return this.modifiers.create(body);
  }

  @Patch('modifier-groups/:id')
  @RequirePermissions(Permission.MODIFIERS_MANAGE)
  updateModifierGroup(
    @Param('id') id: string,
    @Body(zodBody(updateModifierGroupSchema)) body: UpdateModifierGroupInput,
  ): Promise<ModifierGroup> {
    return this.modifiers.update(id, body);
  }

  @Delete('modifier-groups/:id')
  @RequirePermissions(Permission.MODIFIERS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteModifierGroup(@Param('id') id: string): Promise<void> {
    return this.modifiers.remove(id);
  }

  /* ------------------------- Customer-facing -------------------------- */

  /**
   * Public menu for one branch.
   *
   * Still tenant-scoped through the branch, so this cannot be used to browse
   * another restaurant's catalog.
   */
  @Public()
  @Get('menu/:branchId')
  @ApiOperation({ summary: 'Customer menu for a branch, availability applied' })
  branchMenu(@Param('branchId') branchId: string): Promise<BranchMenu> {
    return this.menu.forBranch(branchId);
  }
}
