import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '../config/configuration';
import { createTenantScopeExtension } from './tenant-scope.extension';

/**
 * Builds the extended client once.
 *
 * Kept as a free function because `$extends` returns a structurally different
 * type than `PrismaClient`, and `typeof buildClient` is how the rest of the
 * app gets the extended type without writing it out by hand.
 */
function buildClient(logQueries: boolean) {
  const base = new PrismaClient({
    log: logQueries
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ]
      : [{ emit: 'stdout', level: 'error' }],
    errorFormat: 'minimal',
  });

  return base.$extends(createTenantScopeExtension());
}

export type ExtendedPrismaClient = ReturnType<typeof buildClient>;

/**
 * The handle a `$transaction` callback receives.
 *
 * Derived from the EXTENDED client rather than using `Prisma.TransactionClient`:
 * the two are structurally different, and a helper typed against the plain
 * Prisma type would silently lose the tenant-scoping extension.
 */
export type PrismaTransaction = Parameters<
  Parameters<ExtendedPrismaClient['$transaction']>[0]
>[0];

/**
 * Database access for the whole application.
 *
 * Every query goes through the tenant-scoping extension, so a service cannot
 * accidentally read another company's rows (TZ §53). The raw, unscoped client
 * is deliberately not exposed: work that must span tenants goes through
 * `runUnscoped()` from the request context instead, which is greppable.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: ExtendedPrismaClient;

  constructor(private readonly config: AppConfig) {
    const logQueries = !config.isProduction && config.logging.level === 'trace';
    this.client = buildClient(logQueries);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** The tenant-scoped client. Use `prisma.db.order.findMany(...)`. */
  get db(): ExtendedPrismaClient {
    return this.client;
  }

  /**
   * Runs `fn` inside a transaction.
   *
   * The handle it receives is still tenant-scoped, so multi-step writes keep
   * the same isolation guarantee as single queries.
   */
  transaction<T>(
    fn: (tx: PrismaTransaction) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    return this.client.$transaction(fn, {
      timeout: options?.timeout ?? 15_000,
      maxWait: options?.maxWait ?? 5_000,
    });
  }

  /** Liveness probe for `/health`. */
  async ping(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error({ err: error }, 'Database ping failed');
      return false;
    }
  }
}
