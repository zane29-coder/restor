import { Injectable, Logger } from '@nestjs/common';
import { TenantStatus } from '@restor/shared-types';
import { runUnscoped } from '../../common/context/request-context';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { AppException } from '../../common/errors/app-exception';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import {
  buildAddedToGroupReply,
  buildChatIdReply,
  buildFallbackReply,
  buildHelpReply,
  buildStartReply,
  miniAppUrlFor,
  parseCommand,
  type BotReply,
} from '../../integrations/telegram/bot-reply.builder';
import { TelegramApiClient } from '../../integrations/telegram/telegram-api.client';
import {
  parseUpdate,
  type TelegramUpdate,
  type TelegramUpdateMessage,
} from '../../integrations/telegram/update.types';
import { TelegramWebhookService } from './telegram-webhook.service';

/** The bot that is answering, resolved from the webhook URL's config id. */
interface BotContext {
  configId: string;
  tenantId: string;
  tenantSlug: string;
  restaurantName: string;
  botToken: string;
  botUsername: string | null;
}

/**
 * The inbound half of the bot (TZ §14).
 *
 * Until this existed the bot was write-only: it posted order notifications into
 * staff groups and ignored everything anyone sent it, so pressing /start did
 * nothing at all. There was no webhook, no route for Telegram to call and no
 * command handler — the token was never the problem.
 *
 * What it answers, and nothing more:
 *
 * | Where | Message | Reply |
 * | --- | --- | --- |
 * | Private | `/start`, `/menu` | greeting + a Mini App button |
 * | Private | `/help` | what the bot does |
 * | Private | anything else | a nudge back to the button |
 * | Group | `/id` | the chat and topic id, for the routing screen |
 * | Group | added to the group | the chat id, unprompted |
 * | Group | anything else | **silence** |
 *
 * Silence in a group is a feature. A staff group is a work feed; a bot that
 * replies to chatter there makes the feed unreadable.
 *
 * Ordering itself belongs to the Mini App — see `bot-reply.builder.ts` for why
 * there is no chat-based order flow.
 */
@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly encryption: EncryptionService,
    private readonly api: TelegramApiClient,
    private readonly webhook: TelegramWebhookService,
  ) {}

  /**
   * One delivery from Telegram.
   *
   * Two failure modes, treated very differently:
   *
   *  - **A delivery we cannot authenticate throws**, and the caller answers
   *    403. Only the secret proves a request came from Telegram; a webhook URL
   *    is not a secret once anything has logged it.
   *  - **An authenticated delivery we cannot process does not throw.** Telegram
   *    retries a non-2xx and escalates to disabling the webhook, so a message
   *    whose handling is broken must not be allowed to take the whole bot down
   *    with it. It is logged and acknowledged.
   */
  async handleUpdate(
    configId: string,
    secret: string | null | undefined,
    raw: unknown,
  ): Promise<void> {
    // Checked before the database is touched: the secret is derived from the
    // config id and a server secret, so this needs no lookup and an unverified
    // caller learns nothing about whether the id exists.
    if (!this.webhook.matchesSecret(configId, secret)) {
      this.logger.warn({ configId }, 'Telegram webhook called with a bad or missing secret');
      throw AppException.forbidden('Invalid webhook secret');
    }

    const update = parseUpdate(raw);
    if (!update) {
      this.logger.warn({ configId }, 'Webhook body is not a Telegram update');
      return;
    }

    try {
      const bot = await this.resolveBot(configId);
      if (!bot) return;

      await this.dispatch(bot, update);
    } catch (error) {
      this.logger.error(
        { err: error, configId, updateId: update.update_id },
        'Failed to handle a Telegram update',
      );
    }
  }

  /* ------------------------------------------------------------------ */

  private async dispatch(bot: BotContext, update: TelegramUpdate): Promise<void> {
    // A button press: acknowledge so the client stops spinning. Nothing uses
    // inline callbacks yet, so there is no action to take.
    if (update.callback_query) {
      await this.api.answerCallbackQuery(bot.botToken, update.callback_query.id);
      return;
    }

    if (update.my_chat_member) {
      await this.onMembershipChanged(bot, update.my_chat_member);
      return;
    }

    const message = update.message ?? update.edited_message;
    if (!message) return;

    if (message.chat.type === 'private') {
      await this.onPrivateMessage(bot, message);
      return;
    }

    if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
      await this.onGroupMessage(bot, message);
    }

    // Channels are not a conversation; nothing to answer.
  }

  private async onPrivateMessage(bot: BotContext, message: TelegramUpdateMessage): Promise<void> {
    const command = parseCommand(message.text, bot.botUsername);
    const miniAppUrl = miniAppUrlFor(this.config.telegram.miniAppUrl, bot.tenantSlug);

    // `/start demo` and `/start table-7` both carry a payload we do not read
    // here: the Mini App gets the restaurant from the URL, and a deep link's
    // own payload reaches it as `start_param`.
    const reply = ((): BotReply => {
      switch (command?.name) {
        case 'start':
        case 'menu':
        case 'buyurtma':
          return buildStartReply({
            restaurantName: bot.restaurantName,
            customerName: message.from?.first_name ?? null,
            miniAppUrl,
          });
        case 'help':
        case 'yordam':
          return buildHelpReply({ restaurantName: bot.restaurantName, miniAppUrl });
        case 'id':
          return buildChatIdReply({ chatId: String(message.chat.id) });
        default:
          return buildFallbackReply({ miniAppUrl });
      }
    })();

    await this.reply(bot, message, reply);
  }

  /**
   * A group gets the ids it needs and otherwise nothing.
   *
   * `/id` is answered for anyone in the group: the value is the group's own id,
   * which every member can already read from a message link, so there is
   * nothing to protect.
   */
  private async onGroupMessage(bot: BotContext, message: TelegramUpdateMessage): Promise<void> {
    const command = parseCommand(message.text, bot.botUsername);
    if (command?.name !== 'id' && command?.name !== 'start') return;

    await this.reply(
      bot,
      message,
      buildChatIdReply({
        chatId: String(message.chat.id),
        topicId: message.message_thread_id ?? null,
        chatTitle: message.chat.title ?? null,
      }),
    );
  }

  /**
   * Announces the chat id when the bot is added to a group.
   *
   * This is the replacement for opening `getUpdates` in a browser, which was
   * the documented way to find a chat id and stops working the moment a
   * webhook exists — Telegram serves one or the other, never both.
   */
  private async onMembershipChanged(
    bot: BotContext,
    change: NonNullable<TelegramUpdate['my_chat_member']>,
  ): Promise<void> {
    const chat = change.chat;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return;

    const was = change.old_chat_member?.status;
    const now = change.new_chat_member?.status;

    // Only the transition into the group, not every later rights change:
    // promoting the bot to administrator would otherwise repeat the message.
    const joined =
      (now === 'member' || now === 'administrator') &&
      was !== 'member' &&
      was !== 'administrator';

    if (!joined) return;

    const reply = buildAddedToGroupReply({
      chatId: String(chat.id),
      chatTitle: chat.title ?? null,
    });

    await this.send(bot, String(chat.id), null, reply);
  }

  /* ------------------------------------------------------------------ */

  /** Answers in the same chat, and in the same forum topic, as the message. */
  private async reply(
    bot: BotContext,
    message: TelegramUpdateMessage,
    reply: BotReply,
  ): Promise<void> {
    await this.send(bot, String(message.chat.id), message.message_thread_id ?? null, reply);
  }

  private async send(
    bot: BotContext,
    chatId: string,
    topicId: number | null,
    reply: BotReply,
  ): Promise<void> {
    try {
      await this.api.sendMessage({
        botToken: bot.botToken,
        chatId,
        topicId,
        text: reply.text,
        replyMarkup: reply.replyMarkup,
      });
    } catch (error) {
      // A customer who blocked the bot, or a group it was removed from. Normal,
      // and not worth an error line.
      this.logger.warn(
        { tenantId: bot.tenantId, chatId, err: error instanceof Error ? error.message : error },
        'Could not deliver a bot reply',
      );
    }
  }

  /**
   * The bot behind a webhook URL.
   *
   * Unscoped, and the tenant comes from the config row rather than from
   * anything in the request: Telegram has no token of ours and no tenant
   * context exists yet. `null` whenever the bot should stay quiet — the config
   * was deleted or switched off, its token cannot be decrypted, or the
   * restaurant's account is suspended.
   */
  private async resolveBot(configId: string): Promise<BotContext | null> {
    const config = await runUnscoped(() =>
      this.prisma.db.telegramConfig.findFirst({
        where: { id: configId, isActive: true, botTokenEncrypted: { not: null } },
        select: {
          id: true,
          tenantId: true,
          botUsername: true,
          botTokenEncrypted: true,
          tenant: { select: { name: true, slug: true, status: true, deletedAt: true } },
        },
      }),
    );

    if (!config) {
      this.logger.warn({ configId }, 'Update for an unknown or inactive Telegram config');
      return null;
    }

    const { tenant } = config;

    // A suspended restaurant's bot must stop taking orders along with the rest
    // of its account, not keep handing out a menu nobody will cook.
    if (
      tenant.deletedAt ||
      tenant.status === TenantStatus.BLOCKED ||
      tenant.status === TenantStatus.SUSPENDED
    ) {
      return null;
    }

    const botToken = this.encryption.tryDecrypt(config.botTokenEncrypted);
    if (!botToken) {
      this.logger.warn(
        { configId, tenantId: config.tenantId },
        'Bot token could not be decrypted; re-enter it in Admin → Telegram',
      );
      return null;
    }

    return {
      configId: config.id,
      tenantId: config.tenantId,
      tenantSlug: tenant.slug,
      restaurantName: tenant.name,
      botToken,
      botUsername: config.botUsername,
    };
  }
}
