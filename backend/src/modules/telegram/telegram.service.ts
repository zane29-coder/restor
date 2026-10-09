import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  TelegramEvent,
  type TelegramBotStatus,
  type TelegramConfig,
  type TelegramRoute,
} from '@restor/shared-types';
import type { TelegramConfigInput, TelegramRouteInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { getContext, runUnscoped } from '../../common/context/request-context';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TelegramApiClient } from '../../integrations/telegram/telegram-api.client';
import { buildTestMessage } from '../../integrations/telegram/message.builder';
import { miniAppUrlFor } from '../../integrations/telegram/bot-reply.builder';
import { AppConfig } from '../../config/configuration';
import { TelegramWebhookService } from './telegram-webhook.service';

const CONFIG_INCLUDE = { routes: { orderBy: { event: 'asc' } } } as const;

/**
 * Telegram configuration and routing (TZ §15).
 *
 * A tenant may run the platform bot or its own. Either way the token is stored
 * encrypted and never returned by the API — a leaked bot token lets anyone
 * impersonate the restaurant's bot, post to its groups and read its messages.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly api: TelegramApiClient,
    private readonly config: AppConfig,
    private readonly webhook: TelegramWebhookService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Configuration                                                      */
  /* ------------------------------------------------------------------ */

  async getConfig(branchId?: string): Promise<TelegramConfig | null> {
    const row = await this.prisma.db.telegramConfig.findFirst({
      where: { branchId: branchId ?? null },
      include: CONFIG_INCLUDE,
    });

    return row ? toConfig(row) : null;
  }

  /**
   * Creates or updates the config for a tenant (or one of its branches).
   *
   * An omitted `botToken` leaves the stored one untouched, so saving the chat
   * id does not require re-typing a token the UI never showed.
   */
  async saveConfig(input: TelegramConfigInput): Promise<TelegramConfig> {
    const tenantId = this.requireTenant();

    let botUsername = input.botUsername ?? null;
    let encrypted: string | undefined;

    if (input.botToken) {
      // Verify before storing: a typo'd token should fail here, not silently
      // break every notification an hour later.
      const me = await this.api.getMe(input.botToken).catch(() => {
        throw AppException.badRequest('Telegram rejected this bot token');
      });

      botUsername = me.username;
      encrypted = this.encryption.encrypt(input.botToken);
    }

    const existing = await this.prisma.db.telegramConfig.findFirst({
      where: { branchId: input.branchId ?? null },
      select: { id: true },
    });

    const row = existing
      ? await this.prisma.db.telegramConfig.update({
          where: { id: existing.id },
          data: {
            ...(encrypted ? { botTokenEncrypted: encrypted } : {}),
            ...(botUsername !== null ? { botUsername } : {}),
            defaultChatId: input.defaultChatId ?? null,
            isActive: input.isActive,
          },
          include: CONFIG_INCLUDE,
        })
      : await this.prisma.db.telegramConfig.create({
          data: {
            tenantId,
            branchId: input.branchId ?? null,
            botTokenEncrypted: encrypted ?? null,
            botUsername,
            defaultChatId: input.defaultChatId ?? null,
            isActive: input.isActive,
          },
          include: CONFIG_INCLUDE,
        });

    await this.audit.record({
      action: AuditAction.TELEGRAM_CONFIG_CHANGED,
      entity: 'TelegramConfig',
      entityId: row.id,
      // The token itself is on the redaction list in AuditService.
      newValue: {
        branchId: input.branchId ?? null,
        botUsername,
        defaultChatId: input.defaultChatId ?? null,
        tokenChanged: Boolean(input.botToken),
      },
    });

    // Saving a token is how a bot is meant to start working, so pointing
    // Telegram at us belongs here and not behind a second button nobody knows
    // to press. Best-effort: Telegram being unreachable for a moment must not
    // lose the token that was just typed — `getBotStatus` then says so.
    await this.syncWebhook(row.id, input.botToken, row.botTokenEncrypted, row.isActive);

    return toConfig(row);
  }

  /**
   * Keeps Telegram's idea of this bot's webhook in step with the config.
   *
   * An inactive config gets its webhook removed rather than left pointing here:
   * a bot that still delivers to a deployment that will ignore it looks, from
   * Telegram's side, exactly like a healthy one.
   */
  private async syncWebhook(
    configId: string,
    submittedToken: string | undefined,
    storedToken: string | null,
    isActive: boolean,
  ): Promise<void> {
    const token = submittedToken ?? this.encryption.tryDecrypt(storedToken);
    if (!token) return;

    if (!isActive) {
      await this.webhook.unregister(token).catch((error: unknown) => {
        this.logger.warn({ configId, err: error }, 'Could not remove the Telegram webhook');
      });
      return;
    }

    await this.webhook.tryRegister(configId, token);
  }

  /**
   * Everything needed to answer "why is the bot silent?" in one call.
   *
   * Deliberately not folded into `getConfig`: it costs two Telegram round
   * trips, and the settings screen reads the config on every branch switch.
   *
   * The comparison that matters is `webhookUrl` against `expectedWebhookUrl`.
   * A token pasted into two deployments is the common case — Telegram allows
   * exactly one webhook per bot, so the second registration silently steals the
   * first's updates, and the bot looks broken on whichever side lost.
   */
  async getBotStatus(branchId?: string): Promise<TelegramBotStatus> {
    const tenantId = this.requireTenant();

    const row = await this.prisma.db.telegramConfig.findFirst({
      where: { branchId: branchId ?? null },
      select: { id: true, botUsername: true, botTokenEncrypted: true, isActive: true },
    });

    const tenant = await runUnscoped(() =>
      this.prisma.db.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }),
    );

    const miniAppUrl = miniAppUrlFor(this.config.telegram.miniAppUrl, tenant?.slug ?? 'demo');

    const base: TelegramBotStatus = {
      hasToken: Boolean(row?.botTokenEncrypted),
      isActive: row?.isActive ?? false,
      botUsername: row?.botUsername ?? null,
      botLink: row?.botUsername ? `https://t.me/${row.botUsername}` : null,
      miniAppUrl,
      expectedWebhookUrl: row ? this.webhook.urlFor(row.id) : '',
      webhookUrl: null,
      isConnected: false,
      pendingUpdateCount: 0,
      lastErrorAt: null,
      lastErrorMessage: null,
      message: 'Bot hali ulanmagan',
    };

    if (!row?.botTokenEncrypted) return base;

    if (!row.isActive) {
      return { ...base, message: 'Bot oʻchirilgan' };
    }

    const token = this.encryption.tryDecrypt(row.botTokenEncrypted);
    if (!token) {
      return {
        ...base,
        message: 'Saqlangan tokenni oʻqib boʻlmadi — tokenni qaytadan kiriting',
      };
    }

    try {
      const [me, info] = await Promise.all([
        this.api.getMe(token),
        this.webhook.describe(token),
      ]);

      const isConnected = info.url === base.expectedWebhookUrl;

      return {
        ...base,
        botUsername: me.username,
        botLink: `https://t.me/${me.username}`,
        webhookUrl: info.url,
        isConnected,
        pendingUpdateCount: info.pendingUpdateCount,
        lastErrorAt: info.lastErrorAt,
        lastErrorMessage: info.lastErrorMessage,
        message: describeConnection(isConnected, info.url, this.webhook.canReceiveUpdates),
      };
    } catch (error) {
      return {
        ...base,
        message:
          error instanceof Error
            ? `Telegram javob bermadi: ${error.message}`
            : 'Telegram javob bermadi',
      };
    }
  }

  /**
   * Re-points the bot at this deployment.
   *
   * Unlike the save path this reports failure to the caller: an admin pressing
   * "connect" is watching, and needs Telegram's own words — a revoked token, a
   * certificate Telegram would not accept — not a silent no-op.
   */
  async connectBot(branchId?: string): Promise<TelegramBotStatus> {
    // Explicit, and not only for the error message: platform staff carry
    // `bypassTenantScope`, so without a tenant in context the query below
    // would happily return the first config of ANY restaurant and connect
    // someone else's bot.
    this.requireTenant();

    const row = await this.prisma.db.telegramConfig.findFirst({
      where: { branchId: branchId ?? null },
      select: { id: true, botTokenEncrypted: true, isActive: true },
    });

    if (!row?.botTokenEncrypted) {
      throw AppException.badRequest('Avval bot tokenini kiriting');
    }
    if (!row.isActive) {
      throw AppException.badRequest('Bot oʻchirilgan — avval uni yoqing');
    }

    const token = this.encryption.tryDecrypt(row.botTokenEncrypted);
    if (!token) {
      throw AppException.badRequest('Saqlangan tokenni oʻqib boʻlmadi — qaytadan kiriting');
    }

    try {
      await this.webhook.register(row.id, token);
    } catch (error) {
      throw AppException.badRequest(
        error instanceof Error ? error.message : 'Webhook ulanmadi',
      );
    }

    await this.audit.record({
      action: AuditAction.TELEGRAM_CONFIG_CHANGED,
      entity: 'TelegramConfig',
      entityId: row.id,
      newValue: { webhookUrl: this.webhook.urlFor(row.id) },
    });

    return this.getBotStatus(branchId);
  }

  /* ------------------------------------------------------------------ */
  /* Routes                                                             */
  /* ------------------------------------------------------------------ */

  async listRoutes(branchId?: string): Promise<TelegramRoute[]> {
    const rows = await this.prisma.db.telegramRoute.findMany({
      where: {
        config: { tenantId: this.requireTenant() },
        ...(branchId !== undefined ? { branchId: branchId || null } : {}),
      },
      orderBy: { event: 'asc' },
    });

    return rows.map(toRoute);
  }

  /** Creates or replaces the route for one event at one branch. */
  async upsertRoute(input: TelegramRouteInput): Promise<TelegramRoute> {
    const config = await this.prisma.db.telegramConfig.findFirst({
      where: { branchId: input.branchId ?? null },
      select: { id: true },
    });

    if (!config) {
      throw AppException.badRequest(
        'Configure the bot for this branch before adding routes',
      );
    }

    const existing = await this.prisma.db.telegramRoute.findFirst({
      where: { configId: config.id, event: input.event, branchId: input.branchId ?? null },
      select: { id: true },
    });

    const row = existing
      ? await this.prisma.db.telegramRoute.update({
          where: { id: existing.id },
          data: {
            chatId: input.chatId,
            topicId: input.topicId ?? null,
            isActive: input.isActive,
          },
        })
      : await this.prisma.db.telegramRoute.create({
          data: {
            configId: config.id,
            branchId: input.branchId ?? null,
            event: input.event,
            chatId: input.chatId,
            topicId: input.topicId ?? null,
            isActive: input.isActive,
          },
        });

    await this.audit.record({
      action: AuditAction.TELEGRAM_CONFIG_CHANGED,
      entity: 'TelegramRoute',
      entityId: row.id,
      newValue: { event: input.event, chatId: input.chatId, topicId: input.topicId ?? null },
    });

    return toRoute(row);
  }

  async deleteRoute(id: string): Promise<void> {
    const route = await this.prisma.db.telegramRoute.findFirst({
      where: { id, config: { tenantId: this.requireTenant() } },
      select: { id: true, event: true },
    });
    if (!route) throw AppException.notFound('Telegram route');

    await this.prisma.db.telegramRoute.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.TELEGRAM_CONFIG_CHANGED,
      entity: 'TelegramRoute',
      entityId: id,
      oldValue: { event: route.event },
    });
  }

  /**
   * Sends a probe to a chat/topic so an admin can confirm the routing before
   * a real order depends on it.
   *
   * Sends SYNCHRONOUSLY, bypassing the queue: the admin is watching the button
   * and needs the actual error ("bot is not a member of the chat") rather than
   * a job id.
   */
  async testRoute(input: {
    chatId: string;
    topicId?: number | null;
    branchId?: string | null;
  }): Promise<{ ok: boolean; message: string }> {
    const token = await this.resolveBotToken(this.requireTenant(), input.branchId ?? null);

    if (!token) {
      return { ok: false, message: 'Bu restoran uchun bot tokeni sozlanmagan' };
    }

    try {
      await this.api.sendMessage({
        botToken: token,
        chatId: input.chatId,
        topicId: input.topicId ?? null,
        text: buildTestMessage(TelegramEvent.NEW_ORDER),
      });
      return { ok: true, message: 'Sinov xabari yuborildi' };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Yuborib boʻlmadi',
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Used by the notifier                                               */
  /* ------------------------------------------------------------------ */

  /**
   * The bot token for a tenant, preferring a branch-specific config.
   *
   * Runs unscoped because the notifier reacts to events outside any HTTP
   * request; the tenant is taken from the event payload.
   */
  async resolveBotToken(tenantId: string, branchId: string | null): Promise<string | null> {
    const configs = await runUnscoped(() =>
      this.prisma.db.telegramConfig.findMany({
        where: {
          tenantId,
          isActive: true,
          botTokenEncrypted: { not: null },
          OR: [{ branchId }, { branchId: null }],
        },
        select: { branchId: true, botTokenEncrypted: true },
      }),
    );

    // A branch-specific bot wins over the tenant-wide one.
    const chosen =
      configs.find((config) => config.branchId === branchId) ??
      configs.find((config) => config.branchId === null);

    return this.encryption.tryDecrypt(chosen?.botTokenEncrypted);
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) {
      throw AppException.badRequest('Telegram settings belong to a restaurant; none is in scope');
    }
    return tenantId;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * The status line the settings screen shows, in Uzbek.
 *
 * The three states are genuinely different problems: no webhook at all (nobody
 * registered one), a webhook pointing somewhere else (the token is in use by a
 * second deployment, which is what silently steals the updates), and a
 * deployment Telegram cannot reach at all.
 */
function describeConnection(
  isConnected: boolean,
  currentUrl: string | null,
  canReceiveUpdates: boolean,
): string {
  if (isConnected) return 'Bot ulangan va xabarlarni qabul qilmoqda';

  if (!canReceiveUpdates) {
    return 'Server HTTPS emas — Telegram faqat HTTPS manzilga xabar yuboradi';
  }

  if (currentUrl) {
    return 'Bot boshqa serverga ulangan — "Qayta ulash" tugmasini bosing';
  }

  return 'Webhook sozlanmagan — bot javob bermaydi. "Qayta ulash" tugmasini bosing';
}

type ConfigRow = {
  id: string;
  tenantId: string;
  branchId: string | null;
  botUsername: string | null;
  botTokenEncrypted: string | null;
  defaultChatId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  routes: RouteRow[];
};

type RouteRow = {
  id: string;
  configId: string;
  branchId: string | null;
  event: string;
  chatId: string;
  topicId: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toConfig(row: ConfigRow): TelegramConfig {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    botUsername: row.botUsername,
    // Whether a token exists — never the token itself.
    hasToken: Boolean(row.botTokenEncrypted),
    defaultChatId: row.defaultChatId,
    isActive: row.isActive,
    routes: row.routes.map(toRoute),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRoute(row: RouteRow): TelegramRoute {
  return {
    id: row.id,
    configId: row.configId,
    branchId: row.branchId,
    event: row.event as TelegramEvent,
    chatId: row.chatId,
    topicId: row.topicId,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
