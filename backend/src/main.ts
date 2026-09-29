import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import compression from 'compression';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * API entry point (TZ §42).
 *
 * Everything is served under `/api/v1`, so a future v2 can live alongside v1
 * rather than replacing it in place.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // The body must survive verbatim to verify payment webhook signatures,
    // so the raw buffer is kept alongside the parsed JSON.
    rawBody: true,
  });

  app.useLogger(app.get(PinoLogger));
  const config = app.get(AppConfig);

  app.setGlobalPrefix('api/v1', {
    // Probes stay at the root so a load balancer does not need to know the
    // API version to check health.
    exclude: ['health', 'health/ready'],
  });

  /** Secure headers (TZ §52). */
  app.use(
    helmet({
      // The API serves JSON, not HTML; CSP belongs on the web apps.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // TLS terminates at the reverse proxy, so the proxy owns HSTS. Leaving
      // it on here emits a second, differently-configured header on every
      // proxied response.
      strictTransportSecurity: false,
    }),
  );
  app.use(compression());

  /**
   * CORS (TZ §52). The allowed origins are validated at boot, and production
   * refuses a wildcard.
   */
  app.enableCors({
    origin: config.isProduction
      ? config.corsOrigins
      : (origin, callback) => callback(null, true),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
      // How the public storefront names its restaurant (TZ §47).
      'X-Tenant-Slug',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.useGlobalFilters(new AllExceptionsFilter(config.isProduction));
  app.enableShutdownHooks();

  /** OpenAPI, from which the typed client can be regenerated (TZ §44). */
  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('RESTOR API')
        .setDescription(
          'Single backend for every RESTOR client: admin web, customer web, ' +
            'Telegram Mini App, POS, Kitchen Display and the courier app.',
        )
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
        .addServer(`${config.apiBaseUrl}/api/v1`)
        .build(),
    );

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(config.port, '0.0.0.0');

  const logger = app.get(PinoLogger);
  logger.log(`RESTOR API listening on port ${config.port} (${config.nodeEnv})`);
  if (!config.isProduction) {
    logger.log(`OpenAPI docs: ${config.apiBaseUrl}/api/docs`);
  }
}

void bootstrap();
