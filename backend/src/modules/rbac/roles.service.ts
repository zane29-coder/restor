import { Injectable } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  AuditAction,
  PERMISSION_GROUPS,
  type Permission,
  type PermissionDefinition,
  type Role,
} from '@restor/shared-types';
import { slugify } from '@restor/shared-utils';
import type { CreateRoleInput, UpdateRoleInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

const ROLE_INCLUDE = {
  permissions: { include: { permission: true } },
  _count: { select: { users: true } },
} as const;

/**
 * Roles and permissions (TZ §5).
 *
 * System roles live with `tenantId: null` and are shared by every tenant; the
 * Prisma scoping extension lets reads see them but forces every write to the
 * caller's own tenant, so a tenant admin can read a system role but never
 * modify one.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** System roles plus this tenant's custom ones. */
  async list(): Promise<Role[]> {
    const roles = await this.prisma.db.role.findMany({
      where: { deletedAt: null },
      include: ROLE_INCLUDE,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });

    return roles.map(toRole);
  }

  async get(id: string): Promise<Role> {
    const role = await this.prisma.db.role.findFirst({
      where: { id, deletedAt: null },
      include: ROLE_INCLUDE,
    });

    if (!role) throw AppException.notFound('Role');
    return toRole(role);
  }

  async create(input: CreateRoleInput): Promise<Role> {
    const tenantId = this.requireTenant();
    const code = input.code ?? deriveCode(input.name);

    const existing = await this.prisma.db.role.findFirst({
      where: { tenantId, code, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw AppException.conflict(`A role with code ${code} already exists`);
    }

    const permissionIds = await this.resolvePermissionIds(input.permissions);

    const role = await this.prisma.db.role.create({
      data: {
        tenantId,
        code,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
      include: ROLE_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.ROLE_CREATED,
      entity: 'Role',
      entityId: role.id,
      newValue: { code, name: input.name, permissions: input.permissions },
    });

    return toRole(role);
  }

  async update(id: string, input: UpdateRoleInput): Promise<Role> {
    const existing = await this.loadEditableRole(id);

    const permissionIds = input.permissions
      ? await this.resolvePermissionIds(input.permissions)
      : null;

    const role = await this.prisma.transaction(async (tx) => {
      if (permissionIds) {
        // Replace wholesale: the editor always sends the complete set, and a
        // diff would silently keep a permission the admin just unticked.
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }

      return tx.role.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        include: ROLE_INCLUDE,
      });
    });

    await this.audit.record({
      action: AuditAction.PERMISSION_CHANGED,
      entity: 'Role',
      entityId: id,
      oldValue: {
        name: existing.name,
        permissions: existing.permissions.map((p) => p.permission.code),
      },
      newValue: { name: role.name, permissions: role.permissions.map((p) => p.permission.code) },
    });

    return toRole(role);
  }

  async remove(id: string): Promise<void> {
    const role = await this.loadEditableRole(id);

    const userCount = await this.prisma.db.userRole.count({ where: { roleId: id } });
    if (userCount > 0) {
      throw AppException.conflict(
        `${userCount} user(s) still hold this role. Reassign them before deleting it.`,
      );
    }

    // Soft delete: audit rows reference the role and must keep resolving.
    await this.prisma.db.role.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.audit.record({
      action: AuditAction.ROLE_DELETED,
      entity: 'Role',
      entityId: id,
      oldValue: { code: role.code, name: role.name },
    });
  }

  /** The permission catalog, for the role editor's grouped checkbox list. */
  async listPermissions(): Promise<PermissionDefinition[]> {
    const rows = await this.prisma.db.permission.findMany({ orderBy: { code: 'asc' } });

    // Fall back to the shared catalog if the table has not been seeded yet, so
    // a fresh install still renders a usable role editor.
    if (rows.length === 0) {
      return ALL_PERMISSIONS.map((code) => ({
        id: code,
        code,
        group: groupOf(code),
        description: null,
      }));
    }

    return rows.map((row) => ({
      id: row.id,
      code: row.code as Permission,
      group: row.group,
      description: row.description,
    }));
  }

  /** Rejects system roles and roles belonging to another tenant. */
  private async loadEditableRole(id: string) {
    const role = await this.prisma.db.role.findFirst({
      where: { id, deletedAt: null },
      include: ROLE_INCLUDE,
    });

    if (!role) throw AppException.notFound('Role');

    if (role.isSystem || role.tenantId === null) {
      throw AppException.forbidden(
        'Built-in roles cannot be changed. Duplicate it into a custom role instead.',
      );
    }

    return role;
  }

  private async resolvePermissionIds(codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    const rows = await this.prisma.db.permission.findMany({
      where: { code: { in: unique } },
      select: { id: true, code: true },
    });

    if (rows.length !== unique.length) {
      const found = new Set(rows.map((row) => row.code));
      const missing = unique.filter((code) => !found.has(code));
      throw AppException.validation('Unknown permission code(s)', { permissions: missing });
    }

    return rows.map((row) => row.id);
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) {
      throw AppException.badRequest('Custom roles belong to a restaurant; none is in scope');
    }
    return tenantId;
  }
}

type RoleRow = {
  id: string;
  tenantId: string | null;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{ permission: { code: string } }>;
  _count: { users: number };
};

function toRole(row: RoleRow): Role {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    permissions: row.permissions.map((p) => p.permission.code as Permission),
    userCount: row._count.users,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function deriveCode(name: string): string {
  return slugify(name).replace(/-/g, '_').toUpperCase().slice(0, 40) || 'CUSTOM_ROLE';
}

/** Finds which display group a permission belongs to. */
function groupOf(code: Permission): string {
  for (const [group, permissions] of Object.entries(PERMISSION_GROUPS)) {
    if (permissions.includes(code)) return group;
  }
  return 'Other';
}
