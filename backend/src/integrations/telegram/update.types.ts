/**
 * The slice of Telegram's `Update` this bot reads.
 *
 * Hand-written rather than pulled from a types package: `setWebhook` asks for
 * three update kinds, and declaring only those makes it obvious what the
 * handler is allowed to react to. Everything is optional because the body is
 * attacker-controlled until {@link parseUpdate} has vouched for it — anyone who
 * learns a webhook URL can POST whatever they like at it.
 */

export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TelegramUpdateChat {
  id: number;
  type: TelegramChatType;
  title?: string;
  username?: string;
  is_forum?: boolean;
}

export interface TelegramUpdateUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramUpdateMessage {
  message_id: number;
  from?: TelegramUpdateUser;
  chat: TelegramUpdateChat;
  /** Forum topic the message was sent in. */
  message_thread_id?: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from?: TelegramUpdateUser;
  data?: string;
}

/** The bot's own membership changed in a chat — how it learns it was added. */
export interface TelegramChatMemberUpdated {
  chat: TelegramUpdateChat;
  new_chat_member?: { status?: string };
  old_chat_member?: { status?: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramUpdateMessage;
  /** An edit is still a message; treated identically so a corrected command works. */
  edited_message?: TelegramUpdateMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMemberUpdated;
}

/**
 * Narrows an unverified request body to an update, or `null`.
 *
 * Only `update_id` is required: Telegram always sends it, and a body without
 * one did not come from Telegram. Each branch is checked where it is read
 * rather than validated exhaustively here — an update kind we do not handle
 * must be ignored, not rejected, because Telegram retries a non-2xx.
 */
export function parseUpdate(raw: unknown): TelegramUpdate | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const candidate = raw as Partial<TelegramUpdate>;
  if (typeof candidate.update_id !== 'number') return null;

  return {
    update_id: candidate.update_id,
    message: asMessage(candidate.message),
    edited_message: asMessage(candidate.edited_message),
    callback_query:
      typeof candidate.callback_query?.id === 'string' ? candidate.callback_query : undefined,
    my_chat_member: asChat(candidate.my_chat_member?.chat)
      ? candidate.my_chat_member
      : undefined,
  };
}

function asMessage(value: unknown): TelegramUpdateMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const message = value as Partial<TelegramUpdateMessage>;
  if (typeof message.message_id !== 'number' || !asChat(message.chat)) return undefined;

  return message as TelegramUpdateMessage;
}

function asChat(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const chat = value as Partial<TelegramUpdateChat>;
  return typeof chat.id === 'number' && typeof chat.type === 'string';
}
