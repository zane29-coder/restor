import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  SystemRole,
  TenantStatus,
  type AuthSession,
  type AuthenticatedUser,
  type Permission,
  type TokenPair,
} from '@restor/shared-types';
import { normalizePhone } from '@restor/shared-utils';
import type { LoginInput, TelegramAuthInput } from '@restor/validation';
import { AppConfig } from '../../config/configuration';
import { AppException } from '../../common/errors/app-exception';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { runUnscoped } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from './password.service';
import { TelegramInitDataService } from './telegram-init-data.service';
import { TokenService, type AccessTokenClaims, type IssueContext } from './token.service';

/** What `findUserForAuth` needs to build a session. */
const USER_WITH_ACCESS = {
  roles: {
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  },
  tenant: { select: { id: true, slug: true, status: true } },
  courier: { select: { id: true } },
} as const;

/** The exact row shape the session builders work with. */
type UserWithAccess = Prisma.UserGetPayload<{ include: typeof USER_WITH_ACCESS }>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly telegram: TelegramInitDataService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly config: AppConfig,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Login                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Staff sign-in with phone/email + password.
   *
   * Runs unscoped: the tenant is not known until the user is found. Every
   * failure path returns the same generic message and burns the same CPU time,
   * so an attacker cannot enumerate which phone numbers are registered.
   */
  async login(input: LoginInput, context: IssueContext): Promise<AuthSession> {
    const user = await runUnscoped(() => this.findUserForAuth(input.login, input.tenantSlug));

    if (!user) {
      await this.passwords.verifyDummy(input.password);
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entity: 'User',
        newValue: { login: maskLogin(input.login), reason: 'not_found' },
        tenantId: null,
        userId: null,
      });
      throw this.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppException(
        ErrorCode.USER_INACTIVE,
        `Too many failed attempts. Try again in ${minutes} minute(s).`,
        423,
      );
    }

    const passwordMatches = await this.passwords.verify(user.passwordHash, input.password);

    if (!passwordMatches) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entity: 'User',
        entityId: user.id,
        newValue: { reason: 'bad_password' },
        tenantId: user.tenantId,
        userId: user.id,
      });
      throw this.invalidCredentials();
    }

    if (!user.isActive || user.deletedAt) {
      throw new AppException(ErrorCode.USER_INACTIVE, 'This account has been deactivated', 403);
    }

    this.assertTenantUsable(user.tenant);

    const session = await this.createSession(user, context);

    await runUnscoped(() =>
      this.prisma.db.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
      }),
    );

    await this.audit.record({
      action: AuditAction.LOGIN,
      entity: 'User',
      entityId: user.id,
      tenantId: user.tenantId,
      userId: user.id,
    });

    return session;
  }

  /**
   * Telegram Mini App sign-in (TZ §48).
   *
   * The signature is verified BEFORE any field of `initData` is read. Only
   * then is the Telegram id used to find or create the customer record.
   */
  async loginWithTelegram(input: TelegramAuthInput, context: IssueContext): Promise<AuthSession> {
    const tenant = await runUnscoped(() =>
      this.prisma.db.tenant.findUnique({
        where: { slug: input.tenantSlug },
        select: { id: true, slug: true, status: true, deletedAt: true },
      }),
    );

    if (!tenant || tenant.deletedAt) {
      throw AppException.notFound('Restaurant', ErrorCode.TENANT_NOT_FOUND);
    }
    this.assertTenantUsable(tenant);

    // A tenant running its own bot signs with its own token.
    const botToken = await this.resolveBotToken(tenant.id);
    const verified = this.telegram.verify(input.initData, botToken);

    const telegramId = String(verified.user.id);
    const fullName = [verified.user.first_name, verified.user.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    // Mini App users are CUSTOMERS, not staff: they get a customer record and
    // a token with no staff permissions at all.
    const customer = await runUnscoped(() =>
      this.prisma.db.customer.upsert({
        where: { tenantId_telegramId: { tenantId: tenant.id, telegramId } },
        create: {
          tenantId: tenant.id,
          telegramId,
          telegramUsername: verified.user.username ?? null,
          fullName: fullName || null,
          language: verified.user.language_code?.slice(0, 10) ?? 'uz',
          // Telegram does not give us a phone; it is collected at checkout.
          phone: `tg:${telegramId}`,
        },
        update: {
          telegramUsername: verified.user.username ?? null,
          ...(fullName ? { fullName } : {}),
        },
      }),
    );

    if (customer.isBlocked) {
      throw AppException.forbidden('This account has been blocked');
    }

    const tokens = await this.tokens.issuePair(
      {
        userId: customer.id,
        tenantId: tenant.id,
        roles: ['CUSTOMER'],
        permissions: [],
        branchIds: [],
      },
      context,
    );

    return {
      tokens,
      user: {
        id: customer.id,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        phone: customer.phone,
        email: customer.email,
        fullName: customer.fullName ?? 'Guest',
        avatarUrl: verified.user.photo_url ?? null,
        roles: ['CUSTOMER'],
        permissions: [],
        branchIds: [],
        isSuperAdmin: false,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Session lifecycle                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Exchanges a refresh token for a new pair.
   *
   * The permission set is rebuilt from the database rather than copied from
   * the old token, so a role change takes effect on the next refresh.
   */
  async refresh(refreshToken: string, context: IssueContext): Promise<TokenPair> {
    const { userId } = await this.tokens.verifyRefreshToken(refreshToken);

    const user = await runUnscoped(() =>
      this.prisma.db.user.findUnique({ where: { id: userId }, include: USER_WITH_ACCESS }),
    );

    if (!user || !user.isActive || user.deletedAt) {
      await this.tokens.revokeAllForUser(userId);
      throw AppException.unauthorized('This account is no longer active', ErrorCode.USER_INACTIVE);
    }

    this.assertTenantUsable(user.tenant);

    const claims = this.buildClaims(user);
    const tokens = await this.tokens.issuePair(claims, context);
    await this.tokens.rotate(refreshToken, tokens.refreshToken);

    return tokens;
  }

  async logout(refreshToken: string | undefined, userId: string): Promise<void> {
    if (refreshToken) {
      await this.tokens.revoke(refreshToken);
    } else {
      // No token supplied (e.g. the app lost it): end every session instead.
      await this.tokens.revokeAllForUser(userId);
    }

    await this.audit.record({ action: AuditAction.LOGOUT, entity: 'User', entityId: userId });
  }

  /** `/auth/me` — identity plus the flattened permission set. */
  async me(userId: string): Promise<AuthenticatedUser> {
    const user = await runUnscoped(() =>
      this.prisma.db.user.findUnique({ where: { id: userId }, include: USER_WITH_ACCESS }),
    );

    if (!user) throw AppException.notFound('User');

    return this.toAuthenticatedUser(user);
  }

  /**
   * Changes the caller's own password and ends every other session.
   *
   * Revoking is the point: if the password is being changed because it leaked,
   * leaving old sessions alive would defeat the change.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await runUnscoped(() =>
      this.prisma.db.user.findUnique({ where: { id: userId } }),
    );
    if (!user) throw AppException.notFound('User');

    const matches = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!matches) {
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Current password is incorrect', 400);
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await runUnscoped(() =>
      this.prisma.db.user.update({ where: { id: userId }, data: { passwordHash } }),
    );

    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({
      action: AuditAction.PASSWORD_CHANGED,
      entity: 'User',
      entityId: userId,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Finds a user by phone or email.
   *
   * Without `tenantSlug` the lookup must be unambiguous: the same phone may
   * legitimately belong to staff at two restaurants, and guessing which one
   * would silently sign someone into the wrong company.
   */
  private async findUserForAuth(login: string, tenantSlug?: string) {
    const isEmail = login.includes('@');
    const phone = isEmail ? null : normalizePhone(login);

    if (!isEmail && !phone) {
      return null;
    }

    const tenantFilter = tenantSlug ? { tenant: { slug: tenantSlug } } : {};

    const matches = await this.prisma.db.user.findMany({
      where: {
        deletedAt: null,
        ...(isEmail ? { email: login.toLowerCase() } : { phone: phone! }),
        ...tenantFilter,
      },
      include: USER_WITH_ACCESS,
      take: 2,
    });

    if (matches.length === 0) return null;

    if (matches.length > 1) {
      throw new AppException(
        ErrorCode.BAD_REQUEST,
        'This login belongs to several restaurants. Include your restaurant to continue.',
        400,
        { tenantSlug: ['Required when the same login exists in multiple restaurants'] },
      );
    }

    return matches[0]!;
  }

  private async createSession(
    user: UserWithAccess,
    context: IssueContext,
  ): Promise<AuthSession> {
    const claims = this.buildClaims(user);
    const tokens = await this.tokens.issuePair(claims, context);
    return { tokens, user: this.toAuthenticatedUser(user) };
  }

  /** Flattens roles → permissions and collects branch scoping. */
  private buildClaims(user: UserWithAccess): AccessTokenClaims {
    const permissions = new Set<Permission>();
    const roles: string[] = [];
    const branchIds = new Set<string>();
    let hasUnscopedRole = false;

    for (const link of user.roles) {
      roles.push(link.role.code);
      for (const rp of link.role.permissions) {
        permissions.add(rp.permission.code as Permission);
      }
      // A role with no branch means "every branch"; one such role is enough.
      if (link.branchId) branchIds.add(link.branchId);
      else hasUnscopedRole = true;
    }

    return {
      userId: user.id,
      tenantId: user.tenantId,
      roles,
      permissions: [...permissions],
      branchIds: hasUnscopedRole ? [] : [...branchIds],
      courierId: user.courier?.id,
    };
  }

  private toAuthenticatedUser(user: UserWithAccess): AuthenticatedUser {
    const claims = this.buildClaims(user);

    return {
      id: user.id,
      tenantId: user.tenantId,
      tenantSlug: user.tenant?.slug ?? null,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      roles: claims.roles,
      permissions: claims.permissions,
      branchIds: claims.branchIds,
      isSuperAdmin: claims.roles.includes(SystemRole.SUPER_ADMIN),
    };
  }

  /** Counts a failed attempt and locks the account once the limit is hit. */
  private async registerFailedAttempt(userId: string, currentAttempts: number): Promise<void> {
    const { maxFailedAttempts, lockoutMinutes } = this.config.auth;
    const attempts = currentAttempts + 1;

    await runUnscoped(() =>
      this.prisma.db.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: attempts,
          ...(attempts >= maxFailedAttempts
            ? { lockedUntil: new Date(Date.now() + lockoutMinutes * 60_000) }
            : {}),
        },
      }),
    );
  }

  private assertTenantUsable(
    tenant: { status: TenantStatus | string } | null | undefined,
  ): void {
    // Platform staff have no tenant and are unaffected by tenant status.
    if (!tenant) return;

    if (tenant.status === TenantStatus.BLOCKED || tenant.status === TenantStatus.SUSPENDED) {
      throw new AppException(
        ErrorCode.TENANT_BLOCKED,
        'This restaurant account is suspended. Contact support.',
        403,
      );
    }
  }

  /** Tenant's own bot token, decrypted; `undefined` falls back to the platform bot. */
  private async resolveBotToken(tenantId: string): Promise<string | undefined> {
    const config = await runUnscoped(() =>
      this.prisma.db.telegramConfig.findFirst({
        where: { tenantId, branchId: null, isActive: true },
        select: { botTokenEncrypted: true },
      }),
    );

    return this.encryption.tryDecrypt(config?.botTokenEncrypted) ?? undefined;
  }

  private invalidCredentials(): AppException {
    return new AppException(
      ErrorCode.INVALID_CREDENTIALS,
      'Incorrect login or password',
      401,
    );
  }
}

/** Masks a login for the audit log — the attempt matters, the number does not. */
function maskLogin(login: string): string {
  if (login.includes('@')) {
    const [name, domain] = login.split('@');
    return `${name?.slice(0, 2)}***@${domain}`;
  }
  return `***${login.slice(-2)}`;
}
