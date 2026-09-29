import { Injectable } from '@nestjs/common';
import { ErrorCode, type Category } from '@restor/shared-types';
import { uniqueSlug } from '@restor/shared-utils';
import type { CreateCategoryInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Prisma needs the FK explicitly even though the extension also injects it. */
function requireTenant(): string {
  const tenantId = getContext()?.tenantId;
  if (!tenantId) {
    throw AppException.badRequest('This resource belongs to a restaurant; none is in scope');
  }
  return tenantId;
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Returns the tree: top-level categories with their children nested. */
  async list(options: { includeInactive?: boolean } = {}): Promise<Category[]> {
    const rows = await this.prisma.db.category.findMany({
      where: {
        deletedAt: null,
        ...(options.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });

    const mapped = rows.map(toCategory);
    const byId = new Map(mapped.map((category) => [category.id, category]));

    const roots: Category[] = [];
    for (const category of mapped) {
      if (category.parentId && byId.has(category.parentId)) {
        const parent = byId.get(category.parentId)!;
        (parent.children ??= []).push(category);
      } else {
        roots.push(category);
      }
    }

    return roots;
  }

  async get(id: string): Promise<Category> {
    const row = await this.prisma.db.category.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { products: true } } },
    });

    if (!row) throw AppException.notFound('Category', ErrorCode.CATEGORY_NOT_FOUND);
    return toCategory(row);
  }

  async create(input: CreateCategoryInput): Promise<Category> {
    if (input.parentId) await this.assertExists(input.parentId);

    const slug = await this.nextSlug(input.name);

    const row = await this.prisma.db.category.create({
      data: {
        tenantId: requireTenant(),
        name: input.name,
        slug,
        parentId: input.parentId ?? null,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        sortOrder: input.sortOrder,
      },
      include: { _count: { select: { products: true } } },
    });

    await this.audit.record({
      action: 'CATEGORY_CREATED',
      entity: 'Category',
      entityId: row.id,
      newValue: { name: row.name },
    });

    return toCategory(row);
  }

  async update(id: string, input: Partial<CreateCategoryInput> & { isActive?: boolean }): Promise<Category> {
    await this.assertExists(id);

    if (input.parentId) {
      if (input.parentId === id) {
        throw AppException.badRequest('A category cannot be its own parent');
      }
      await this.assertExists(input.parentId);
      await this.assertNotDescendant(id, input.parentId);
    }

    const row = await this.prisma.db.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: { _count: { select: { products: true } } },
    });

    await this.audit.record({
      action: 'CATEGORY_UPDATED',
      entity: 'Category',
      entityId: id,
      newValue: input as Record<string, unknown>,
    });

    return toCategory(row);
  }

  /**
   * Soft-deletes a category.
   *
   * Refuses while products still point at it: orphaning them would make them
   * unreachable in the menu without telling anyone why.
   */
  async remove(id: string): Promise<void> {
    await this.assertExists(id);

    const [productCount, childCount] = await Promise.all([
      this.prisma.db.product.count({ where: { categoryId: id, deletedAt: null } }),
      this.prisma.db.category.count({ where: { parentId: id, deletedAt: null } }),
    ]);

    if (productCount > 0) {
      throw AppException.conflict(
        `${productCount} product(s) are still in this category. Move them first.`,
      );
    }
    if (childCount > 0) {
      throw AppException.conflict('Remove the sub-categories first');
    }

    await this.prisma.db.category.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({ action: 'CATEGORY_DELETED', entity: 'Category', entityId: id });
  }

  /** Persists a drag-and-drop reorder in one transaction. */
  async reorder(ids: string[]): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      await Promise.all(
        ids.map((id, index) =>
          tx.category.updateMany({ where: { id }, data: { sortOrder: index } }),
        ),
      );
    });
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.db.category.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw AppException.notFound('Category', ErrorCode.CATEGORY_NOT_FOUND);
  }

  /** Stops a move that would create a cycle in the tree. */
  private async assertNotDescendant(categoryId: string, candidateParentId: string): Promise<void> {
    let cursor: string | null = candidateParentId;
    const seen = new Set<string>();

    while (cursor) {
      if (cursor === categoryId) {
        throw AppException.badRequest('A category cannot be moved under its own descendant');
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);

      const parent: { parentId: string | null } | null = await this.prisma.db.category.findFirst(
        { where: { id: cursor }, select: { parentId: true } },
      );
      cursor = parent?.parentId ?? null;
    }
  }

  private async nextSlug(name: string): Promise<string> {
    const existing = await this.prisma.db.category.findMany({ select: { slug: true } });
    return uniqueSlug(name, new Set(existing.map((row) => row.slug)));
  }
}

type CategoryRow = {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { products: number };
};

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    tenantId: row.tenantId,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imageUrl: row.imageUrl,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    productCount: row._count.products,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
