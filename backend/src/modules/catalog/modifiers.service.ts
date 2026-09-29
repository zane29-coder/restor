import { Injectable } from '@nestjs/common';
import { ErrorCode, type ModifierGroup } from '@restor/shared-types';
import type { CreateModifierGroupInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

const GROUP_INCLUDE = {
  modifiers: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
} as const;

@Injectable()
export class ModifiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ModifierGroup[]> {
    const rows = await this.prisma.db.modifierGroup.findMany({
      where: { deletedAt: null },
      include: GROUP_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return rows.map(toModifierGroup);
  }

  async create(input: CreateModifierGroupInput): Promise<ModifierGroup> {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) {
      throw AppException.badRequest('A modifier group belongs to a restaurant; none is in scope');
    }

    const row = await this.prisma.db.modifierGroup.create({
      data: {
        tenantId,
        name: input.name,
        minSelect: input.minSelect,
        maxSelect: input.maxSelect,
        sortOrder: input.sortOrder,
        modifiers: {
          create: input.modifiers.map((modifier) => ({
            name: modifier.name,
            price: modifier.price,
            sortOrder: modifier.sortOrder,
          })),
        },
      },
      include: GROUP_INCLUDE,
    });

    await this.audit.record({
      action: 'MODIFIER_GROUP_CREATED',
      entity: 'ModifierGroup',
      entityId: row.id,
      newValue: { name: row.name, modifierCount: input.modifiers.length },
    });

    return toModifierGroup(row);
  }

  async update(id: string, input: Partial<CreateModifierGroupInput>): Promise<ModifierGroup> {
    await this.assertExists(id);

    const row = await this.prisma.transaction(async (tx) => {
      if (input.modifiers) {
        // Deactivated rather than deleted: an order item may still reference
        // a modifier by id, and a hard delete would null that link out.
        await tx.modifier.updateMany({ where: { groupId: id }, data: { isActive: false } });
        await tx.modifier.createMany({
          data: input.modifiers.map((modifier) => ({
            groupId: id,
            name: modifier.name,
            price: modifier.price,
            sortOrder: modifier.sortOrder ?? 0,
          })),
        });
      }

      return tx.modifierGroup.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.minSelect !== undefined ? { minSelect: input.minSelect } : {}),
          ...(input.maxSelect !== undefined ? { maxSelect: input.maxSelect } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
        include: GROUP_INCLUDE,
      });
    });

    await this.audit.record({
      action: 'MODIFIER_GROUP_UPDATED',
      entity: 'ModifierGroup',
      entityId: id,
      newValue: { name: row.name },
    });

    return toModifierGroup(row);
  }

  async remove(id: string): Promise<void> {
    await this.assertExists(id);

    const usedBy = await this.prisma.db.productModifierGroup.count({
      where: { modifierGroupId: id },
    });
    if (usedBy > 0) {
      throw AppException.conflict(
        `${usedBy} product(s) still use this modifier group. Detach it from them first.`,
      );
    }

    await this.prisma.db.modifierGroup.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      action: 'MODIFIER_GROUP_DELETED',
      entity: 'ModifierGroup',
      entityId: id,
    });
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.db.modifierGroup.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw AppException.notFound('Modifier group', ErrorCode.MODIFIER_NOT_FOUND);
  }
}

type GroupRow = {
  id: string;
  tenantId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  modifiers: Array<{
    id: string;
    groupId: string;
    name: string;
    price: number;
    sortOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

function toModifierGroup(row: GroupRow): ModifierGroup {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    minSelect: row.minSelect,
    maxSelect: row.maxSelect,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    modifiers: row.modifiers.map((modifier) => ({
      id: modifier.id,
      groupId: modifier.groupId,
      name: modifier.name,
      price: modifier.price,
      sortOrder: modifier.sortOrder,
      isActive: modifier.isActive,
      createdAt: modifier.createdAt.toISOString(),
      updatedAt: modifier.updatedAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
