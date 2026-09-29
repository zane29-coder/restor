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
 * interface layer, not where business logic lives (TZ §14). All this needs to
 * do is send a message to a chat — optionally into a forum topic — and report
 * failures in a way the retry logic can act on.
 *
 * Built on the platform `fetch`; a framework would add a dependency and a
 * long-polling loop we do not want in a web process.
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
      // The bot is a notification layer; it does not need message history.
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
  }

  async deleteWebhook(botToken: string): Promise<void> {
    await this.call(botToken, 'deleteWebhook', { drop_pending_updates: true });
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
