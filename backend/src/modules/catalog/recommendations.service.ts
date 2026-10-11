import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  RecommendationPlacement,
  type RecommendationList,
  type RecommendationTarget,
} from '@restor/shared-types';
import type { SaveRecommendationListInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * The restaurant's curated recommendation lists (TZ 48, "Sizga yoqishi
 * mumkin" and "Yana nimadir kerakmi?").
 *
 * A list is edited as a whole — the admin screen sends the full, ordered list
 * and it replaces what was there — because the order IS the content: "drinks
 * first, then sauces" is the decision being made. Resolving a list against a
 * branch's live menu happens in `recommendation.math.ts` when the menu is
 * built, so nothing stored here ever has to change when a dish sells out.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(placement?: RecommendationPlacement): Promise<RecommendationList[]> {
    const rows = await this.prisma.db.productRecommendation.findMany({
      where: placement ? { placement } : {},
      orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }],
      include: {
        sourceProduct: { select: { name: true } },
        targetProduct: { select: { name: true } },
        targetCategory: { select: { name: true } },
      },
    });

    const lists = new Map<string, RecommendationList>();
    for (const row of rows) {
      const key = `${row.placement}:${row.sourceProductId ?? ''}`;
      const list =
        lists.get(key) ??
        ({
          placement: row.placement,
          sourceProductId: row.sourceProductId,
          sourceProductName: row.sourceProduct?.name ?? null,
          targets: [],
        } satisfies RecommendationList);

      const target: RecommendationTarget | null = row.targetProductId
        ? { kind: 'PRODUCT', id: row.targetProductId, name: row.targetProduct?.name ?? '—' }
        : row.targetCategoryId
          ? { kind: 'CATEGORY', id: row.targetCategoryId, name: row.targetCategory?.name ?? '—' }
          : null;
      if (target) list.targets.push(target);

      lists.set(key, list);
    }

    return [...lists.values()];
  }

  /** Replaces one list. An empty `targets` removes it. */
  async save(input: SaveRecommendationListInput): Promise<RecommendationList> {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');

    const sourceProductId =
      input.placement === RecommendationPlacement.CART ? null : (input.sourceProductId ?? null);

    if (sourceProductId) {
      const source = await this.prisma.db.product.findFirst({
        where: { id: sourceProductId, deletedAt: null },
        select: { id: true },
      });
      if (!source) throw AppException.notFound('Product', ErrorCode.PRODUCT_NOT_FOUND);
    }

    // Keep the first occurrence of each target; a repeated one adds nothing.
    const seen = new Set<string>();
    const targets = input.targets.filter((target) => {
      const key = 'productId' in target ? `p:${target.productId}` : `c:${target.categoryId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (sourceProductId && targets.some((t) => 'productId' in t && t.productId === sourceProductId)) {
      throw AppException.validation('Mahsulot oʻzini tavsiya qila olmaydi', {
        targets: ['A product cannot recommend itself'],
      });
    }

    const productIds = targets.flatMap((t) => ('productId' in t ? [t.productId] : []));
    const categoryIds = targets.flatMap((t) => ('categoryId' in t ? [t.categoryId] : []));

    // Scoped by the extension, so another restaurant's ids simply do not count.
    const [products, categories] = await Promise.all([
      productIds.length
        ? this.prisma.db.product.count({ where: { id: { in: productIds }, deletedAt: null } })
        : 0,
      categoryIds.length
        ? this.prisma.db.category.count({ where: { id: { in: categoryIds }, deletedAt: null } })
        : 0,
    ]);
    if (products !== productIds.length || categories !== categoryIds.length) {
      throw AppException.notFound('Recommendation target');
    }

    await this.prisma.transaction(async (tx) => {
      await tx.productRecommendation.deleteMany({
        where: { placement: input.placement, sourceProductId },
      });
      if (targets.length > 0) {
        await tx.productRecommendation.createMany({
          data: targets.map((target, index) => ({
            tenantId,
            placement: input.placement,
            sourceProductId,
            targetProductId: 'productId' in target ? target.productId : null,
            targetCategoryId: 'categoryId' in target ? target.categoryId : null,
            sortOrder: index,
          })),
        });
      }
    });

    await this.audit.record({
      action: 'RECOMMENDATIONS_UPDATED',
      entity: 'ProductRecommendation',
      entityId: sourceProductId,
      newValue: { placement: input.placement, targets: targets.length },
    });

    const saved = await this.list(input.placement);
    return (
      saved.find((list) => list.sourceProductId === sourceProductId) ?? {
        placement: input.placement,
        sourceProductId,
        sourceProductName: null,
        targets: [],
      }
    );
  }
}
