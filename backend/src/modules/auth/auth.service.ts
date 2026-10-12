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
  tenant: { select: { id: true, slug: true, name: true, status: true } },
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
    const telegramProfile = {
      telegramUsername: clip(verified.user.username, 64),
      telegramFirstName: clip(verified.user.first_name, 64),
      telegramLastName: clip(verified.user.last_name, 64),
      telegramPhotoUrl: clip(verified.user.photo_url, 2048),
    };

    // The RESTOR-wide person. A Telegram user id is the same in every bot, so
    // the account found here is the one this person used at any restaurant.
    //
    // Only the Telegram display fields are refreshed. The official name and
    // phone an order is placed under are the customer's to type — a Telegram
    // display name like "Elbek 🍕" must never silently become the name a
    // courier asks for at the door.
    const account = await runUnscoped(() =>
      this.prisma.db.customerAccount.upsert({
        where: { telegramId },
        create: {
          telegramId,
          language: verified.user.language_code?.slice(0, 10) ?? 'uz',
          ...telegramProfile,
        },
        update: telegramProfile,
      }),
    );

    if (account.deletedAt) {
      throw AppException.forbidden('Bu akkaunt oʻchirilgan');
    }

    // This restaurant's own record of the person — its CRM row, loyalty and
    // history. It learns the name and phone only when an order is placed with
    // it (see the checkout), never just because the Mini App was opened.
    const customer = await runUnscoped(() =>
      this.prisma.db.customer.upsert({
        where: { tenantId_telegramId: { tenantId: tenant.id, telegramId } },
        create: {
          tenantId: tenant.id,
          accountId: account.id,
          telegramId,
          telegramUsername: telegramProfile.telegramUsername,
          language: account.language,
          // `phone` is the restaurant's natural key and NOT NULL. A real number
          // replaces this placeholder at the first order, when there is one.
          phone: `tg:${telegramId}`,
        },
        update: {
          accountId: account.id,
          telegramUsername: telegramProfile.telegramUsername,
        },
      }),
    );

    if (customer.isBlocked) {
      throw AppException.forbidden('Ushbu restoranda buyurtma berish cheklangan');
    }

    const tokens = await this.tokens.issuePair(
      {
        userId: customer.id,
        // Without this the session row is written against `users`, whose
        // foreign key a customer id cannot satisfy — which is what made every
        // Mini App sign-in fail with a flat 400.
        subjectKind: 'CUSTOMER',
        tenantId: tenant.id,
        roles: ['CUSTOMER'],
        permissions: [],
        branchIds: [],
        accountId: account.id,
      },
      context,
    );

    const officialName = [account.firstName, account.lastName].filter(Boolean).join(' ');
    const telegramName = [account.telegramFirstName, account.telegramLastName]
      .filter(Boolean)
      .join(' ');

    return {
      tokens,
      user: {
        id: customer.id,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        phone: account.phone ?? '',
        email: account.email,
        fullName: officialName || telegramName || 'Mehmon',
        avatarUrl: account.telegramPhotoUrl,
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
    const { subject } = await this.tokens.verifyRefreshToken(refreshToken);

    const claims =
      subject.kind === 'CUSTOMER'
        ? await this.customerClaims(subject.id)
        : await this.staffClaims(subject.id);

    const tokens = await this.tokens.issuePair(claims, context);
    await this.tokens.rotate(refreshToken, tokens.refreshToken);

    return tokens;
  }

  /**
   * Rebuilt from the database, never copied from the old token, so a role
   * change takes effect on the next refresh.
   */
  private async staffClaims(userId: string): Promise<AccessTokenClaims> {
    const user = await runUnscoped(() =>
      this.prisma.db.user.findUnique({ where: { id: userId }, include: USER_WITH_ACCESS }),
    );

    if (!user || !user.isActive || user.deletedAt) {
      await this.tokens.revokeAllFor({ kind: 'USER', id: userId });
      throw AppException.unauthorized('This account is no longer active', ErrorCode.USER_INACTIVE);
    }

    this.assertTenantUsable(user.tenant);

    return this.buildClaims(user);
  }

  /**
   * A customer carries no permissions at all, so there is nothing to rebuild
   * but their continued existence — and that still has to be checked, or a
   * blocked customer would keep ordering until their access token expired.
   */
  private async customerClaims(customerId: string): Promise<AccessTokenClaims> {
    const customer = await runUnscoped(() =>
      this.prisma.db.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          tenantId: true,
          accountId: true,
          isBlocked: true,
          deletedAt: true,
          tenant: { select: { status: true, deletedAt: true } },
          account: { select: { deletedAt: true } },
        },
      }),
    );

    if (
      !customer ||
      customer.isBlocked ||
      customer.deletedAt ||
      customer.tenant.deletedAt ||
      customer.account?.deletedAt
    ) {
      await this.tokens.revokeAllFor({ kind: 'CUSTOMER', id: customerId });
      throw AppException.unauthorized('This account is no longer active', ErrorCode.USER_INACTIVE);
    }

    this.assertTenantUsable(customer.tenant);

    return {
      userId: customer.id,
      subjectKind: 'CUSTOMER',
      tenantId: customer.tenantId,
      roles: ['CUSTOMER'],
      permissions: [],
      branchIds: [],
      ...(customer.accountId ? { accountId: customer.accountId } : {}),
    };
  }

  async logout(refreshToken: string | undefined, userId: string): Promise<void> {
    if (refreshToken) {
      await this.tokens.revoke(refreshToken);
    } else {
      // No token supplied (e.g. the app lost it): end every session instead.
      // Which table the id names is unknown here, so both are swept — an id
      // only ever matches one of them.
      await this.tokens.revokeAllFor({ kind: 'USER', id: userId });
      await this.tokens.revokeAllFor({ kind: 'CUSTOMER', id: userId });
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
      subjectKind: 'USER',
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
      tenantName: user.tenant?.name ?? null,
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

/** Trims a Telegram-supplied string to the column it lands in. */
function clip(value: string | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Masks a login for the audit log — the attempt matters, the number does not. */
function maskLogin(login: string): string {
  if (login.includes('@')) {
    const [name, domain] = login.split('@');
    return `${name?.slice(0, 2)}***@${domain}`;
  }
  return `***${login.slice(-2)}`;
}
