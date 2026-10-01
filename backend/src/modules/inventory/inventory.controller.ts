import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type Paginated,
  type ProductRecipe,
  type StockItem,
  type StockMovement,
  type StockMovementType,
  type StockSummary,
  type Supplier,
} from '@restor/shared-types';
import {
  createStockItemSchema,
  createSupplierSchema,
  setRecipeSchema,
  stockMovementSchema,
  updateStockItemSchema,
  updateSupplierSchema,
  type CreateStockItemInput,
  type CreateSupplierInput,
  type SetRecipeInput,
  type StockMovementInput,
  type UpdateStockItemInput,
  type UpdateSupplierInput,
} from '@restor/validation';
import { RequirePermissions } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { InventoryService } from './inventory.service';

/** Inventory (TZ §29-§31). */
@ApiTags('inventory')
@Controller()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /* ------------------------------ Suppliers ------------------------- */

  @Get('suppliers')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  listSuppliers(): Promise<Supplier[]> {
    return this.inventory.listSuppliers();
  }

  @Post('suppliers')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  createSupplier(
    @Body(zodBody(createSupplierSchema)) body: CreateSupplierInput,
  ): Promise<Supplier> {
    return this.inventory.createSupplier(body);
  }

  @Patch('suppliers/:id')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  updateSupplier(
    @Param('id') id: string,
    @Body(zodBody(updateSupplierSchema)) body: UpdateSupplierInput,
  ): Promise<Supplier> {
    return this.inventory.updateSupplier(id, body);
  }

  /* ------------------------------- Stock ---------------------------- */

  /** Headline figures: what is low, and what the shelves are worth. */
  @Get('stock/summary')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: 'Low items, shelf value and recent waste' })
  summary(
    @Query('branchId') branchId?: string,
    @Query('days') days?: string,
  ): Promise<StockSummary> {
    return this.inventory.summary(branchId, days ? Number(days) : 30);
  }

  /** Declared before `stock/items/:id` so the literal path is not swallowed. */
  @Get('stock/movements')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  listMovements(
    @Query()
    query: {
      stockItemId?: string;
      branchId?: string;
      type?: StockMovementType;
      page?: number;
      limit?: number;
    },
  ): Promise<Paginated<StockMovement>> {
    return this.inventory.listMovements(query);
  }

  @Get('stock/items')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  listItems(
    @Query() query: { branchId?: string; lowOnly?: string; search?: string },
  ): Promise<StockItem[]> {
    return this.inventory.listItems({
      branchId: query.branchId,
      search: query.search,
      lowOnly: query.lowOnly === 'true',
    });
  }

  @Get('stock/items/:id')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  getItem(@Param('id') id: string): Promise<StockItem> {
    return this.inventory.getItem(id);
  }

  @Post('stock/items')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Add a tracked item to one branch' })
  createItem(
    @Body(zodBody(createStockItemSchema)) body: CreateStockItemInput,
  ): Promise<StockItem> {
    return this.inventory.createItem(body);
  }

  /**
   * Note what cannot be patched: the quantity.
   *
   * A level moves only through a movement, so there is no path that changes a
   * figure without leaving a row explaining why. Correcting one is an
   * ADJUSTMENT with a reason.
   */
  @Patch('stock/items/:id')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  updateItem(
    @Param('id') id: string,
    @Body(zodBody(updateStockItemSchema)) body: UpdateStockItemInput,
  ): Promise<StockItem> {
    return this.inventory.updateItem(id, body);
  }

  @Delete('stock/items/:id')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(@Param('id') id: string): Promise<void> {
    return this.inventory.removeItem(id);
  }

  /** Receipt, waste, adjustment or transfer. Consumption is automatic. */
  @Post('stock/movements')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Record a stock movement and move the level' })
  addMovement(
    @Body(zodBody(stockMovementSchema)) body: StockMovementInput,
  ): Promise<StockMovement> {
    return this.inventory.addMovement(body);
  }

  /* ------------------------------ Recipes --------------------------- */

  @Get('products/:id/recipe')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  @ApiOperation({ summary: 'A dish’s ingredients, cost and margin' })
  getRecipe(@Param('id') productId: string): Promise<ProductRecipe> {
    return this.inventory.getRecipe(productId);
  }

  /** Replaced wholesale — the editor always submits the complete list. */
  @Patch('products/:id/recipe')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  setRecipe(
    @Param('id') productId: string,
    @Body(zodBody(setRecipeSchema)) body: SetRecipeInput,
  ): Promise<ProductRecipe> {
    return this.inventory.setRecipe(productId, body.ingredients);
  }
}
