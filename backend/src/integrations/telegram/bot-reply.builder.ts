import { escapeHtml } from '@restor/shared-utils';

/**
 * What the bot says back (TZ §14).
 *
 * Separate from `message.builder.ts` on purpose: that one writes to a staff
 * group, this one writes to a customer. The audience differs and so does the
 * tone — a staff feed is dense and scanned at a glance, a customer gets two
 * sentences and a button.
 *
 * Same two rules as the other builder, for the same reasons: HTML parse mode,
 * and **every interpolated value goes through `escapeHtml`**. A restaurant
 * named `Lavash & Co <3` would otherwise break the message, and a customer's
 * own name is attacker-controlled text.
 *
 * The bot deliberately cannot take an order by itself. Ordering happens in the
 * Mini App, which already prices server-side, applies promotions and collects
 * an address; a parallel chat-based order flow would be a second
 * implementation of all of it with no way to show a menu photo.
 */

/** Inline keyboard button labels, in Uzbek like every other customer string. */
const OPEN_MENU = 'Menyuni ochish';

export interface BotReply {
  text: string;
  /** Telegram `reply_markup`; absent when the reply is text only. */
  replyMarkup?: unknown;
}

/**
 * A Mini App button.
 *
 * `web_app` buttons are accepted in private chats only, and Telegram rejects a
 * non-HTTPS URL outright — so a deployment without TLS gets the link as text
 * instead of a button that silently fails to appear.
 */
export function miniAppButton(miniAppUrl: string, label = OPEN_MENU): unknown | null {
  if (!miniAppUrl.startsWith('https://')) return null;

  return { inline_keyboard: [[{ text: label, web_app: { url: miniAppUrl } }]] };
}

/** `/start` in a private chat — the first thing a customer ever sees. */
export function buildStartReply(params: {
  restaurantName: string;
  customerName?: string | null;
  miniAppUrl: string;
}): BotReply {
  const greeting = params.customerName
    ? `Assalomu alaykum, ${escapeHtml(params.customerName)}!`
    : 'Assalomu alaykum!';

  const markup = miniAppButton(params.miniAppUrl);

  const lines = [
    greeting,
    '',
    `🍽 <b>${escapeHtml(params.restaurantName)}</b> — buyurtma berish uchun quyidagi tugmani bosing.`,
    '',
    '📋 Menyu, savatcha va toʻlov — hammasi shu yerda.',
    '🚚 Yetkazib berish yoki oʻzingiz olib ketish — tanlaysiz.',
  ];

  // No button means no TLS, so the link has to be readable as text.
  if (!markup) {
    lines.push('', `👉 ${escapeHtml(params.miniAppUrl)}`);
  }

  return {
    text: lines.join('\n'),
    ...(markup ? { replyMarkup: markup } : {}),
  };
}

/** `/help` — what this bot can and cannot do. */
export function buildHelpReply(params: {
  restaurantName: string;
  miniAppUrl: string;
}): BotReply {
  const markup = miniAppButton(params.miniAppUrl);

  return {
    text: [
      `ℹ️ <b>${escapeHtml(params.restaurantName)}</b> boti`,
      '',
      '/start — menyuni ochish',
      '/help — shu yordam',
      '',
      'Buyurtma holati haqida xabarni shu yerda olasiz.',
      'Savollar boʻlsa, restoran bilan bogʻlaning.',
    ].join('\n'),
    ...(markup ? { replyMarkup: markup } : {}),
  };
}

/** Anything the bot does not understand, in a private chat. */
export function buildFallbackReply(params: { miniAppUrl: string }): BotReply {
  const markup = miniAppButton(params.miniAppUrl);

  return {
    text: [
      'Buyurtmalar menyu orqali qabul qilinadi.',
      markup
        ? 'Pastdagi tugmani bosing yoki /start yuboring.'
        : `/start yuboring yoki havolani oching: ${escapeHtml(params.miniAppUrl)}`,
    ].join('\n'),
    ...(markup ? { replyMarkup: markup } : {}),
  };
}

/**
 * The chat's own id, asked for with `/id` in a staff group.
 *
 * This is how a restaurant finds the ids it has to paste into the routing
 * screen. It used to be done by opening `getUpdates` in a browser, which stops
 * working the moment a webhook is registered — Telegram answers 409 to one or
 * the other, never both.
 */
export function buildChatIdReply(params: {
  chatId: string;
  topicId?: number | null;
  chatTitle?: string | null;
}): BotReply {
  const lines = [
    params.chatTitle ? `💬 <b>${escapeHtml(params.chatTitle)}</b>` : '💬 <b>Bu guruh</b>',
    '',
    `Chat ID: <code>${escapeHtml(params.chatId)}</code>`,
  ];

  if (params.topicId != null) {
    lines.push(`Topic ID: <code>${params.topicId}</code>`);
  }

  lines.push('', 'Shu qiymatlarni Admin → Telegram boʻlimiga kiriting.');

  return { text: lines.join('\n') };
}

/** Posted once, when the bot is added to a group, so nobody has to ask for it. */
export function buildAddedToGroupReply(params: {
  chatId: string;
  chatTitle?: string | null;
}): BotReply {
  return {
    text: [
      params.chatTitle
        ? `✅ Bot <b>${escapeHtml(params.chatTitle)}</b> guruhiga qoʻshildi.`
        : '✅ Bot guruhga qoʻshildi.',
      '',
      `Chat ID: <code>${escapeHtml(params.chatId)}</code>`,
      '',
      'Buyurtmalar shu guruhga tushishi uchun bu ID ni Admin → Telegram →',
      'Hodisa marshrutlari boʻlimiga kiriting.',
      'Topic ID kerak boʻlsa, kerakli topic ichida <code>/id</code> yuboring.',
    ].join('\n'),
  };
}

/* -------------------------------------------------------------------------- */

export interface ParsedCommand {
  /** Lower-case, without the leading slash or the `@botname` suffix. */
  name: string;
  /** Everything after the command, trimmed; `''` when there was nothing. */
  args: string;
}

/**
 * Reads a bot command out of message text.
 *
 * In a group Telegram delivers `/start@RestorDemoBot`, and a command addressed
 * to a DIFFERENT bot in the same group must be ignored — otherwise two
 * restaurants' bots in one group both answer. `botUsername` is what makes that
 * distinction possible; without it, an addressed command is accepted.
 */
export function parseCommand(text: string | undefined, botUsername?: string | null): ParsedCommand | null {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith('/')) return null;

  const [head, ...rest] = trimmed.split(/\s+/);
  const [name, addressee] = head!.slice(1).split('@');

  if (!name) return null;

  if (addressee && botUsername && addressee.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }

  return { name: name.toLowerCase(), args: rest.join(' ').trim() };
}

/**
 * The Mini App URL for one restaurant.
 *
 * The slug is what tells the Mini App which restaurant it is serving — see
 * `apps/telegram-mini-app/src/api.ts`, which reads `?tenant=` after
 * `start_param`. Built with `URL` so a base that already carries a query or a
 * sub-path survives.
 */
export function miniAppUrlFor(baseUrl: string, tenantSlug: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('tenant', tenantSlug);
  return url.toString();
}
