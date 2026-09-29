import { z } from 'zod';

/**
 * Environment validation (TZ §54).
 *
 * The process refuses to boot on a bad value. Discovering at 3am under load
 * that `JWT_ACCESS_SECRET` was empty is far worse than failing loudly at
 * deploy time, so every rule here is deliberately strict.
 */

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const csvList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

/** A secret must be long enough that brute-forcing a JWT is hopeless. */
const secret = z.string().min(32, 'Secret must be at least 32 characters');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    CORS_ORIGINS: csvList,
    API_BASE_URL: z.string().url().default('http://localhost:3000'),
    CUSTOMER_WEB_URL: z.string().url().default('http://localhost:5174'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().default('redis://localhost:6379'),

    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(10),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

    /**
     * AES-256-GCM key for secrets stored in the database (tenant bot tokens,
     * provider keys). Exactly 32 bytes, base64-encoded.
     */
    ENCRYPTION_KEY: z
      .string()
      .default('')
      .refine(
        (value) => value === '' || Buffer.from(value, 'base64').length === 32,
        'ENCRYPTION_KEY must be 32 bytes encoded as base64',
      ),

    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

    STORAGE_PROVIDER: z.enum(['LOCAL', 'S3', 'MINIO']).default('LOCAL'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    STORAGE_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().max(100).default(10),
    S3_ENDPOINT: z.string().default(''),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default(''),
    S3_ACCESS_KEY: z.string().default(''),
    S3_SECRET_KEY: z.string().default(''),
    S3_FORCE_PATH_STYLE: booleanFromString.default(true),

    TELEGRAM_BOT_TOKEN: z.string().default(''),
    TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),

    CLICK_SERVICE_ID: z.string().default(''),
    CLICK_MERCHANT_ID: z.string().default(''),
    CLICK_SECRET: z.string().default(''),
    PAYME_MERCHANT_ID: z.string().default(''),
    PAYME_SECRET: z.string().default(''),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
    LOG_PRETTY: booleanFromString.default(false),
    SENTRY_DSN: z.string().default(''),

    QUEUE_PREFIX: z.string().default('restor'),
    QUEUE_WORKERS_ENABLED: booleanFromString.default(true),

    COURIER_LOCATION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  })
  .superRefine((env, ctx) => {
    // Sharing one secret would make a stolen refresh token a valid access
    // token, defeating the point of having two.
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }

    if (env.NODE_ENV === 'production') {
      if (env.CORS_ORIGINS.length === 0 || env.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: 'Production requires an explicit CORS origin list; "*" is not allowed',
        });
      }
      if (env.JWT_ACCESS_SECRET.startsWith('change-me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'The example JWT secret is still in place',
        });
      }
      if (!env.ENCRYPTION_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ENCRYPTION_KEY'],
          message: 'ENCRYPTION_KEY is required in production to store bot tokens',
        });
      }
    }

    if (env.STORAGE_PROVIDER !== 'LOCAL') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_PROVIDER is ${env.STORAGE_PROVIDER}`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Called by `ConfigModule`. Throws a readable report listing every problem. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  return result.data;
}
