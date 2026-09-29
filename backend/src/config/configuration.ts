import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

/**
 * Typed accessor over `ConfigService`.
 *
 * Services inject this instead of `ConfigService` so a typo in a key is a
 * compile error, not a silent `undefined` discovered in production.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get port(): number {
    return this.get('PORT');
  }

  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS');
  }

  get apiBaseUrl(): string {
    return this.get('API_BASE_URL');
  }

  get customerWebUrl(): string {
    return this.get('CUSTOMER_WEB_URL');
  }

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  get redisUrl(): string {
    return this.get('REDIS_URL');
  }

  get auth() {
    return {
      accessSecret: this.get('JWT_ACCESS_SECRET'),
      refreshSecret: this.get('JWT_REFRESH_SECRET'),
      accessTtl: this.get('JWT_ACCESS_TTL'),
      refreshTtl: this.get('JWT_REFRESH_TTL'),
      maxFailedAttempts: this.get('AUTH_MAX_FAILED_ATTEMPTS'),
      lockoutMinutes: this.get('AUTH_LOCKOUT_MINUTES'),
    } as const;
  }

  /** Raw 32-byte key for AES-256-GCM, or `null` when unset (dev only). */
  get encryptionKey(): Buffer | null {
    const value = this.get('ENCRYPTION_KEY');
    return value ? Buffer.from(value, 'base64') : null;
  }

  get rateLimit() {
    return {
      ttlSeconds: this.get('RATE_LIMIT_TTL_SECONDS'),
      max: this.get('RATE_LIMIT_MAX'),
    } as const;
  }

  get storage() {
    return {
      provider: this.get('STORAGE_PROVIDER'),
      localPath: this.get('STORAGE_LOCAL_PATH'),
      maxFileSizeBytes: this.get('STORAGE_MAX_FILE_SIZE_MB') * 1024 * 1024,
      s3: {
        endpoint: this.get('S3_ENDPOINT'),
        region: this.get('S3_REGION'),
        bucket: this.get('S3_BUCKET'),
        accessKey: this.get('S3_ACCESS_KEY'),
        secretKey: this.get('S3_SECRET_KEY'),
        forcePathStyle: this.get('S3_FORCE_PATH_STYLE'),
      },
    } as const;
  }

  get telegram() {
    return {
      botToken: this.get('TELEGRAM_BOT_TOKEN'),
      webhookSecret: this.get('TELEGRAM_WEBHOOK_SECRET'),
      initDataMaxAgeSeconds: this.get('TELEGRAM_INIT_DATA_MAX_AGE_SECONDS'),
    } as const;
  }

  get payments() {
    return {
      click: {
        serviceId: this.get('CLICK_SERVICE_ID'),
        merchantId: this.get('CLICK_MERCHANT_ID'),
        secret: this.get('CLICK_SECRET'),
      },
      payme: {
        merchantId: this.get('PAYME_MERCHANT_ID'),
        secret: this.get('PAYME_SECRET'),
      },
    } as const;
  }

  get logging() {
    return {
      level: this.get('LOG_LEVEL'),
      pretty: this.get('LOG_PRETTY'),
      sentryDsn: this.get('SENTRY_DSN'),
    } as const;
  }

  get queue() {
    return {
      prefix: this.get('QUEUE_PREFIX'),
      workersEnabled: this.get('QUEUE_WORKERS_ENABLED'),
    } as const;
  }

  get courierLocationRetentionDays(): number {
    return this.get('COURIER_LOCATION_RETENTION_DAYS');
  }
}
