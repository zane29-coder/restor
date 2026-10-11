import { ErrorCode } from '@restor/shared-types';
import { getContext, runUnscoped } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import type { PrismaService } from '../../database/prisma.service';

/** Who is asking, as established by the verified customer token. */
export interface CustomerSession {
  /** This restaurant's `Customer` row. */
  customerId: string;
  /** The RESTOR-wide account behind it. */
  accountId: string;
  /** The restaurant this Mini App session is for. */
  tenantId: string;
}

/**
 * The storefront's only way to learn who the customer is.
 *
 * Everything comes from the request context, which the JWT guard filled from
 * a signed token — never from a body, a query string or a header. The
 * account models are not tenant-scoped, so this id IS their isolation: every
 * query on them filters on `session.accountId`.
 *
 * Tokens issued before accounts existed carry no `accountId`; it is looked
 * up from the customer row once, which a refresh then bakes in.
 */
export async function requireCustomerSession(prisma: PrismaService): Promise<CustomerSession> {
  const ctx = getContext();
  if (!ctx?.customerId || !ctx.tenantId) {
    throw new AppException(
      ErrorCode.CUSTOMER_SESSION_REQUIRED,
      'Davom etish uchun ilovaga qayta kiring',
      401,
    );
  }

  let accountId = ctx.customerAccountId;
  if (!accountId) {
    const row = await runUnscoped(() =>
      prisma.db.customer.findFirst({
        where: { id: ctx.customerId, tenantId: ctx.tenantId },
        select: { accountId: true },
      }),
    );
    accountId = row?.accountId ?? undefined;
  }

  if (!accountId) {
    throw new AppException(
      ErrorCode.CUSTOMER_SESSION_REQUIRED,
      'Davom etish uchun ilovaga qayta kiring',
      401,
    );
  }

  return { customerId: ctx.customerId, accountId, tenantId: ctx.tenantId };
}
