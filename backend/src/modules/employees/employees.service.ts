import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditAction, type Employee, type Paginated, type User } from '@restor/shared-types';
import { normalizePagination, paginated } from '@restor/shared-utils';
import type { AssignRolesInput, CreateUserInput, UpdateUserInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { BranchScope } from '../../common/guards/branch-scope.guard';
import { getContext } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { SubscriptionLimitsService } from '../subscriptions/subscription-limits.service';

const EMPLOYEE_INCLUDE = {
  user: {
    include: {
      roles: { include: { role: { select: { id: true, code: true, name: true, isSystem: true } } } },
    },
  },
} as const;

type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof EMPLOYEE_INCLUDE }>;

/**
 * Staff accounts (TZ §46).
 *
 * An employee is a `User` (credentials + roles) plus an `Employee` row
 * (position, branch, employment dates). The two are always created together
 * inside one transaction — a user without an employee record would be invisible
 * to the staff list, and an employee without a user could not sign in.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly limits: SubscriptionLimitsService,
    private readonly branchScope: BranchScope,
  ) {}

  async list(query: {
    page?: number;
    limit?: number;
    branchId?: string;
    roleId?: string;
    isActive?: boolean;
    search?: string;
  }): Promise<Paginated<Employee>> {
    const page = normalizePagination(query);
    const branchFilter = this.branchScope.filterFor(query.branchId);

    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(branchFilter ? { branchId: branchFilter as Prisma.EmployeeWhereInput['branchId'] } : {}),
      ...(query.roleId ? { user: { roles: { some: { roleId: query.roleId } } } } : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search } },
              ],
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.employee.findMany({
        where,
        include: EMPLOYEE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.employee.count({ where }),
    ]);

    return paginated(rows.map(toEmployee), total, page);
  }

  async get(id: string): Promise<Employee> {
    const row = await this.prisma.db.employee.findFirst({
      where: { id, deletedAt: null },
      include: EMPLOYEE_INCLUDE,
    });

    if (!row) throw AppException.notFound('Employee');
    if (row.branchId) this.branchScope.assertCanAccess(row.branchId);

    return toEmployee(row);
  }

  async create(input: CreateUserInput): Promise<Employee> {
    const tenantId = this.requireTenant();
    await this.limits.assertCanAddEmployee(tenantId);

    await this.assertRolesAssignable(input.roleIds);
    for (const branchId of input.branchIds) this.branchScope.assertCanAccess(branchId);

    const duplicate = await this.prisma.db.user.findFirst({
      where: { tenantId, phone: input.phone, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw AppException.conflict('Someone with this phone number already works here');
    }

    const passwordHash = await this.passwords.hash(input.password);
    const homeBranchId = input.branchIds[0] ?? null;

    const row = await this.prisma.transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          phone: input.phone,
          email: input.email ?? null,
          passwordHash,
          fullName: input.fullName,
          isActive: input.isActive,
          roles: {
            create: input.roleIds.flatMap((roleId) =>
              // A role with no branch means every branch; one row per branch
              // otherwise, which is what scopes the user's access.
              input.branchIds.length === 0
                ? [{ roleId }]
                : input.branchIds.map((branchId) => ({ roleId, branchId })),
            ),
          },
        },
      });

      return tx.employee.create({
        data: {
          tenantId,
          userId: user.id,
          branchId: homeBranchId,
          position: input.position ?? null,
          employeeCode: input.employeeCode ?? null,
          hiredAt: new Date(),
          isActive: input.isActive,
        },
        include: EMPLOYEE_INCLUDE,
      });
    });

    await this.audit.record({
      action: AuditAction.EMPLOYEE_CREATED,
      entity: 'Employee',
      entityId: row.id,
      newValue: {
        fullName: input.fullName,
        phone: input.phone,
        roleIds: input.roleIds,
        branchIds: input.branchIds,
      },
    });

    return toEmployee(row);
  }

  async update(id: string, input: UpdateUserInput): Promise<Employee> {
    const before = await this.get(id);

    if (input.roleIds) await this.assertRolesAssignable(input.roleIds);
    for (const branchId of input.branchIds ?? []) this.branchScope.assertCanAccess(branchId);

    const passwordHash = input.password ? await this.passwords.hash(input.password) : null;

    const row = await this.prisma.transaction(async (tx) => {
      const employee = await tx.employee.findFirstOrThrow({ where: { id }, select: { userId: true } });

      if (input.roleIds || input.branchIds) {
        const roleIds = input.roleIds ?? before.user?.roles.map((role) => role.id) ?? [];
        const branchIds = input.branchIds ?? before.user?.branchIds ?? [];

        await tx.userRole.deleteMany({ where: { userId: employee.userId } });
        await tx.userRole.createMany({
          data: roleIds.flatMap((roleId) =>
            branchIds.length === 0
              ? [{ userId: employee.userId, roleId }]
              : branchIds.map((branchId) => ({ userId: employee.userId, roleId, branchId })),
          ),
        });
      }

      await tx.user.update({
        where: { id: employee.userId },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });

      return tx.employee.update({
        where: { id },
        data: {
          ...(input.position !== undefined ? { position: input.position } : {}),
          ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.branchIds !== undefined ? { branchId: input.branchIds[0] ?? null } : {}),
        },
        include: EMPLOYEE_INCLUDE,
      });
    });

    // Permissions are baked into the access token, so a role change must end
    // the old sessions or it would not take effect until they expired.
    if (input.roleIds || input.branchIds || input.password || input.isActive === false) {
      await this.tokens.revokeAllForUser(row.userId);
    }

    const after = toEmployee(row);
    await this.audit.recordChange(
      'EMPLOYEE_UPDATED',
      'Employee',
      id,
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );

    return after;
  }

  /**
   * Deactivates rather than deletes.
   *
   * Orders, shifts and audit rows reference the user; deleting would either
   * orphan them or cascade away real history.
   */
  async deactivate(id: string): Promise<Employee> {
    const employee = await this.get(id);
    if (employee.userId === getContext()?.userId) {
      throw AppException.badRequest('You cannot deactivate your own account');
    }

    const row = await this.prisma.transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id },
        data: { isActive: false, firedAt: new Date() },
        include: EMPLOYEE_INCLUDE,
      });
      await tx.user.update({ where: { id: updated.userId }, data: { isActive: false } });
      return updated;
    });

    await this.tokens.revokeAllForUser(row.userId);
    await this.audit.record({
      action: AuditAction.EMPLOYEE_DELETED,
      entity: 'Employee',
      entityId: id,
      oldValue: { fullName: employee.user?.fullName },
    });

    return toEmployee(row);
  }

  /** Admin-initiated password reset; ends every session for that user. */
  async resetPassword(id: string, newPassword: string): Promise<void> {
    const employee = await this.get(id);
    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.db.user.update({
      where: { id: employee.userId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });

    await this.tokens.revokeAllForUser(employee.userId);
    await this.audit.record({
      action: AuditAction.PASSWORD_CHANGED,
      entity: 'User',
      entityId: employee.userId,
      newValue: { resetByAdmin: true },
    });
  }

  /** Re-assigns a user's roles directly (used by `POST /users/:id/roles`). */
  async assignRoles(userId: string, input: AssignRolesInput): Promise<User> {
    await this.assertRolesAssignable(input.roleIds);
    for (const branchId of input.branchIds) this.branchScope.assertCanAccess(branchId);

    const user = await this.prisma.transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({
        data: input.roleIds.flatMap((roleId) =>
          input.branchIds.length === 0
            ? [{ userId, roleId }]
            : input.branchIds.map((branchId) => ({ userId, roleId, branchId })),
        ),
      });

      return tx.user.findFirstOrThrow({
        where: { id: userId },
        include: {
          roles: {
            include: { role: { select: { id: true, code: true, name: true, isSystem: true } } },
          },
        },
      });
    });

    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({
      action: AuditAction.PERMISSION_CHANGED,
      entity: 'User',
      entityId: userId,
      newValue: { roleIds: input.roleIds, branchIds: input.branchIds },
    });

    return toUser(user);
  }

  /**
   * Blocks privilege escalation: a tenant admin must not be able to hand out
   * the platform role, and roles are only assignable if they are visible in
   * this tenant's scope.
   */
  private async assertRolesAssignable(roleIds: string[]): Promise<void> {
    const roles = await this.prisma.db.role.findMany({
      where: { id: { in: roleIds }, deletedAt: null },
      select: { id: true, code: true },
    });

    if (roles.length !== new Set(roleIds).size) {
      throw AppException.validation('Unknown role', {
        roleIds: ['One or more roles do not exist'],
      });
    }

    const ctx = getContext();
    const isPlatformAdmin = ctx?.bypassTenantScope && !ctx.tenantId;

    if (!isPlatformAdmin && roles.some((role) => role.code === 'SUPER_ADMIN')) {
      throw AppException.forbidden('The platform administrator role cannot be assigned here');
    }
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) {
      throw AppException.badRequest('An employee belongs to a restaurant; none is in scope');
    }
    return tenantId;
  }
}

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    branchId: row.branchId,
    employeeCode: row.employeeCode,
    position: row.position,
    hiredAt: row.hiredAt?.toISOString() ?? null,
    firedAt: row.firedAt?.toISOString() ?? null,
    isActive: row.isActive,
    user: toUser(row.user),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type UserRow = {
  id: string;
  tenantId: string | null;
  phone: string;
  email: string | null;
  fullName: string;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  roles: Array<{
    branchId: string | null;
    role: { id: string; code: string; name: string; isSystem: boolean };
  }>;
};

function toUser(row: UserRow): User {
  const branchIds = new Set<string>();
  let unscoped = false;
  for (const link of row.roles) {
    if (link.branchId) branchIds.add(link.branchId);
    else unscoped = true;
  }

  // Deduplicate: one role granted across three branches is still one role.
  const roles = new Map(row.roles.map((link) => [link.role.id, link.role]));

  return {
    id: row.id,
    tenantId: row.tenantId,
    phone: row.phone,
    email: row.email,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    roles: [...roles.values()],
    branchIds: unscoped ? [] : [...branchIds],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
