import type { BaseEntity } from '../api';
import type { Permission, SystemRole } from '../rbac';

/* -------------------------------------------------------------------------- */
/* Users, roles, employees                                                    */
/* -------------------------------------------------------------------------- */

export interface User extends BaseEntity {
  /** `null` only for SUPER_ADMIN, who lives outside every tenant. */
  tenantId: string | null;
  phone: string;
  email: string | null;
  fullName: string;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: RoleSummary[];
  /**
   * Branches this user is scoped to. Empty means "all branches of the tenant"
   * (owners, company admins); otherwise the user only sees these branches.
   */
  branchIds: string[];
}

export interface RoleSummary {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
}

export interface Role extends BaseEntity {
  /** `null` for the built-in roles shared by every tenant. */
  tenantId: string | null;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  /** How many users currently hold this role — shown in the admin list. */
  userCount?: number;
}

/** A permission as stored in the DB and listed by `GET /permissions`. */
export interface PermissionDefinition {
  id: string;
  code: Permission;
  group: string;
  description: string | null;
}

export interface Employee extends BaseEntity {
  tenantId: string;
  userId: string;
  user?: User;
  /** Home branch. Cross-branch access is granted via role branch scoping. */
  branchId: string | null;
  employeeCode: string | null;
  position: string | null;
  hiredAt: string | null;
  firedAt: string | null;
  isActive: boolean;
}

/* -------------------------------------------------------------------------- */
/* Authentication (TZ §52)                                                    */
/* -------------------------------------------------------------------------- */

export interface LoginRequest {
  /** Phone in E.164 (`+998901234567`) or an email address. */
  login: string;
  password: string;
  /** Required for staff logins; resolved from the slug when omitted. */
  tenantSlug?: string;
  deviceId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthSession {
  tokens: TokenPair;
  user: AuthenticatedUser;
}

/** The `/auth/me` payload: identity plus the flattened permission set. */
export interface AuthenticatedUser {
  id: string;
  tenantId: string | null;
  tenantSlug: string | null;
  phone: string;
  email: string | null;
  fullName: string;
  avatarUrl: string | null;
  roles: string[];
  /** Union of every permission from every role the user holds. */
  permissions: Permission[];
  branchIds: string[];
  isSuperAdmin: boolean;
}

/**
 * Decoded access-token body.
 *
 * `tenantId` is the single source of truth for tenant scoping — the backend
 * never reads a tenant id from the request body or a header (TZ §52).
 */
export interface JwtAccessPayload {
  /** Subject: user id. */
  sub: string;
  tenantId: string | null;
  roles: string[];
  permissions: Permission[];
  branchIds: string[];
  /** Set for courier tokens so the mobile app can query its own jobs. */
  courierId?: string;
  /** Token type discriminator; refresh tokens carry `refresh`. */
  typ: 'access';
  iat: number;
  exp: number;
}

export interface JwtRefreshPayload {
  sub: string;
  /** Opaque id of the stored refresh-token row, so it can be revoked. */
  jti: string;
  typ: 'refresh';
  iat: number;
  exp: number;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * Telegram Mini App sign-in (TZ §48).
 *
 * The client forwards the raw `initData` string untouched; the backend
 * verifies its HMAC signature against the bot token before trusting a single
 * field of it.
 */
export interface TelegramAuthRequest {
  initData: string;
  tenantSlug: string;
}

export interface CreateEmployeeRequest {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
  roleIds: string[];
  branchIds?: string[];
  position?: string;
  employeeCode?: string;
}

export interface CreateRoleRequest {
  name: string;
  code?: string;
  description?: string;
  permissions: Permission[];
}

export type UpdateRoleRequest = Partial<CreateRoleRequest>;

export type SystemRoleCode = SystemRole;
