import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditAction } from '@restor/shared-types';
import { normalizePagination, paginated } from '@restor/shared-utils';
import { PrismaService } from '../../database/prisma.service';
import { getContext, runUnscoped } from '../../common/context/request-context';

export interface AuditEntry {
  action: AuditAction | string;
  entity: string;
  entityId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  /** Overrides the tenant from the request context (platform-level actions). */
  tenantId?: string | null;
  userId?: string | null;
}

/** Field names whose values must never reach the audit log (TZ §59). */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'botToken',
  'botTokenEncrypted',
  'secret',
  'clickSecret',
  'paymeSecret',
  's3SecretKey',
  'encryptionKey',
  'qrToken',
]);

/**
 * Append-only audit trail (TZ §37).
 *
 * Writes are deliberately fire-and-forget: an audit failure must never fail
 * the business operation that succeeded. The error is logged loudly instead,
 * so a broken audit pipeline is visible without taking orders down with it.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records an action. Never throws. */
  async record(entry: AuditEntry): Promise<void> {
    const ctx = getContext();

    try {
      // Runs unscoped because platform actions (blocking a tenant) are logged
      // against a tenant the actor does not belong to.
      await runUnscoped(() =>
        this.prisma.db.auditLog.create({
          data: {
            tenantId: entry.tenantId !== undefined ? entry.tenantId : (ctx?.tenantId ?? null),
            userId: entry.userId !== undefined ? entry.userId : (ctx?.userId ?? null),
            action: entry.action,
            entity: entry.entity,
            entityId: entry.entityId ?? null,
            // `Prisma.JsonNull` writes a SQL JSON null; a bare `null` would be
            // rejected for a nullable Json column.
            oldValue: redact(entry.oldValue) ?? Prisma.JsonNull,
            newValue: redact(entry.newValue) ?? Prisma.JsonNull,
            ip: ctx?.ip?.slice(0, 64) ?? null,
            device: ctx?.userAgent?.slice(0, 255) ?? null,
            requestId: ctx?.requestId ?? null,
          },
        }),
      );
    } catch (error) {
      this.logger.error(
        { err: error, action: entry.action, entity: entry.entity },
        'Failed to write audit log',
      );
    }
  }

  /**
   * Records a change, keeping only the fields that actually differ.
   *
   * Storing whole rows makes the log unreadable; a diff answers "who changed
   * this price and from what" at a glance.
   */
  async recordChange(
    action: AuditAction | string,
    entity: string,
    entityId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    const changedOld: Record<string, unknown> = {};
    const changedNew: Record<string, unknown> = {};

    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!deepEqual(before[key], after[key])) {
        changedOld[key] = before[key];
        changedNew[key] = after[key];
      }
    }

    if (Object.keys(changedNew).length === 0) return;

    await this.record({
      action,
      entity,
      entityId,
      oldValue: changedOld,
      newValue: changedNew,
    });
  }

  async list(query: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    entity?: string;
    entityId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const page = normalizePagination(query);

    const where = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: { user: { select: { id: true, fullName: true } } },
      }),
      this.prisma.db.auditLog.count({ where }),
    ]);

    return paginated(
      items.map((item) => ({
        ...item,
        userName: item.user?.fullName ?? null,
        user: undefined,
      })),
      total,
      page,
    );
  }
}

/** Replaces secret values with a marker, recursively. */
function redact(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonObject | null {
  if (!value) return null;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key)) {
      out[key] = '[redacted]';
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      out[key] = redact(entry as Record<string, unknown>);
    } else {
      out[key] = entry;
    }
  }
  return out as Prisma.InputJsonObject;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
