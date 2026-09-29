import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  TelegramEvent,
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

    return toConfig(row);
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
