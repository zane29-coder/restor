import { Injectable } from '@nestjs/common';
import { formatOrderNumber } from '@restor/shared-utils';
import type { PrismaTransaction } from '../../database/prisma.service';

/**
 * Per-branch sequential order numbers (TZ §41).
 *
 * The UUID primary key is internal; this is the number staff and customers say
 * out loud. It must be gap-tolerant but never duplicated: two tills taking an
 * order in the same millisecond must not both print `#1054`.
 *
 * The counter is bumped with a single atomic `UPDATE … SET last_number =
 * last_number + 1 RETURNING`, executed inside the order's own transaction.
 * Postgres takes a row lock for the duration, so concurrent callers serialise
 * on that one row rather than racing a read-then-write.
 */
@Injectable()
export class OrderNumberService {
  /**
   * Reserves the next number for a branch.
   *
   * MUST be called inside the transaction that creates the order: if the order
   * insert later fails, the counter increment rolls back with it and the
   * number is reused rather than burned.
   *
   * @param periodKey `"ALL"` for a sequence that never resets, or a date like
   *                  `"2026-09-29"` for branches that restart numbering daily.
   */
  async next(
    tx: PrismaTransaction,
    branchId: string,
    periodKey = 'ALL',
  ): Promise<number> {
    // Upsert-then-increment in one statement. `ON CONFLICT DO UPDATE` makes the
    // very first order of a branch safe against two concurrent creators.
    const rows = await tx.$queryRaw<Array<{ last_number: number }>>`
      INSERT INTO order_sequences (id, "branchId", "periodKey", "lastNumber", "updatedAt")
      VALUES (gen_random_uuid(), ${branchId}::uuid, ${periodKey}, 1, NOW())
      ON CONFLICT ("branchId", "periodKey")
      DO UPDATE SET "lastNumber" = order_sequences."lastNumber" + 1, "updatedAt" = NOW()
      RETURNING "lastNumber" AS last_number
    `;

    const value = rows[0]?.last_number;
    if (value === undefined) {
      throw new Error(`Failed to reserve an order number for branch ${branchId}`);
    }

    return Number(value);
  }

  /** `1054` + `CH` → `CH-1054`; without a prefix → `#1054` (TZ §41). */
  format(number: number, branchPrefix: string | null): string {
    return formatOrderNumber(number, branchPrefix);
  }

  /** Date key in the branch's timezone, for daily-reset numbering. */
  periodKeyFor(timezone: string, date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}
