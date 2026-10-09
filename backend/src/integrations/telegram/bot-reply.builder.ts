import { escapeHtml, formatMoney, formatPhone } from '@restor/shared-utils';
import { orderStatusLabel } from './message.builder';

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

/**
 * The persistent keyboard under the message box.
 *
 * Exported as constants because the handler matches the text a tap produces:
 * a reply-keyboard button is not a callback, it simply sends its own label as
 * an ordinary message. Change a label here and the handler follows; change one
 * by hand in either place and the button silently stops working.
 */
export const BOT_BUTTONS = {
  menu: '🍽 Menyu',
  orders: '🧾 Buyurtmalarim',
  branches: '📍 Filiallar',
  contact: '📞 Aloqa',
} as const;

export interface BotReply {
  text: string;
  /** Telegram `reply_markup`; absent when the reply is text only. */
  replyMarkup?: unknown;
}

/**
 * The persistent keyboard a customer sees under the message box.
 *
 * Preferred over an inline keyboard for the main navigation: an inline
 * keyboard scrolls away with the message that carried it, so a customer who
 * sent anything since `/start` has nothing left to press. This one stays.
 *
 * `Menyu` carries the Mini App; the rest are plain labels the handler reads
 * back as text. On a deployment without TLS the Mini App button is dropped
 * rather than sent — Telegram rejects the whole `sendMessage` over one
 * non-HTTPS `web_app` URL, which would cost the customer every other button
 * too.
 */
export function mainKeyboard(miniAppUrl: string): unknown {
  const menuButton = miniAppUrl.startsWith('https://')
    ? [{ text: BOT_BUTTONS.menu, web_app: { url: miniAppUrl } }]
    : null;

  return {
    keyboard: [
      ...(menuButton ? [menuButton] : []),
      [{ text: BOT_BUTTONS.orders }, { text: BOT_BUTTONS.branches }],
      [{ text: BOT_BUTTONS.contact }],
    ],
    // Without this the keyboard takes up half a phone screen.
    resize_keyboard: true,
    is_persistent: true,
  };
}

/**
 * `/start` in a private chat — the first thing a customer ever sees.
 *
 * Carries the persistent keyboard rather than an inline button: Telegram
 * allows one `reply_markup` per message, and the keyboard is the one that
 * survives the next message.
 */
export function buildStartReply(params: {
  restaurantName: string;
  customerName?: string | null;
  miniAppUrl: string;
}): BotReply {
  const greeting = params.customerName
    ? `Assalomu alaykum, ${escapeHtml(params.customerName)}!`
    : 'Assalomu alaykum!';

  const hasMenuButton = params.miniAppUrl.startsWith('https://');

  const lines = [
    greeting,
    '',
    `🍽 <b>${escapeHtml(params.restaurantName)}</b>`,
    '',
    hasMenuButton
      ? `Buyurtma berish uchun pastdagi <b>${BOT_BUTTONS.menu}</b> tugmasini bosing.`
      : `Buyurtma berish: ${escapeHtml(params.miniAppUrl)}`,
    '',
    '🚚 Yetkazib berish yoki oʻzingiz olib ketish — tanlaysiz.',
    '🔔 Buyurtma holati shu yerga yoziladi.',
  ];

  return { text: lines.join('\n'), replyMarkup: mainKeyboard(params.miniAppUrl) };
}

/** `/help` — what this bot can and cannot do. */
export function buildHelpReply(params: {
  restaurantName: string;
  miniAppUrl: string;
}): BotReply {
  return {
    text: [
      `ℹ️ <b>${escapeHtml(params.restaurantName)}</b> boti`,
      '',
      `${BOT_BUTTONS.menu} — menyu va buyurtma`,
      `${BOT_BUTTONS.orders} — oxirgi buyurtmalaringiz`,
      `${BOT_BUTTONS.branches} — manzillar va ish vaqti`,
      `${BOT_BUTTONS.contact} — telefon raqam`,
      '',
      'Buyurtma holati haqida xabarni shu yerda olasiz.',
      'Tugmalar koʻrinmasa /start yuboring.',
    ].join('\n'),
    replyMarkup: mainKeyboard(params.miniAppUrl),
  };
}

/** Anything the bot does not understand, in a private chat. */
export function buildFallbackReply(params: { miniAppUrl: string }): BotReply {
  const hasMenuButton = params.miniAppUrl.startsWith('https://');

  return {
    text: [
      'Buyurtmalar menyu orqali qabul qilinadi.',
      hasMenuButton
        ? `Pastdagi <b>${BOT_BUTTONS.menu}</b> tugmasini bosing.`
        : `Havolani oching: ${escapeHtml(params.miniAppUrl)}`,
    ].join('\n'),
    replyMarkup: mainKeyboard(params.miniAppUrl),
  };
}

/* -------------------------------------------------------------------------- */
/* What the keyboard buttons answer                                           */
/* -------------------------------------------------------------------------- */

export interface BranchSummary {
  name: string;
  address: string;
  phone: string | null;
}

/** `📍 Filiallar` — where the restaurant physically is. */
export function buildBranchesReply(branches: BranchSummary[]): BotReply {
  if (branches.length === 0) {
    return { text: 'Hozircha filial maʼlumotlari kiritilmagan.' };
  }

  const blocks = branches.map((branch) => {
    const lines = [`📍 <b>${escapeHtml(branch.name)}</b>`, escapeHtml(branch.address)];
    if (branch.phone) lines.push(`📞 ${escapeHtml(formatPhone(branch.phone))}`);
    return lines.join('\n');
  });

  return { text: blocks.join('\n\n') };
}

export interface OrderSummary {
  displayNumber: string;
  status: string;
  total: number;
  createdAt: Date;
}

/**
 * `🧾 Buyurtmalarim` — the customer's own recent orders.
 *
 * Only ever this customer's: the handler looks them up by the Telegram id
 * Telegram itself signed, never by anything in the message.
 */
export function buildMyOrdersReply(orders: OrderSummary[]): BotReply {
  if (orders.length === 0) {
    return { text: 'Sizda hali buyurtma yoʻq.' };
  }

  const lines = orders.map((order) => {
    const date = order.createdAt.toLocaleDateString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Tashkent',
    });

    return [
      `🧾 <b>${escapeHtml(order.displayNumber)}</b> — ${escapeHtml(orderStatusLabel(order.status))}`,
      `   ${escapeHtml(formatMoney(order.total))} · ${date}`,
    ].join('\n');
  });

  return { text: ['<b>Oxirgi buyurtmalaringiz</b>', '', ...lines].join('\n') };
}

/** `📞 Aloqa` — whoever the customer should call. */
export function buildContactReply(params: {
  restaurantName: string;
  phones: string[];
}): BotReply {
  if (params.phones.length === 0) {
    return { text: 'Telefon raqam kiritilmagan. Menyu orqali buyurtma qoldiring.' };
  }

  return {
    text: [
      `📞 <b>${escapeHtml(params.restaurantName)}</b>`,
      '',
      ...params.phones.map((phone) => escapeHtml(formatPhone(phone))),
    ].join('\n'),
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
