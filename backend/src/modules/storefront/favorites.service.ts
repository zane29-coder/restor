import { Injectable } from '@nestjs/common';
import { ErrorCode, type FavoriteProduct } from '@restor/shared-types';
import { runUnscoped } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../database/prisma.service';
import { requireCustomerSession } from './customer-session';

/**
 * "Tanlanganlar" — products the customer hearted, across restaurants
 * (TZ 48 §19).
 *
 * Adding is scoped to the restaurant of the session: the product must be on
 * THIS restaurant's menu, and the row is stamped with this restaurant by the
 * tenant extension. Listing spans restaurants on purpose, which is why it runs
 * unscoped — filtered on the session's account, which is the only key that
 * matters for a person's own list. Every entry says which restaurant it is
 * from, so the Mini App never offers to add another restaurant's dish to
 * this cart.
 */
@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<FavoriteProduct[]> {
    const session = await requireCustomerSession(this.prisma);

    const rows = await runUnscoped(() =>
      this.prisma.db.customerFavorite.findMany({
        where: { accountId: session.accountId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          tenant: { select: { name: true, companyName: true, slug: true } },
          product: {
            select: {
              name: true,
              imageUrl: true,
              price: true,
              discountPrice: true,
              isActive: true,
              deletedAt: true,
            },
          },
        },
      }),
    );

    return rows.map((row) => ({
      productId: row.productId,
      restaurantName: row.tenant.companyName || row.tenant.name,
      restaurantSlug: row.tenant.slug,
      isCurrentRestaurant: row.tenantId === session.tenantId,
      name: row.product.name,
      imageUrl: row.product.imageUrl,
      price: row.product.discountPrice ?? row.product.price,
      isActive: row.product.isActive && !row.product.deletedAt,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async add(productId: string): Promise<void> {
    const session = await requireCustomerSession(this.prisma);

    // Scoped: another restaurant's product id simply is not found here.
    const product = await this.prisma.db.product.findFirst({
      where: { id: productId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!product) throw AppException.notFound('Product', ErrorCode.PRODUCT_NOT_FOUND);

    await this.prisma.db.customerFavorite.upsert({
      where: { accountId_productId: { accountId: session.accountId, productId } },
      create: { accountId: session.accountId, tenantId: session.tenantId, productId },
      update: {},
    });
  }

  /** From any restaurant — the list shows them all, so removal must reach them all. */
  async remove(productId: string): Promise<void> {
    const session = await requireCustomerSession(this.prisma);
    await runUnscoped(() =>
      this.prisma.db.customerFavorite.deleteMany({
        where: { accountId: session.accountId, productId },
      }),
    );
  }
}
