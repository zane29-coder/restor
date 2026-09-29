import { Injectable } from '@nestjs/common';
import { ErrorCode, type BranchMenu, type MenuCategory, type MenuProduct } from '@restor/shared-types';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../database/prisma.service';

/**
 * The customer-facing menu for one branch (TZ §9, §11).
 *
 * Built server-side in ONE query set with availability and branch price
 * overrides already applied, so the storefront and Mini App never have to
 * merge three lists client-side — and a stop-listed item can never leak into
 * a cart because the client forgot to filter.
 */
@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  async forBranch(branchId: string): Promise<BranchMenu> {
    const branch = await this.prisma.db.branch.findFirst({
      where: { id: branchId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!branch) throw AppException.notFound('Branch', ErrorCode.BRANCH_NOT_FOUND);

    const categories = await this.prisma.db.category.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, imageUrl: true, sortOrder: true },
    });

    const products = await this.prisma.db.product.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        // Only items this branch actually sells and has not stop-listed.
        branchSettings: { some: { branchId, isAvailable: true, isStopListed: false } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        modifierGroups: {
          include: {
            modifierGroup: {
              include: { modifiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        branchSettings: { where: { branchId } },
      },
    });

    const byCategory = new Map<string, MenuProduct[]>();

    for (const product of products) {
      const setting = product.branchSettings[0];
      // Precedence: branch override > discount > list price.
      const basePrice = setting?.priceOverride ?? product.price;
      const effectivePrice =
        setting?.priceOverride ?? product.discountPrice ?? product.price;

      const entry: MenuProduct = {
        id: product.id,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        price: effectivePrice,
        oldPrice: effectivePrice < basePrice ? basePrice : null,
        preparationTime: product.preparationTime,
        isAvailable: true,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          priceDelta: variant.priceDelta,
          isDefault: variant.isDefault,
        })),
        modifierGroups: product.modifierGroups.map((link) => ({
          id: link.modifierGroup.id,
          name: link.modifierGroup.name,
          minSelect: link.modifierGroup.minSelect,
          maxSelect: link.modifierGroup.maxSelect,
          modifiers: link.modifierGroup.modifiers.map((modifier) => ({
            id: modifier.id,
            name: modifier.name,
            price: modifier.price,
          })),
        })),
      };

      const list = byCategory.get(product.categoryId) ?? [];
      list.push(entry);
      byCategory.set(product.categoryId, list);
    }

    const menuCategories: MenuCategory[] = categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        imageUrl: category.imageUrl,
        sortOrder: category.sortOrder,
        products: byCategory.get(category.id) ?? [],
      }))
      // An empty category is noise in a customer menu.
      .filter((category) => category.products.length > 0);

    return {
      branchId,
      categories: menuCategories,
      generatedAt: new Date().toISOString(),
    };
  }
}
