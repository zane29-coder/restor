import type {
  Branch,
  BranchSummary,
  CreateBranchRequest,
  CreateEmployeeRequest,
  CreateRoleRequest,
  Employee,
  Paginated,
  PaginationQuery,
  PermissionDefinition,
  Role,
  Tenant,
  UpdateBranchRequest,
  UpdateRoleRequest,
  User,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

/** Branches of the caller's own tenant (TZ §8). */
export class BranchesResource {
  constructor(private readonly http: HttpClient) {}

  list(query?: PaginationQuery & { isActive?: boolean }): Promise<Paginated<Branch>> {
    return this.http.get<Paginated<Branch>>('branches', { query });
  }

  /** Lightweight list for pickers and branch switchers. */
  summaries(query?: { latitude?: number; longitude?: number }): Promise<BranchSummary[]> {
    return this.http.get<BranchSummary[]>('branches/summary', { query });
  }

  get(id: string): Promise<Branch> {
    return this.http.get<Branch>(`branches/${id}`);
  }

  create(payload: CreateBranchRequest): Promise<Branch> {
    return this.http.post<Branch>('branches', payload);
  }

  update(id: string, payload: UpdateBranchRequest): Promise<Branch> {
    return this.http.patch<Branch>(`branches/${id}`, payload);
  }

  remove(id: string): Promise<void> {
    return this.http.delete<void>(`branches/${id}`);
  }
}

/** Staff accounts (TZ §46 "Employees"). */
export class EmployeesResource {
  constructor(private readonly http: HttpClient) {}

  list(
    query?: PaginationQuery & { branchId?: string; roleId?: string; isActive?: boolean },
  ): Promise<Paginated<Employee>> {
    return this.http.get<Paginated<Employee>>('employees', { query });
  }

  get(id: string): Promise<Employee> {
    return this.http.get<Employee>(`employees/${id}`);
  }

  create(payload: CreateEmployeeRequest): Promise<Employee> {
    return this.http.post<Employee>('employees', payload);
  }

  update(id: string, payload: Partial<CreateEmployeeRequest>): Promise<Employee> {
    return this.http.patch<Employee>(`employees/${id}`, payload);
  }

  /** Deactivates rather than deleting, so order history keeps its author. */
  deactivate(id: string): Promise<Employee> {
    return this.http.post<Employee>(`employees/${id}/deactivate`);
  }

  resetPassword(id: string, newPassword: string): Promise<void> {
    return this.http.post<void>(`employees/${id}/reset-password`, { newPassword });
  }
}

/** Roles and the permission catalog (TZ §5). */
export class RolesResource {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<Role[]> {
    return this.http.get<Role[]>('roles');
  }

  get(id: string): Promise<Role> {
    return this.http.get<Role>(`roles/${id}`);
  }

  create(payload: CreateRoleRequest): Promise<Role> {
    return this.http.post<Role>('roles', payload);
  }

  update(id: string, payload: UpdateRoleRequest): Promise<Role> {
    return this.http.patch<Role>(`roles/${id}`, payload);
  }

  remove(id: string): Promise<void> {
    return this.http.delete<void>(`roles/${id}`);
  }

  /** Full permission catalog, grouped for the role editor UI. */
  permissions(): Promise<PermissionDefinition[]> {
    return this.http.get<PermissionDefinition[]>('permissions');
  }

  assignToUser(userId: string, roleIds: string[], branchIds: string[] = []): Promise<User> {
    return this.http.post<User>(`users/${userId}/roles`, { roleIds, branchIds });
  }
}

/** The caller's own company settings and branding (TZ §49). */
export class CompanyResource {
  constructor(private readonly http: HttpClient) {}

  get(): Promise<Tenant> {
    return this.http.get<Tenant>('company');
  }

  update(payload: Partial<Tenant>): Promise<Tenant> {
    return this.http.patch<Tenant>('company', payload);
  }
}
