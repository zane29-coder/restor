import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import {
  ErrorCode,
  type JwtAccessPayload,
  type JwtRefreshPayload,
  type Permission,
  type TokenPair,
} from '@restor/shared-types';
import { AppConfig } from '../../config/configuration';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../database/prisma.service';
import { runUnscoped } from '../../common/context/request-context';

export interface AccessTokenClaims {
  userId: string;
  tenantId: string | null;
  roles: string[];
  permissions: Permission[];
  branchIds: string[];
  courierId?: string;
}

export interface IssueContext {
  ip?: string;
  userAgent?: string;
  deviceId?: string;
}

/**
 * Issues, rotates and revokes tokens (TZ §52).
 *
 * Access tokens are short-lived and stateless: the permission set is baked in,
 * so authorising a request costs no database round trip. The trade-off is that
 * a permission change takes effect at the next refresh, which is why the
 * access TTL is 15 minutes by default.
 *
 * Refresh tokens are stateful and stored HASHED. A database dump therefore
 * does not hand out live sessions, and a stolen token can be revoked.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async issuePair(claims: AccessTokenClaims, context: IssueContext = {}): Promise<TokenPair> {
    const { accessSecret, refreshSecret, accessTtl, refreshTtl } = this.config.auth;
    const jti = randomUUID();

    const accessPayload: Omit<JwtAccessPayload, 'iat' | 'exp'> = {
      sub: claims.userId,
      tenantId: claims.tenantId,
      roles: claims.roles,
      permissions: claims.permissions,
      branchIds: claims.branchIds,
      courierId: claims.courierId,
      typ: 'access',
    };

    const refreshPayload: Omit<JwtRefreshPayload, 'iat' | 'exp'> = {
      sub: claims.userId,
      jti,
      typ: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, { secret: accessSecret, expiresIn: accessTtl }),
      this.jwt.signAsync(refreshPayload, { secret: refreshSecret, expiresIn: refreshTtl }),
    ]);

    await this.storeRefreshToken(claims.userId, refreshToken, context);

    return {
      accessToken,
      refreshToken,
      expiresIn: parseDurationSeconds(accessTtl),
      tokenType: 'Bearer',
    };
  }

  /**
   * Verifies a refresh token and returns the user it belongs to.
   *
   * Rejects tokens that were revoked or already rotated. A presented token
   * whose row carries `replacedByTokenHash` means someone is replaying an old
   * token — every session for that user is killed rather than just this one.
   */
  async verifyRefreshToken(token: string): Promise<{ userId: string; tokenId: string }> {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtRefreshPayload>(token, {
        secret: this.config.auth.refreshSecret,
      });
    } catch {
      throw AppException.unauthorized('Invalid refresh token', ErrorCode.TOKEN_INVALID);
    }

    if (payload.typ !== 'refresh') {
      throw AppException.unauthorized('Wrong token type', ErrorCode.TOKEN_INVALID);
    }

    const tokenHash = hashToken(token);

    // Refresh happens before a tenant is known, so this lookup runs unscoped.
    const stored = await runUnscoped(() =>
      this.prisma.db.refreshToken.findUnique({ where: { tokenHash } }),
    );

    if (!stored) {
      throw AppException.unauthorized('Refresh token not recognised', ErrorCode.REFRESH_TOKEN_REVOKED);
    }

    if (stored.revokedAt) {
      if (stored.replacedByTokenHash) {
        // Replay of an already-rotated token: assume the token was stolen.
        await this.revokeAllForUser(stored.userId);
      }
      throw AppException.unauthorized('Refresh token has been revoked', ErrorCode.REFRESH_TOKEN_REVOKED);
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw AppException.unauthorized('Refresh token has expired', ErrorCode.TOKEN_EXPIRED);
    }

    return { userId: stored.userId, tokenId: stored.id };
  }

  /** Marks the old token as replaced by the new one. */
  async rotate(oldToken: string, newToken: string): Promise<void> {
    await runUnscoped(() =>
      this.prisma.db.refreshToken.updateMany({
        where: { tokenHash: hashToken(oldToken), revokedAt: null },
        data: { revokedAt: new Date(), replacedByTokenHash: hashToken(newToken) },
      }),
    );
  }

  async revoke(token: string): Promise<void> {
    await runUnscoped(() =>
      this.prisma.db.refreshToken.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  /** Kills every session for a user — password change, or a detected replay. */
  async revokeAllForUser(userId: string): Promise<void> {
    await runUnscoped(() =>
      this.prisma.db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  /** Housekeeping: drops rows that can no longer authenticate anything. */
  async pruneExpired(): Promise<number> {
    const result = await runUnscoped(() =>
      this.prisma.db.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
    );
    return result.count;
  }

  private async storeRefreshToken(
    userId: string,
    token: string,
    context: IssueContext,
  ): Promise<void> {
    const decoded = this.jwt.decode(token) as JwtRefreshPayload;

    await runUnscoped(() =>
      this.prisma.db.refreshToken.create({
        data: {
          userId,
          tokenHash: hashToken(token),
          expiresAt: new Date(decoded.exp * 1000),
          ip: context.ip?.slice(0, 64),
          userAgent: context.userAgent?.slice(0, 500),
          deviceId: context.deviceId?.slice(0, 128),
        },
      }),
    );
  }
}

/** SHA-256 hex. Refresh tokens are high-entropy, so no salt is needed. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Parses `15m`, `30d`, `3600` into seconds. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*([smhdw]?)$/i.exec(value.trim());
  if (!match) return 900;

  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86_400,
    w: 604_800,
  };

  return amount * (multipliers[unit] ?? 1);
}
