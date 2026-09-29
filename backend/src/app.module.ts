import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AppConfigModule } from './config/config.module';
import { AppConfig } from './config/configuration';
import { getContext } from './common/context/request-context';
import { CommonModule } from './common/common.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { TenantResolverMiddleware } from './common/middleware/tenant-resolver.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PrismaModule } from './database/prisma.module';

import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { HealthModule } from './modules/health/health.module';
import { KitchenModule } from './modules/kitchen/kitchen.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PlatformModule } from './modules/platform/platform.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { StorageModule } from './modules/storage/storage.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';

@Module({
  imports: [
    AppConfigModule,

    /**
     * Structured logging (TZ §59).
     *
     * Every line carries the request id, and the redaction list keeps
     * passwords, tokens and payment secrets out of the log entirely.
     */
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logging.level,
          genReqId: (req) =>
            (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
          autoLogging: {
            // Probes would otherwise dominate the log volume.
            ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false,
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.refreshToken',
              'req.body.initData',
              'req.body.botToken',
              'res.headers["set-cookie"]',
            ],
            censor: '[redacted]',
          },
          transport: config.logging.pretty
            ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
            : undefined,
          /** Stamps tenant and user onto every log line (TZ §59). */
          customProps: () => {
            const ctx = getContext();
            return ctx ? { tenantId: ctx.tenantId, userId: ctx.userId } : {};
          },
        },
      }),
    }),

    /** Rate limiting (TZ §52). Per-route overrides use `@Throttle`. */
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          {
            ttl: config.rateLimit.ttlSeconds * 1000,
            limit: config.rateLimit.max,
          },
        ],
      }),
    }),

    /** In-process domain events (TZ §58). */
    EventEmitterModule.forRoot({ global: true, wildcard: true, delimiter: '.' }),

    CommonModule,
    PrismaModule,

    // --- Phase 1: foundation ---
    AuthModule,
    RbacModule,
    PlatformModule,
    BranchesModule,
    EmployeesModule,
    SubscriptionsModule,
    AuditModule,
    HealthModule,

    // --- Phase 2: menu ---
    StorageModule,
    CatalogModule,

    // --- Phase 3: orders ---
    OrdersModule,
    KitchenModule,
    RealtimeModule,
  ],
  providers: [
    /**
     * Guard order matters and is the order listed here: authenticate, then
     * authorise, then rate-limit. Both auth guards are GLOBAL, so a new route
     * is protected unless it opts out with `@Public()`.
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    {
      provide: APP_INTERCEPTOR,
      inject: [Reflector],
      useFactory: (reflector: Reflector) => new ResponseInterceptor(reflector),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order matters:
    //  1. RequestContext creates the (deliberately empty) scope.
    //  2. TenantResolver fills it in for public storefront traffic.
    //  3. The auth guard then overwrites it from the JWT when there is one,
    //     so a token always wins over a header.
    // Both must run before the guards so the context exists by the time
    // anything can reach Prisma.
    consumer.apply(RequestContextMiddleware, TenantResolverMiddleware).forRoutes('*');
  }
}
