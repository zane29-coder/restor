import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@restor/shared-types';
import { AppException } from '../../common/errors/app-exception';

export interface SendMessageParams {
  botToken: string;
  chatId: string;
  text: string;
  /** Forum topic (`message_thread_id`); `null` posts to the group's General topic. */
  topicId?: number | null;
  parseMode?: 'HTML' | 'MarkdownV2';
  disableNotification?: boolean;
  replyMarkup?: unknown;
}

export interface TelegramSendResult {
  ok: true;
  messageId: number;
  chatId: string;
}

/** `getWebhookInfo`, normalised — Telegram reports "none" as an empty string. */
export interface TelegramWebhookInfo {
  url: string | null;
  pendingUpdateCount: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

/** What Telegram returns when it rejects a call. */
interface TelegramErrorBody {
  ok: false;
  error_code: number;
  description: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/**
 * Thin HTTP client for the Telegram Bot API.
 *
 * Deliberately not a bot framework: RESTOR's bot is a notification and
 * interface layer, not where business logic lives (TZ §14). Send a message to a
 * chat — optionally into a forum topic — point the bot at our webhook, and
 * report failures in a way the retry logic can act on. Nothing else.
 *
 * Built on the platform `fetch`; a framework would add a dependency and a
 * long-polling loop we do not want in a web process. Inbound updates arrive by
 * webhook instead — see `modules/telegram/telegram-bot.service.ts`.
 */
@Injectable()
export class TelegramApiClient {
  private readonly logger = new Logger(TelegramApiClient.name);

  private static readonly BASE_URL = 'https://api.telegram.org';
  private static readonly TIMEOUT_MS = 15_000;

  /** Telegram caps a message at 4096 characters. */
  private static readonly MAX_TEXT_LENGTH = 4096;

  async sendMessage(params: SendMessageParams): Promise<TelegramSendResult> {
    const text =
      params.text.length > TelegramApiClient.MAX_TEXT_LENGTH
        ? `${params.text.slice(0, TelegramApiClient.MAX_TEXT_LENGTH - 1)}…`
        : params.text;

    const body: Record<string, unknown> = {
      chat_id: params.chatId,
      text,
      parse_mode: params.parseMode ?? 'HTML',
      // Long order messages otherwise get a link preview card appended.
      link_preview_options: { is_disabled: true },
      disable_notification: params.disableNotification ?? false,
    };

    // Only send the field when a topic is configured: passing `null` makes
    // Telegram reject the call rather than fall back to General.
    if (params.topicId != null) body.message_thread_id = params.topicId;
    if (params.replyMarkup) body.reply_markup = params.replyMarkup;

    const response = await this.call<{ message_id: number; chat: { id: number } }>(
      params.botToken,
      'sendMessage',
      body,
    );

    return { ok: true, messageId: response.message_id, chatId: String(response.chat.id) };
  }

  /** Verifies a bot token and returns the bot's own identity. */
  async getMe(botToken: string): Promise<{ id: number; username: string; firstName: string }> {
    const me = await this.call<{ id: number; username: string; first_name: string }>(
      botToken,
      'getMe',
      {},
    );
    return { id: me.id, username: me.username, firstName: me.first_name };
  }

  /** Confirms the bot can post to a chat, and what kind of chat it is. */
  async getChat(
    botToken: string,
    chatId: string,
  ): Promise<{ id: string; title: string | null; type: string; isForum: boolean }> {
    const chat = await this.call<{
      id: number;
      title?: string;
      type: string;
      is_forum?: boolean;
    }>(botToken, 'getChat', { chat_id: chatId });

    return {
      id: String(chat.id),
      title: chat.title ?? null,
      type: chat.type,
      isForum: chat.is_forum ?? false,
    };
  }

  async setWebhook(botToken: string, url: string, secretToken?: string): Promise<void> {
    await this.call(botToken, 'setWebhook', {
      url,
      secret_token: secretToken,
      // Only what the bot acts on. `my_chat_member` is here because being added
      // to a staff group is how a restaurant learns its own chat id: once a
      // webhook is set, `getUpdates` answers 409 and can no longer be used for
      // that.
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      // Updates queued while no webhook was set are stale by now — a customer
      // who pressed /start yesterday does not want the answer today.
      drop_pending_updates: true,
    });
  }

  async deleteWebhook(botToken: string): Promise<void> {
    await this.call(botToken, 'deleteWebhook', { drop_pending_updates: true });
  }

  /**
   * What Telegram believes about this bot's webhook.
   *
   * The one call that can tell an admin why a bot is silent: a URL pointing at
   * someone else's deployment, a TLS error Telegram hit on its last attempt, or
   * a pile of pending updates nobody is draining.
   */
  async getWebhookInfo(botToken: string): Promise<TelegramWebhookInfo> {
    const info = await this.call<{
      url: string;
      pending_update_count?: number;
      last_error_date?: number;
      last_error_message?: string;
    }>(botToken, 'getWebhookInfo', {});

    return {
      // Telegram reports "no webhook" as an empty string.
      url: info.url || null,
      pendingUpdateCount: info.pending_update_count ?? 0,
      lastErrorAt: info.last_error_date
        ? new Date(info.last_error_date * 1000).toISOString()
        : null,
      lastErrorMessage: info.last_error_message ?? null,
    };
  }

  /**
   * The command list a client shows in its own menu.
   *
   * Scoped to private chats: in a staff group the bot answers `/id` and
   * nothing else, and offering a customer menu there is noise.
   */
  async setMyCommands(
    botToken: string,
    commands: Array<{ command: string; description: string }>,
  ): Promise<void> {
    await this.call(botToken, 'setMyCommands', {
      commands,
      scope: { type: 'all_private_chats' },
    });
  }

  /**
   * The button beside the message box.
   *
   * This is the call that removes the @BotFather step: pointing the menu
   * button at a Web App here does what `/newapp` and Bot Settings → Menu
   * Button do by hand, so a restaurant that pastes a token into the admin
   * screen never has to open BotFather at all.
   */
  async setChatMenuButton(botToken: string, webAppUrl: string, text: string): Promise<void> {
    await this.call(botToken, 'setChatMenuButton', {
      menu_button: { type: 'web_app', text, web_app: { url: webAppUrl } },
    });
  }

  /** Shown on the bot's profile, and above the Start button in an empty chat. */
  async setMyDescription(botToken: string, description: string): Promise<void> {
    await this.call(botToken, 'setMyDescription', { description });
  }

  /** The one-liner under the bot's name in a chat list. */
  async setMyShortDescription(botToken: string, shortDescription: string): Promise<void> {
    await this.call(botToken, 'setMyShortDescription', { short_description: shortDescription });
  }

  /**
   * Acknowledges a button press.
   *
   * Without it the client shows a loading spinner on the button for a minute.
   * Failure is swallowed: the callback id expires, and a retry would be
   * answering a question nobody is still waiting on.
   */
  async answerCallbackQuery(botToken: string, callbackQueryId: string, text?: string): Promise<void> {
    try {
      await this.call(botToken, 'answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text,
      });
    } catch (error) {
      this.logger.debug({ err: error }, 'answerCallbackQuery failed; the id has likely expired');
    }
  }

  /**
   * One Bot API call.
   *
   * Translates Telegram's error shape into an {@link AppException} that
   * carries `isRetryable`, so the queue can distinguish "the group was deleted"
   * (never retry) from "you are being rate limited" (retry after N seconds).
   */
  private async call<T>(
    botToken: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TelegramApiClient.TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${TelegramApiClient.BASE_URL}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      // Network failure or timeout: worth retrying.
      throw new TelegramSendError(
        `Telegram ${method} unreachable`,
        { retryable: true },
        cause,
      );
    } finally {
      clearTimeout(timer);
    }

    const payload = (await response.json().catch(() => null)) as
      | { ok: true; result: T }
      | TelegramErrorBody
      | null;

    if (!payload) {
      throw new TelegramSendError(`Telegram ${method} returned a non-JSON body`, {
        retryable: response.status >= 500,
      });
    }

    if (payload.ok) return payload.result;

    const { error_code: code, description, parameters } = payload;

    // 429: Telegram tells us exactly how long to wait.
    // 5xx: their side, worth retrying.
    // 400/403: the chat is gone, the bot was kicked, or the topic was deleted —
    //          retrying cannot fix any of those.
    const retryable = code === 429 || code >= 500;

    this.logger.warn(
      { method, code, description, retryAfter: parameters?.retry_after },
      'Telegram API rejected a call',
    );

    throw new TelegramSendError(description, {
      retryable,
      retryAfterSeconds: parameters?.retry_after,
      code,
    });
  }
}

/** Carries whether the queue should try again, and when. */
export class TelegramSendError extends AppException {
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly telegramCode?: number;

  /** Named `originalError` rather than `cause`: `HttpException` owns `cause`. */
  readonly originalError?: unknown;

  constructor(
    message: string,
    options: { retryable: boolean; retryAfterSeconds?: number; code?: number },
    originalError?: unknown,
  ) {
    super(ErrorCode.TELEGRAM_SEND_FAILED, message, 502);
    this.retryable = options.retryable;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.telegramCode = options.code;
    this.originalError = originalError;
  }
}
