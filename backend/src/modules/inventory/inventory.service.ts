import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  DomainEvent,
  OrderStatus,
  StockMovementType,
  StockUnit,
  type Paginated,
  type ProductIngredient,
  type ProductRecipe,
  type StockBatch,
  type StockItem,
  type StockMovement,
  type StockSummary,
  type Supplier,
} from '@restor/shared-types';
import { normalizePagination, paginated } from '@restor/shared-utils';
import { AppException } from '../../common/errors/app-exception';
import { getContext, runUnscoped } from '../../common/context/request-context';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  consumptionFor,
  daysUntil,
  isLow,
  remainingByReceipt,
  roundQuantity,
  signedQuantity,
  type RecipeLine,
} from './stock.math';

const ITEM_INCLUDE = { branch: { select: { name: true } } } as const;

export const MOVEMENT_INCLUDE = {
  stockItem: { select: { name: true, unit: true } },
  supplier: { select: { name: true } },
  order: { select: { displayNumber: true } },
  createdBy: { select: { fullName: true } },
} as const;

/** How far back receipts are read when estimating what is left of a batch. */
const BATCH_LOOKBACK_MS = 365 * 86_400_000;

/**
 * Inventory (TZ §29-§31).
 *
 * Three decisions shape everything here.
 *
 * **Stock is per branch.** Flour in Chilonzor cannot be used by Yunusobod. One
 * pooled figure would let a branch sell a dish it has no ingredients for, which
 * is worse than no tracking at all.
 *
 * **The level is derived but also stored.** Every change writes an append-only
 * movement AND increments the running total, both in one transaction. Keeping
 * both means a level can always be explained, and a disagreement between the
 * ledger and the total is itself a finding rather than an invisible drift.
 *
 * **Deduction never blocks a sale.** Consumption is driven by the order-status
 * event, and a product with no recipe is simply not tracked. A kitchen that
 * cannot sell because the inventory module is unhappy is a worse outcome than
 * an inventory figure that needs a stock-take.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchScope: BranchScope,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Suppliers                                                          */
  /* ------------------------------------------------------------------ */

  async listSuppliers(): Promise<Supplier[]> {
    const rows = await this.prisma.db.supplier.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toSupplier);
  }

  async createSupplier(input: {
    name: string;
    phone?: string | null;
    contact?: string | null;
    comment?: string | null;
    telegramChatId?: string | null;
  }): Promise<Supplier> {
    const tenantId = this.requireTenant();

    const duplicate = await this.prisma.db.supplier.findFirst({
      where: { name: input.name, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) throw AppException.conflict(`"${input.name}" allaqachon mavjud`);

    const row = await this.prisma.db.supplier.create({
      data: {
        tenantId,
        name: input.name,
        phone: input.phone ?? null,
        contact: input.contact ?? null,
        comment: input.comment ?? null,
        telegramChatId: input.telegramChatId ?? null,
      },
    });

    await this.audit.record({
      action: 'SUPPLIER_CREATED',
      entity: 'Supplier',
      entityId: row.id,
      newValue: { name: input.name },
    });

    return toSupplier(row);
  }

  async updateSupplier(
    id: string,
    input: {
      name?: string;
      phone?: string | null;
      contact?: string | null;
      comment?: string | null;
      telegramChatId?: string | null;
      isActive?: boolean;
    },
  ): Promise<Supplier> {
    const existing = await this.prisma.db.supplier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw AppException.notFound('Supplier');

    const row = await this.prisma.db.supplier.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.contact !== undefined ? { contact: input.contact ?? null } : {}),
        ...(input.comment !== undefined ? { comment: input.comment ?? null } : {}),
        ...(input.telegramChatId !== undefined ? { telegramChatId: input.telegramChatId ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return toSupplier(row);
  }

  /* ------------------------------------------------------------------ */
  /* Stock items                                                        */
  /* ------------------------------------------------------------------ */

  async listItems(query: {
    branchId?: string;
    lowOnly?: boolean;
    search?: string;
  }): Promise<StockItem[]> {
    const rows = await this.prisma.db.stockItem.findMany({
      where: {
        deletedAt: null,
        branchId: this.branchScope.filterFor(query.branchId),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { sku: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: ITEM_INCLUDE,
      orderBy: { name: 'asc' },
    });

    const items = rows.map(toItem);
    // Filtered here rather than in SQL: "low" is a comparison between two
    // columns, which Prisma cannot express in a `where`.
    return query.lowOnly ? items.filter((item) => item.isLow) : items;
  }

  async getItem(id: string): Promise<StockItem> {
    const row = await this.prisma.db.stockItem.findFirst({
      where: { id, deletedAt: null },
      include: ITEM_INCLUDE,
    });
    if (!row) throw AppException.notFound('StockItem');
    this.branchScope.assertCanAccess(row.branchId);
    return toItem(row);
  }

  async createItem(input: {
    branchId: string;
    name: string;
    unit: StockUnit;
    category?: string | null;
    sku?: string | null;
    quantity?: number;
    minQuantity?: number | null;
    costPerUnit?: number;
  }): Promise<StockItem> {
    this.branchScope.assertCanAccess(input.branchId);
    const tenantId = this.requireTenant();

    const duplicate = await this.prisma.db.stockItem.findFirst({
      where: { branchId: input.branchId, name: input.name, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.conflict(`"${input.name}" bu filialda allaqachon bor`);
    }

    const opening = roundQuantity(input.quantity ?? 0);

    const row = await this.prisma.transaction(async (tx) => {
      const created = await tx.stockItem.create({
        data: {
          tenantId,
          branchId: input.branchId,
          name: input.name,
          unit: input.unit,
          category: input.category || null,
          sku: input.sku || null,
          quantity: new Prisma.Decimal(opening),
          minQuantity:
            input.minQuantity != null
              ? new Prisma.Decimal(roundQuantity(input.minQuantity))
              : null,
          costPerUnit: input.costPerUnit ?? 0,
        },
        include: ITEM_INCLUDE,
      });

      // An opening balance is a movement like any other, so the ledger
      // explains the level from the very first row rather than starting at an
      // unexplained number.
      if (opening !== 0) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            stockItemId: created.id,
            type: StockMovementType.ADJUSTMENT,
            quantity: new Prisma.Decimal(opening),
            comment: 'Boshlangʻich qoldiq',
            createdByUserId: getContext()?.userId ?? null,
          },
        });
      }

      return created;
    });

    await this.audit.record({
      action: 'STOCK_ITEM_CREATED',
      entity: 'StockItem',
      entityId: row.id,
      newValue: { name: input.name, unit: input.unit, quantity: opening },
    });

    return toItem(row);
  }

  async updateItem(
    id: string,
    input: {
      name?: string;
      unit?: StockUnit;
      category?: string | null;
      sku?: string | null;
      minQuantity?: number | null;
      costPerUnit?: number;
      isActive?: boolean;
    },
  ): Promise<StockItem> {
    await this.getItem(id);

    const row = await this.prisma.db.stockItem.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.category !== undefined ? { category: input.category || null } : {}),
        ...(input.sku !== undefined ? { sku: input.sku || null } : {}),
        ...(input.minQuantity !== undefined
          ? {
              minQuantity:
                input.minQuantity != null
                  ? new Prisma.Decimal(roundQuantity(input.minQuantity))
                  : null,
            }
          : {}),
        ...(input.costPerUnit !== undefined ? { costPerUnit: input.costPerUnit } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: ITEM_INCLUDE,
    });

    return toItem(row);
  }

  /**
   * Note what this does NOT accept: a quantity.
   *
   * A level can only move through a movement, so there is no path that changes
   * a figure without leaving a row explaining why. Correcting a level is an
   * ADJUSTMENT with a reason, which is the honest way to say "the shelf
   * disagreed with the books".
   */
  async removeItem(id: string): Promise<void> {
    const item = await this.getItem(id);

    await this.prisma.db.stockItem.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      action: 'STOCK_ITEM_DELETED',
      entity: 'StockItem',
      entityId: id,
      oldValue: { name: item.name, quantity: item.quantity },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Movements                                                          */
  /* ------------------------------------------------------------------ */

  async listMovements(query: {
    stockItemId?: string;
    branchId?: string;
    type?: StockMovementType;
    page?: number;
    limit?: number;
  }): Promise<Paginated<StockMovement>> {
    const page = normalizePagination(query);
    const branchFilter = this.branchScope.filterFor(query.branchId);

    const where = {
      ...(query.stockItemId ? { stockItemId: query.stockItemId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(branchFilter ? { stockItem: { branchId: branchFilter } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.stockMovement.findMany({
        where,
        include: MOVEMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.stockMovement.count({ where }),
    ]);

    return paginated(rows.map(toMovement), total, page);
  }

  /**
   * Records a movement and moves the level in one transaction.
   *
   * The increment happens in SQL rather than by reading the level, adding, and
   * writing it back: two deliveries arriving at the same moment would
   * otherwise each read the same starting figure and one would be lost.
   */
  async addMovement(input: {
    stockItemId: string;
    type: StockMovementType;
    quantity: number;
    costPerUnit?: number;
    supplierId?: string;
    comment?: string;
    expiresAt?: string | null;
    batchCode?: string | null;
  }): Promise<StockMovement> {
    const item = await this.getItem(input.stockItemId);

    const signed = roundQuantity(signedQuantity(input.type, input.quantity));
    if (signed === 0) {
      throw AppException.badRequest('Miqdor noldan farq qilishi kerak');
    }
    const isReceipt = input.type === StockMovementType.RECEIPT;

    const row = await this.prisma.transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: {
          tenantId: item.tenantId,
          stockItemId: item.id,
          type: input.type,
          quantity: new Prisma.Decimal(signed),
          costPerUnit: isReceipt ? (input.costPerUnit ?? null) : null,
          supplierId: input.supplierId ?? null,
          comment: input.comment ?? null,
          // A use-by date belongs to a delivery; on anything else it would
          // describe nothing.
          expiresAt: isReceipt && input.expiresAt ? new Date(input.expiresAt) : null,
          batchCode: isReceipt ? input.batchCode || null : null,
          createdByUserId: getContext()?.userId ?? null,
        },
        include: MOVEMENT_INCLUDE,
      });

      await tx.stockItem.update({
        where: { id: item.id },
        data: {
          quantity: { increment: new Prisma.Decimal(signed) },
          // A delivery is the freshest price information there is, so it
          // becomes the cost used for valuation and margins.
          ...(input.type === StockMovementType.RECEIPT && input.costPerUnit
            ? { costPerUnit: input.costPerUnit }
            : {}),
        },
      });

      return movement;
    });

    await this.audit.record({
      action: 'STOCK_MOVEMENT_CREATED',
      entity: 'StockMovement',
      entityId: row.id,
      newValue: { item: item.name, type: input.type, quantity: signed },
    });

    return toMovement(row);
  }

  /* ------------------------------------------------------------------ */
  /* Recipes                                                            */
  /* ------------------------------------------------------------------ */

  async getRecipe(productId: string): Promise<ProductRecipe> {
    const product = await this.prisma.db.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, name: true, price: true },
    });
    if (!product) throw AppException.notFound('Product');

    // Loaded through the scoped Product rather than queried directly:
    // `product_ingredients` has no tenantId of its own.
    const rows = await this.prisma.db.productIngredient.findMany({
      where: { productId },
      include: { stockItem: { select: { name: true, unit: true, costPerUnit: true } } },
    });

    const ingredients: ProductIngredient[] = rows.map((row) => {
      const quantity = row.quantity.toNumber();
      return {
        id: row.id,
        productId: row.productId,
        stockItemId: row.stockItemId,
        stockItemName: row.stockItem.name,
        unit: row.stockItem.unit as StockUnit,
        quantity: row.quantity.toFixed(3),
        cost: Math.round(quantity * row.stockItem.costPerUnit),
      };
    });

    const totalCost = ingredients.reduce((sum, line) => sum + line.cost, 0);

    return {
      productId: product.id,
      productName: product.name,
      price: product.price,
      ingredients,
      totalCost,
      margin: product.price - totalCost,
      marginPercent:
        product.price > 0
          ? Math.round(((product.price - totalCost) / product.price) * 1000) / 10
          : null,
    };
  }

  /**
   * Replaces a product's recipe wholesale.
   *
   * The editor always submits the complete list, so a diff would be more code
   * for the same result — and a partial update would leave an ingredient the
   * user deleted silently consuming stock.
   */
  async setRecipe(
    productId: string,
    lines: Array<{ stockItemId: string; quantity: number }>,
  ): Promise<ProductRecipe> {
    const product = await this.prisma.db.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw AppException.notFound('Product');

    // Every stock item must be this tenant's. The join table has no tenantId,
    // so nothing downstream would catch a foreign id — it would just sit there
    // deducting from another restaurant's shelf.
    if (lines.length > 0) {
      const found = await this.prisma.db.stockItem.count({
        where: { id: { in: lines.map((line) => line.stockItemId) }, deletedAt: null },
      });
      if (found !== new Set(lines.map((line) => line.stockItemId)).size) {
        throw AppException.badRequest('Ombor mahsulotlaridan biri topilmadi');
      }
    }

    await this.prisma.transaction(async (tx) => {
      await tx.productIngredient.deleteMany({ where: { productId } });
      if (lines.length > 0) {
        await tx.productIngredient.createMany({
          data: lines.map((line) => ({
            productId,
            stockItemId: line.stockItemId,
            quantity: new Prisma.Decimal(roundQuantity(line.quantity)),
          })),
        });
      }
    });

    await this.audit.record({
      action: 'PRODUCT_RECIPE_UPDATED',
      entity: 'Product',
      entityId: productId,
      newValue: { ingredients: lines.length },
    });

    return this.getRecipe(productId);
  }

  /* ------------------------------------------------------------------ */
  /* Summary                                                            */
  /* ------------------------------------------------------------------ */

  async summary(branchId?: string, days = 30): Promise<StockSummary> {
    const since = new Date(Date.now() - days * 86_400_000);
    const branchFilter = this.branchScope.filterFor(branchId);

    const [items, outflow, batches] = await Promise.all([
      this.listItems({ branchId }),
      this.prisma.db.stockMovement.findMany({
        where: {
          type: { in: [StockMovementType.WASTE, StockMovementType.CONSUMPTION] },
          createdAt: { gte: since },
          ...(branchFilter ? { stockItem: { branchId: branchFilter } } : {}),
        },
        select: { type: true, quantity: true, stockItem: { select: { costPerUnit: true } } },
      }),
      this.listBatches({ branchId }),
    ]);

    const lowItems = items
      .filter((item) => item.isLow)
      .sort((a, b) => Number(a.quantity) - Number(b.quantity));

    // Both are stored negative, so their absolute value is what left the shelf.
    const valueOf = (type: StockMovementType) =>
      outflow
        .filter((row) => row.type === type)
        .reduce((sum, row) => sum + Math.round(Math.abs(row.quantity.toNumber()) * row.stockItem.costPerUnit), 0);

    return {
      branchId: branchId ?? null,
      itemsCount: items.length,
      lowCount: lowItems.length,
      totalValue: items.reduce((sum, item) => sum + item.stockValue, 0),
      lowItems,
      wasteValue: valueOf(StockMovementType.WASTE),
      consumptionValue: valueOf(StockMovementType.CONSUMPTION),
      expiredBatches: batches.filter((b) => b.daysLeft < 0).length,
      expiringBatches: batches.filter((b) => b.daysLeft >= 0 && b.daysLeft <= 3).length,
    };
  }

  /**
   * Received batches with a use-by date and stock estimated left, soonest
   * first. See `remainingByReceipt` for why "left" is an estimate.
   */
  async listBatches(query: { branchId?: string; stockItemId?: string }): Promise<StockBatch[]> {
    const branchFilter = this.branchScope.filterFor(query.branchId);
    const since = new Date(Date.now() - BATCH_LOOKBACK_MS);

    // Only items that have ever had a dated receipt need the FIFO walk.
    const dated = await this.prisma.db.stockMovement.findMany({
      where: {
        type: StockMovementType.RECEIPT,
        expiresAt: { not: null },
        createdAt: { gte: since },
        ...(query.stockItemId ? { stockItemId: query.stockItemId } : {}),
        stockItem: { deletedAt: null, ...(branchFilter ? { branchId: branchFilter } : {}) },
      },
      select: { stockItemId: true },
      distinct: ['stockItemId'],
    });
    if (dated.length === 0) return [];

    const itemIds = dated.map((row) => row.stockItemId);
    const [items, receipts] = await Promise.all([
      this.prisma.db.stockItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, name: true, unit: true, branchId: true, quantity: true, costPerUnit: true },
      }),
      this.prisma.db.stockMovement.findMany({
        where: { stockItemId: { in: itemIds }, type: StockMovementType.RECEIPT, createdAt: { gte: since } },
        select: {
          id: true,
          stockItemId: true,
          quantity: true,
          costPerUnit: true,
          expiresAt: true,
          batchCode: true,
          createdAt: true,
          supplier: { select: { name: true } },
        },
      }),
    ]);

    const now = new Date();
    const batches: StockBatch[] = [];
    for (const item of items) {
      const own = receipts.filter((r) => r.stockItemId === item.id);
      const left = remainingByReceipt(
        item.quantity.toNumber(),
        own.map((r) => ({ id: r.id, quantity: r.quantity.toNumber(), receivedAt: r.createdAt })),
      );
      for (const receipt of own) {
        const remaining = left.get(receipt.id) ?? 0;
        if (!receipt.expiresAt || remaining <= 0) continue;
        batches.push({
          movementId: receipt.id,
          stockItemId: item.id,
          stockItemName: item.name,
          unit: item.unit as StockUnit,
          branchId: item.branchId,
          supplierName: receipt.supplier?.name ?? null,
          batchCode: receipt.batchCode,
          receivedAt: receipt.createdAt.toISOString(),
          expiresAt: receipt.expiresAt.toISOString(),
          received: receipt.quantity.toFixed(3),
          remaining: remaining.toFixed(3),
          value: Math.round(remaining * (receipt.costPerUnit ?? item.costPerUnit)),
          daysLeft: daysUntil(receipt.expiresAt, now),
        });
      }
    }

    return batches.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  }

  /* ------------------------------------------------------------------ */
  /* Automatic consumption                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Deducts a completed order's ingredients.
   *
   * Driven by the event rather than called from the order path, and every
   * failure is swallowed with a warning. That is deliberate: a kitchen that
   * cannot complete a sale because the inventory module is unhappy is a worse
   * outcome than a stock figure that needs a stock-take.
   */
  @OnEvent(DomainEvent.ORDER_STATUS_CHANGED, { async: true })
  async onOrderStatusChanged(event: {
    tenantId: string;
    orderId: string;
    toStatus: OrderStatus;
  }): Promise<void> {
    if (event.toStatus !== OrderStatus.DELIVERED) return;

    try {
      await runUnscoped(() => this.consumeForOrder(event.tenantId, event.orderId));
    } catch (error) {
      this.logger.warn(
        { orderId: event.orderId, error: String(error) },
        'Could not deduct stock for an order',
      );
    }
  }

  private async consumeForOrder(tenantId: string, orderId: string): Promise<void> {
    // Idempotent: a replayed event finds the deductions already recorded and
    // stops rather than taking the ingredients twice.
    const already = await this.prisma.db.stockMovement.count({ where: { orderId } });
    if (already > 0) return;

    const order = await this.prisma.db.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        branchId: true,
        displayNumber: true,
        items: { select: { productId: true, quantity: true } },
      },
    });
    if (!order) return;

    const productIds = order.items
      .map((item) => item.productId)
      .filter((id): id is string => Boolean(id));
    if (productIds.length === 0) return;

    const ingredients = await this.prisma.db.productIngredient.findMany({
      where: {
        productId: { in: productIds },
        // Only this branch's shelf: a recipe points at an item, and the item
        // belongs to one branch.
        stockItem: { branchId: order.branchId, deletedAt: null },
      },
      select: { productId: true, stockItemId: true, quantity: true },
    });
    if (ingredients.length === 0) return;

    const recipes = new Map<string, RecipeLine[]>();
    for (const row of ingredients) {
      const lines = recipes.get(row.productId) ?? [];
      lines.push({ stockItemId: row.stockItemId, quantity: row.quantity.toNumber() });
      recipes.set(row.productId, lines);
    }

    const totals = consumptionFor(
      order.items
        .filter((item): item is { productId: string; quantity: number } =>
          Boolean(item.productId),
        )
        .map((item) => ({ productId: item.productId, quantity: item.quantity })),
      recipes,
    );
    if (totals.size === 0) return;

    await this.prisma.transaction(async (tx) => {
      for (const [stockItemId, quantity] of totals) {
        const amount = roundQuantity(quantity);
        if (amount <= 0) continue;

        await tx.stockMovement.create({
          data: {
            tenantId,
            stockItemId,
            type: StockMovementType.CONSUMPTION,
            quantity: new Prisma.Decimal(-amount),
            orderId: order.id,
            comment: order.displayNumber,
          },
        });

        // Allowed to go negative. A level below zero is wrong but real — a
        // missed delivery, an unrecorded waste — and clamping it to zero would
        // hide exactly the discrepancy a stock-take needs to find.
        await tx.stockItem.update({
          where: { id: stockItemId },
          data: { quantity: { decrement: new Prisma.Decimal(amount) } },
        });
      }
    });

    this.logger.log(
      { orderId: order.id, items: totals.size },
      'Stock deducted for a completed order',
    );
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');
    return tenantId;
  }
}

/* -------------------------------------------------------------------------- */

function toSupplier(row: {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  contact: string | null;
  comment: string | null;
  telegramChatId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Supplier {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    phone: row.phone,
    contact: row.contact,
    comment: row.comment,
    telegramChatId: row.telegramChatId,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toItem(row: {
  id: string;
  tenantId: string;
  branchId: string;
  branch?: { name: string };
  name: string;
  unit: string;
  category: string | null;
  sku: string | null;
  quantity: Prisma.Decimal;
  minQuantity: Prisma.Decimal | null;
  costPerUnit: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): StockItem {
  const quantity = row.quantity.toNumber();
  const minQuantity = row.minQuantity?.toNumber() ?? null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    ...(row.branch ? { branchName: row.branch.name } : {}),
    name: row.name,
    unit: row.unit as StockUnit,
    category: row.category,
    sku: row.sku,
    // Strings on the wire: these are NUMERIC in Postgres, and routing them
    // through a JSON number reintroduces the float drift the column avoids.
    quantity: row.quantity.toFixed(3),
    minQuantity: row.minQuantity?.toFixed(3) ?? null,
    costPerUnit: row.costPerUnit,
    isLow: isLow(quantity, minQuantity),
    stockValue: Math.round(quantity * row.costPerUnit),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMovement(row: {
  id: string;
  tenantId: string;
  stockItemId: string;
  stockItem?: { name: string; unit: string };
  type: string;
  quantity: Prisma.Decimal;
  costPerUnit: number | null;
  supplierId: string | null;
  supplier?: { name: string } | null;
  orderId: string | null;
  order?: { displayNumber: string } | null;
  comment: string | null;
  expiresAt: Date | null;
  batchCode: string | null;
  supplierOrderId: string | null;
  createdByUserId: string | null;
  createdBy?: { fullName: string } | null;
  createdAt: Date;
}): StockMovement {
  return {
    id: row.id,
    tenantId: row.tenantId,
    stockItemId: row.stockItemId,
    ...(row.stockItem
      ? { stockItemName: row.stockItem.name, unit: row.stockItem.unit as StockUnit }
      : {}),
    type: row.type as StockMovementType,
    quantity: row.quantity.toFixed(3),
    costPerUnit: row.costPerUnit,
    supplierId: row.supplierId,
    supplierName: row.supplier?.name ?? null,
    orderId: row.orderId,
    orderNumber: row.order?.displayNumber ?? null,
    comment: row.comment,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    batchCode: row.batchCode,
    supplierOrderId: row.supplierOrderId,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
    // A ledger row is never edited; the field exists only for BaseEntity.
    updatedAt: row.createdAt.toISOString(),
  };
}
