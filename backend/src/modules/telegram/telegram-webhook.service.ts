import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { apiUrl } from '../../common/constants';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { runUnscoped } from '../../common/context/request-context';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import {
  TelegramApiClient,
  type TelegramWebhookInfo,
} from '../../integrations/telegram/telegram-api.client';

/**
 * Where Telegram delivers a bot's updates, and whether a delivery is genuine.
 *
 * Owns the webhook half of the integration so that the two sides agree by
 * construction: the URL a bot is registered at and the URL an incoming request
 * is checked against are produced by the same two functions here.
 *
 * ## The URL
 *
 * `/api/v1/webhooks/telegram/{configId}`.
 *
 * Under `webhooks/` deliberately — nginx exempts that prefix from rate
 * limiting, for the same reason it does for payment callbacks: the sender
 * retries, and a dropped update is a customer whose /start went unanswered.
 *
 * The config id (not the tenant slug) identifies the bot, because a tenant may
 * also run a per-branch bot and this then needs no second rule. It leaks no
 * tenant name, and being a v4 UUID it is not guessable.
 *
 * ## The secret
 *
 * Per bot, derived rather than stored: `HMAC(base, "telegram-webhook:" + id)`.
 * Telegram echoes it in `X-Telegram-Bot-Api-Secret-Token` on every delivery, so
 * a request that does not carry it did not come from Telegram. Deriving means
 * no migration, no second secret to rotate, and no tenant able to learn
 * another's.
 *
 * The base is `TELEGRAM_WEBHOOK_SECRET`, falling back to `ENCRYPTION_KEY` —
 * which is not a convenience: a bot token cannot be stored at all without that
 * key, so whenever a webhook could exist, a base for its secret does too.
 */
@Injectable()
export class TelegramWebhookService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TelegramWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly encryption: EncryptionService,
    private readonly api: TelegramApiClient,
  ) {}

  /* ------------------------------------------------------------------ */
  /* URL and secret                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Built with `apiUrl` so the `/api/v1` prefix cannot be forgotten.
   *
   * It was, once, for the Subo callback: the URL advertised pointed at the
   * static site, every callback was answered 405, and the charge stayed
   * PENDING. A webhook URL without the prefix fails exactly as quietly.
   */
  urlFor(configId: string): string {
    return apiUrl(this.config.apiBaseUrl, `webhooks/telegram/${configId}`);
  }

  /** `null` when no base secret exists, which also means no webhook can be set. */
  secretFor(configId: string): string | null {
    const base = this.secretBase();
    if (!base) return null;

    return createHmac('sha256', base).update(`telegram-webhook:${configId}`).digest('hex');
  }

  /**
   * Whether a delivery carries this bot's secret.
   *
   * Constant-time, and length-checked first because `timingSafeEqual` throws on
   * a length mismatch rather than returning false.
   */
  matchesSecret(configId: string, presented: string | null | undefined): boolean {
    const expected = this.secretFor(configId);
    if (!expected || !presented) return false;

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(presented, 'utf8');

    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Telegram will not call an `http://` URL, so a dev machine cannot receive
   * updates at all. Worth knowing explicitly: it is the difference between
   * "the bot is broken" and "this is localhost".
   */
  get canReceiveUpdates(): boolean {
    return this.config.apiBaseUrl.startsWith('https://');
  }

  /* ------------------------------------------------------------------ */
  /* Registration                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Points a bot at this deployment.
   *
   * Idempotent, and quiet when nothing needs doing: `setWebhook` drops pending
   * updates, so calling it on every save would throw away a customer's /start
   * every time an admin touched an unrelated field.
   */
  async register(configId: string, botToken: string): Promise<TelegramWebhookInfo> {
    const url = this.urlFor(configId);
    const secret = this.secretFor(configId);

    if (!secret) {
      throw new Error(
        'Neither TELEGRAM_WEBHOOK_SECRET nor ENCRYPTION_KEY is set; refusing to register an unauthenticated webhook',
      );
    }

    if (!this.canReceiveUpdates) {
      throw new Error(
        `Telegram only delivers to HTTPS; API_BASE_URL is ${this.config.apiBaseUrl}`,
      );
    }

    const current = await this.api.getWebhookInfo(botToken);
    if (current.url === url) return current;

    await this.api.setWebhook(botToken, url, secret);
    this.logger.log({ configId, url }, 'Telegram webhook registered');

    // Described rather than re-read. `setWebhook` returning ok means the
    // webhook IS this URL, and `drop_pending_updates` means the queue and the
    // error history are both empty — a third round trip would only confirm
    // what the second one just did.
    return { url, pendingUpdateCount: 0, lastErrorAt: null, lastErrorMessage: null };
  }

  /** Stops delivery — for a bot being switched off or handed back. */
  async unregister(botToken: string): Promise<void> {
    await this.api.deleteWebhook(botToken);
  }

  async describe(botToken: string): Promise<TelegramWebhookInfo> {
    return this.api.getWebhookInfo(botToken);
  }

  /**
   * Best-effort registration, for the paths where a failure must not block the
   * caller: saving a config, and boot.
   *
   * A restaurant's bot token is saved by the platform admin, and Telegram being
   * briefly unreachable at that moment should not lose the token. The outcome is
   * logged, and `GET telegram/bot/status` shows the admin what actually
   * happened.
   */
  async tryRegister(configId: string, botToken: string): Promise<void> {
    try {
      await this.register(configId, botToken);
    } catch (error) {
      this.logger.warn(
        { configId, err: error instanceof Error ? error.message : error },
        'Could not register the Telegram webhook; the bot will not answer until it is',
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Re-points every configured bot at this deployment on start-up.
   *
   * Without this, a bot answers only if someone happens to re-save its token
   * after a deploy — and a webhook registered against a previous host would
   * keep pointing there, silently. Reconciling at boot makes the deployment the
   * source of truth for where updates go.
   *
   * Failures are logged per tenant and never stop the process: one revoked
   * token must not keep the API from booting.
   *
   * Deliberately NOT awaited. Nest resolves `listen()` only after this hook
   * returns, and each bot costs up to two 15-second Telegram calls — a
   * Telegram outage would otherwise hold the whole API, health probes
   * included, off the network for as long as it lasted.
   */
  onApplicationBootstrap(): void {
    // The `catch` is not decoration: an unawaited rejection terminates the
    // process on current Node, and a background task must never be able to do
    // that to a running API.
    void this.reconcileAll().catch((error: unknown) => {
      this.logger.error({ err: error }, 'Telegram webhook reconciliation failed');
    });
  }

  private async reconcileAll(): Promise<void> {
    if (!this.canReceiveUpdates) {
      this.logger.log(
        `Telegram webhooks not registered: API_BASE_URL (${this.config.apiBaseUrl}) is not HTTPS`,
      );
      return;
    }

    const configs = await runUnscoped(() =>
      this.prisma.db.telegramConfig.findMany({
        where: { isActive: true, botTokenEncrypted: { not: null } },
        select: { id: true, tenantId: true, botTokenEncrypted: true },
      }),
    ).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'Could not read Telegram configs at boot');
      return [];
    });

    let registered = 0;

    for (const config of configs) {
      const token = this.encryption.tryDecrypt(config.botTokenEncrypted);
      if (!token) {
        // Almost always a rotated ENCRYPTION_KEY: the row survives, its
        // plaintext does not. The token has to be pasted in again.
        this.logger.warn(
          { configId: config.id, tenantId: config.tenantId },
          'Stored bot token could not be decrypted; re-enter it in Admin → Telegram',
        );
        continue;
      }

      try {
        await this.register(config.id, token);
        registered += 1;
      } catch (error) {
        this.logger.warn(
          {
            configId: config.id,
            tenantId: config.tenantId,
            err: error instanceof Error ? error.message : error,
          },
          'Telegram webhook registration failed for this restaurant',
        );
      }
    }

    if (configs.length) {
      this.logger.log(`Telegram webhooks: ${registered}/${configs.length} bots registered`);
    }
  }

  /* ------------------------------------------------------------------ */

  /** See the class comment for why `ENCRYPTION_KEY` is a legitimate fallback. */
  private secretBase(): string | Buffer | null {
    return this.config.telegram.webhookSecret || this.config.encryptionKey;
  }
}
