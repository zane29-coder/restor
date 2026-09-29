import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  type Paginated,
  type Product,
} from '@restor/shared-types';
import { normalizePagination, paginated, uniqueSlug } from '@restor/shared-utils';
import type { CreateProductInput, UpdateProductInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
  modifierGroups: {
    include: {
      modifierGroup: {
        include: { modifiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      },
    },
    orderBy: { sortOrder: 'asc' },
  },
  branchSettings: true,
} as const;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchScope: BranchScope,
  ) {}

  async list(query: {
    page?: number;
    limit?: number;
    categoryId?: string;
    branchId?: string;
    isActive?: boolean;
    search?: string;
  }): Promise<Paginated<Product>> {
    const page = normalizePagination(query);

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.branchId
        ? { branchSettings: { some: { branchId: query.branchId, isAvailable: true } } }
        : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.product.count({ where }),
    ]);

    return paginated(rows.map(toProduct), total, page);
  }

  async get(id: string): Promise<Product> {
    const row = await this.findRow(id);
    return toProduct(row);
  }

  async create(input: CreateProductInput): Promise<Product> {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) {
      throw AppException.badRequest('A product belongs to a restaurant; none is in scope');
    }

    await this.assertCategoryExists(input.categoryId);
    if (input.modifierGroupIds?.length) {
      await this.assertModifierGroupsExist(input.modifierGroupIds);
    }

    const slug = await this.nextSlug(input.name);

    // Default to "available at every branch" when none are named, which is
    // what an admin almost always means on a single-branch tenant.
    const branchIds = input.branchIds?.length
      ? input.branchIds
      : (await this.prisma.db.branch.findMany({
          where: { deletedAt: null },
          select: { id: true },
        })).map((row) => row.id);

    const row = await this.prisma.db.product.create({
      data: {
        tenantId,
        categoryId: input.categoryId,
        name: input.name,
        slug,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        price: input.price,
        discountPrice: input.discountPrice ?? null,
        preparationTime: input.preparationTime,
        sortOrder: input.sortOrder,
        variants: input.variants?.length
          ? {
              create: input.variants.map((variant) => ({
                name: variant.name,
                priceDelta: variant.priceDelta,
                sku: variant.sku ?? null,
                isDefault: variant.isDefault,
                sortOrder: variant.sortOrder,
              })),
            }
          : undefined,
        modifierGroups: input.modifierGroupIds?.length
          ? {
              create: input.modifierGroupIds.map((modifierGroupId, index) => ({
                modifierGroupId,
                sortOrder: index,
              })),
            }
          : undefined,
        branchSettings: {
          create: branchIds.map((branchId) => ({ branchId, isAvailable: true })),
        },
      },
      include: PRODUCT_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.PRODUCT_CREATED,
      entity: 'Product',
      entityId: row.id,
      newValue: { name: row.name, price: row.price, categoryId: row.categoryId },
    });

    return toProduct(row);
  }

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    const before = await this.findRow(id);

    if (input.categoryId) await this.assertCategoryExists(input.categoryId);
    if (input.modifierGroupIds) await this.assertModifierGroupsExist(input.modifierGroupIds);

    // A discount must stay below the price it discounts, checked against the
    // values that will actually be stored rather than only what was sent.
    const nextPrice = input.price ?? before.price;
    const nextDiscount = input.discountPrice !== undefined ? input.discountPrice : before.discountPrice;
    if (nextDiscount !== null && nextDiscount !== undefined && nextDiscount >= nextPrice) {
      throw AppException.validation('Discount price must be lower than the regular price', {
        discountPrice: ['Must be lower than the price'],
      });
    }

    const row = await this.prisma.transaction(async (tx) => {
      if (input.modifierGroupIds) {
        await tx.productModifierGroup.deleteMany({ where: { productId: id } });
        await tx.productModifierGroup.createMany({
          data: input.modifierGroupIds.map((modifierGroupId, index) => ({
            productId: id,
            modifierGroupId,
            sortOrder: index,
          })),
        });
      }

      return tx.product.update({
        where: { id },
        data: {
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
          ...(input.price !== undefined ? { price: input.price } : {}),
          ...(input.discountPrice !== undefined ? { discountPrice: input.discountPrice } : {}),
          ...(input.preparationTime !== undefined
            ? { preparationTime: input.preparationTime }
            : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        include: PRODUCT_INCLUDE,
      });
    });

    // Price changes get their own audit action: they are the single most
    // sensitive edit in the menu (TZ §37).
    if (input.price !== undefined && input.price !== before.price) {
      await this.audit.record({
        action: AuditAction.PRICE_CHANGED,
        entity: 'Product',
        entityId: id,
        oldValue: { price: before.price },
        newValue: { price: input.price },
      });
    }

    await this.audit.recordChange(
      'PRODUCT_UPDATED',
      'Product',
      id,
      { name: before.name, isActive: before.isActive, categoryId: before.categoryId },
      { name: row.name, isActive: row.isActive, categoryId: row.categoryId },
    );

    return toProduct(row);
  }

  /**
   * Soft-deletes a product.
   *
   * Order items snapshot the name and price, so history survives — but the row
   * itself stays because `order_items.product_id` still points at it.
   */
  async remove(id: string): Promise<void> {
    const product = await this.findRow(id);

    await this.prisma.db.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      action: AuditAction.PRODUCT_DELETED,
      entity: 'Product',
      entityId: id,
      oldValue: { name: product.name },
    });
  }

  /**
   * Per-branch availability and stop-list (TZ §9).
   *
   * This is what the floor staff hits when something runs out mid-service, so
   * it is a single cheap upsert rather than a full product update.
   */
  async setAvailability(
    productId: string,
    input: {
      branchId: string;
      isAvailable?: boolean;
      isStopListed?: boolean;
      priceOverride?: number | null;
    },
  ): Promise<void> {
    this.branchScope.assertCanAccess(input.branchId);
    await this.findRow(productId);

    await this.prisma.db.productBranch.upsert({
      where: { productId_branchId: { productId, branchId: input.branchId } },
      create: {
        productId,
        branchId: input.branchId,
        isAvailable: input.isAvailable ?? true,
        isStopListed: input.isStopListed ?? false,
        priceOverride: input.priceOverride ?? null,
      },
      update: {
        ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
        ...(input.isStopListed !== undefined ? { isStopListed: input.isStopListed } : {}),
        ...(input.priceOverride !== undefined ? { priceOverride: input.priceOverride } : {}),
      },
    });

    await this.audit.record({
      action: 'PRODUCT_AVAILABILITY_CHANGED',
      entity: 'Product',
      entityId: productId,
      newValue: input as unknown as Record<string, unknown>,
    });
  }

  private async findRow(id: string): Promise<ProductRow> {
    const row = await this.prisma.db.product.findFirst({
      where: { id, deletedAt: null },
      include: PRODUCT_INCLUDE,
    });
    if (!row) throw AppException.notFound('Product', ErrorCode.PRODUCT_NOT_FOUND);
    return row;
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const found = await this.prisma.db.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw AppException.notFound('Category', ErrorCode.CATEGORY_NOT_FOUND);
  }

  private async assertModifierGroupsExist(ids: string[]): Promise<void> {
    const found = await this.prisma.db.modifierGroup.count({
      where: { id: { in: ids }, deletedAt: null },
    });
    if (found !== new Set(ids).size) {
      throw AppException.notFound('Modifier group', ErrorCode.MODIFIER_NOT_FOUND);
    }
  }

  private async nextSlug(name: string): Promise<string> {
    const existing = await this.prisma.db.product.findMany({ select: { slug: true } });
    return uniqueSlug(name, new Set(existing.map((row) => row.slug)));
  }
}

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    tenantId: row.tenantId,
    categoryId: row.categoryId,
    category: row.category,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imageUrl: row.imageUrl,
    price: row.price,
    discountPrice: row.discountPrice,
    preparationTime: row.preparationTime,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    variants: row.variants.map((variant) => ({
      id: variant.id,
      productId: variant.productId,
      name: variant.name,
      sku: variant.sku,
      priceDelta: variant.priceDelta,
      isDefault: variant.isDefault,
      sortOrder: variant.sortOrder,
      isActive: variant.isActive,
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
    })),
    modifierGroups: row.modifierGroups.map((link) => ({
      id: link.modifierGroup.id,
      tenantId: link.modifierGroup.tenantId,
      name: link.modifierGroup.name,
      minSelect: link.modifierGroup.minSelect,
      maxSelect: link.modifierGroup.maxSelect,
      sortOrder: link.modifierGroup.sortOrder,
      isActive: link.modifierGroup.isActive,
      modifiers: link.modifierGroup.modifiers.map((modifier) => ({
        id: modifier.id,
        groupId: modifier.groupId,
        name: modifier.name,
        price: modifier.price,
        sortOrder: modifier.sortOrder,
        isActive: modifier.isActive,
        createdAt: modifier.createdAt.toISOString(),
        updatedAt: modifier.updatedAt.toISOString(),
      })),
      createdAt: link.modifierGroup.createdAt.toISOString(),
      updatedAt: link.modifierGroup.updatedAt.toISOString(),
    })),
    branchSettings: row.branchSettings.map((setting) => ({
      productId: setting.productId,
      branchId: setting.branchId,
      isAvailable: setting.isAvailable,
      priceOverride: setting.priceOverride,
      isStopListed: setting.isStopListed,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
