import {
  buildAddedToGroupReply,
  buildChatIdReply,
  buildFallbackReply,
  buildHelpReply,
  buildStartReply,
  miniAppButton,
  miniAppUrlFor,
  parseCommand,
} from '../../src/integrations/telegram/bot-reply.builder';
import { parseUpdate } from '../../src/integrations/telegram/update.types';
import { TelegramWebhookService } from '../../src/modules/telegram/telegram-webhook.service';

/**
 * The inbound half of the bot (TZ §14).
 *
 * The bug these exist around: the bot was write-only. `setWebhook` sat in the
 * API client with no call site, there was no route for Telegram to POST to and
 * no command handler anywhere, so pressing /start produced nothing at all and
 * the token looked like the culprit. Everything below is a piece of the half
 * that was missing.
 */

describe('parseCommand', () => {
  it('reads a plain command', () => {
    expect(parseCommand('/start')).toEqual({ name: 'start', args: '' });
  });

  it('lower-cases the name so /START works', () => {
    expect(parseCommand('/START')?.name).toBe('start');
  });

  it('keeps the payload of a deep link', () => {
    expect(parseCommand('/start table-7')).toEqual({ name: 'start', args: 'table-7' });
  });

  it('accepts a command addressed to this bot', () => {
    // In a group Telegram appends @botname to every command.
    expect(parseCommand('/id@RestorDemoBot', 'RestorDemoBot')?.name).toBe('id');
  });

  it('matches the addressee case-insensitively', () => {
    expect(parseCommand('/id@restordemobot', 'RestorDemoBot')?.name).toBe('id');
  });

  it('ignores a command addressed to another bot', () => {
    // Two restaurants' bots in one group must not both answer.
    expect(parseCommand('/id@SomeOtherBot', 'RestorDemoBot')).toBeNull();
  });

  it('accepts an addressed command when the username is unknown', () => {
    // Better to answer than to go silent: an unknown username is our gap.
    expect(parseCommand('/id@RestorDemoBot', null)?.name).toBe('id');
  });

  it('is not a command without a leading slash', () => {
    expect(parseCommand('start')).toBeNull();
    expect(parseCommand('salom /start')).toBeNull();
  });

  it('survives empty and absent text', () => {
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });
});

describe('miniAppUrlFor', () => {
  it('carries the restaurant slug, which is how the Mini App knows whose it is', () => {
    expect(miniAppUrlFor('https://tg.restor.uz', 'osh-markazi')).toBe(
      'https://tg.restor.uz/?tenant=osh-markazi',
    );
  });

  it('keeps a sub-path, for a deployment serving the Mini App at /tg', () => {
    expect(miniAppUrlFor('https://restor.uz/tg', 'demo')).toBe(
      'https://restor.uz/tg?tenant=demo',
    );
  });

  it('replaces a slug already on the base rather than appending a second', () => {
    expect(miniAppUrlFor('https://restor.uz/tg?tenant=old', 'new')).toBe(
      'https://restor.uz/tg?tenant=new',
    );
  });
});

describe('miniAppButton', () => {
  it('is a web_app button on HTTPS', () => {
    expect(miniAppButton('https://tg.restor.uz/?tenant=demo')).toEqual({
      inline_keyboard: [[{ text: 'Menyuni ochish', web_app: { url: 'https://tg.restor.uz/?tenant=demo' } }]],
    });
  });

  it('is nothing on plain HTTP', () => {
    // Telegram rejects a non-HTTPS web_app URL, and a rejected sendMessage
    // means the customer gets no reply at all — the text link is the fallback.
    expect(miniAppButton('http://localhost:5175/?tenant=demo')).toBeNull();
  });
});

/**
 * Same rule as the notification builder, for the same reason: HTML parse mode
 * plus attacker-controlled text. A restaurant named with a `<` would otherwise
 * break every reply the bot sends.
 */
describe('bot replies', () => {
  const miniAppUrl = 'https://tg.restor.uz/?tenant=demo';

  it('greets the customer by name and offers the Mini App', () => {
    const reply = buildStartReply({
      restaurantName: 'Osh Markazi',
      customerName: 'Elbek',
      miniAppUrl,
    });

    expect(reply.text).toContain('Elbek');
    expect(reply.text).toContain('Osh Markazi');
    expect(reply.replyMarkup).toBeDefined();
  });

  it('greets without a name when Telegram did not send one', () => {
    const reply = buildStartReply({ restaurantName: 'Osh Markazi', miniAppUrl });

    expect(reply.text.startsWith('Assalomu alaykum!')).toBe(true);
  });

  it('escapes the restaurant name', () => {
    const reply = buildStartReply({
      restaurantName: 'Lavash <b>&</b> Co',
      miniAppUrl,
    });

    expect(reply.text).toContain('Lavash &lt;b&gt;&amp;&lt;/b&gt; Co');
    expect(reply.text).not.toContain('<b>&</b>');
  });

  it('escapes the customer name', () => {
    const reply = buildStartReply({
      restaurantName: 'Osh Markazi',
      customerName: '<script>',
      miniAppUrl,
    });

    expect(reply.text).not.toContain('<script>');
  });

  it('falls back to a readable link when there can be no button', () => {
    const insecure = 'http://localhost:5175/?tenant=demo';
    const reply = buildStartReply({ restaurantName: 'Osh Markazi', miniAppUrl: insecure });

    expect(reply.replyMarkup).toBeUndefined();
    expect(reply.text).toContain(insecure);
  });

  it('help lists the commands it actually handles', () => {
    const reply = buildHelpReply({ restaurantName: 'Osh Markazi', miniAppUrl });

    expect(reply.text).toContain('/start');
    expect(reply.text).toContain('/help');
  });

  it('nudges an unrecognised message back to the menu', () => {
    expect(buildFallbackReply({ miniAppUrl }).replyMarkup).toBeDefined();
  });

  it('reports the chat id, which is what the routing screen needs', () => {
    const reply = buildChatIdReply({
      chatId: '-1001234567890',
      topicId: 42,
      chatTitle: 'Chilonzor buyurtmalar',
    });

    expect(reply.text).toContain('-1001234567890');
    expect(reply.text).toContain('42');
    expect(reply.text).toContain('Chilonzor buyurtmalar');
  });

  it('omits the topic line in a group without topics', () => {
    expect(buildChatIdReply({ chatId: '-100123456' }).text).not.toContain('Topic ID');
  });

  it('escapes a group title', () => {
    const reply = buildAddedToGroupReply({ chatId: '-100123456', chatTitle: '<b>Zal</b>' });

    expect(reply.text).not.toContain('<b>Zal</b>');
    expect(reply.text).toContain('-100123456');
  });
});

/**
 * A webhook URL is public the moment anything logs it, so the body arriving at
 * one is unverified input like any other.
 */
describe('parseUpdate', () => {
  it('accepts a real update', () => {
    const update = parseUpdate({
      update_id: 1,
      message: { message_id: 7, chat: { id: 12345, type: 'private' }, text: '/start' },
    });

    expect(update?.message?.text).toBe('/start');
  });

  it('rejects a body that is not an update', () => {
    expect(parseUpdate(null)).toBeNull();
    expect(parseUpdate('hello')).toBeNull();
    expect(parseUpdate([])).toBeNull();
    expect(parseUpdate({})).toBeNull();
    expect(parseUpdate({ update_id: 'one' })).toBeNull();
  });

  it('drops a malformed message rather than the whole update', () => {
    // An update kind we cannot read must be ignored, not rejected: Telegram
    // retries a non-2xx and then disables the webhook entirely.
    const update = parseUpdate({ update_id: 2, message: { text: 'no chat, no id' } });

    expect(update).not.toBeNull();
    expect(update?.message).toBeUndefined();
  });

  it('keeps an edited message, so a corrected command still works', () => {
    const update = parseUpdate({
      update_id: 3,
      edited_message: { message_id: 9, chat: { id: 1, type: 'private' }, text: '/help' },
    });

    expect(update?.edited_message?.text).toBe('/help');
  });
});

/**
 * The URL and its secret.
 *
 * Both are derived, never stored, so registration and verification cannot
 * disagree — and the URL goes through `apiUrl`, because the Subo callback once
 * shipped without the `/api/v1` prefix and every callback hit the static site.
 */
describe('TelegramWebhookService', () => {
  const configId = '3f2b9c3e-1a4d-4f0e-9c21-2b6d0a7f5e11';

  function build(options: { apiBaseUrl?: string; webhookSecret?: string } = {}) {
    const config = {
      apiBaseUrl: options.apiBaseUrl ?? 'https://api.restor.uz',
      telegram: { webhookSecret: options.webhookSecret ?? 'a'.repeat(32) },
      encryptionKey: null,
    };

    return new TelegramWebhookService(
      {} as never,
      config as never,
      {} as never,
      {} as never,
    );
  }

  it('builds a URL under /api/v1/webhooks/, which nginx exempts from rate limiting', () => {
    // Asserted whole: a pattern with a wildcard where the prefix belongs would
    // match the broken URL just as happily as the right one.
    expect(build().urlFor(configId)).toBe(
      `https://api.restor.uz/api/v1/webhooks/telegram/${configId}`,
    );
  });

  it('gives each bot a different secret', () => {
    const service = build();
    const other = '00000000-0000-4000-8000-000000000000';

    expect(service.secretFor(configId)).not.toBe(service.secretFor(other));
  });

  it('derives the same secret every time, so a restart does not orphan a webhook', () => {
    expect(build().secretFor(configId)).toBe(build().secretFor(configId));
  });

  it('produces a secret Telegram will accept', () => {
    // Telegram allows 1-256 characters of A-Z, a-z, 0-9, _ and -.
    expect(build().secretFor(configId)).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  });

  it('falls back to ENCRYPTION_KEY when no webhook secret is set', () => {
    const service = new TelegramWebhookService(
      {} as never,
      {
        apiBaseUrl: 'https://api.restor.uz',
        telegram: { webhookSecret: '' },
        encryptionKey: Buffer.alloc(32, 7),
      } as never,
      {} as never,
      {} as never,
    );

    // Not a convenience: a bot token cannot be stored without that key, so
    // wherever a webhook can exist, a base for its secret does too.
    expect(service.secretFor(configId)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has no secret, and so accepts nothing, when neither is configured', () => {
    const service = new TelegramWebhookService(
      {} as never,
      {
        apiBaseUrl: 'https://api.restor.uz',
        telegram: { webhookSecret: '' },
        encryptionKey: null,
      } as never,
      {} as never,
      {} as never,
    );

    expect(service.secretFor(configId)).toBeNull();
    expect(service.matchesSecret(configId, 'anything')).toBe(false);
  });

  it('accepts the secret it issued', () => {
    const service = build();

    expect(service.matchesSecret(configId, service.secretFor(configId))).toBe(true);
  });

  it('rejects a missing, wrong or another bot’s secret', () => {
    const service = build();
    const other = '00000000-0000-4000-8000-000000000000';

    expect(service.matchesSecret(configId, null)).toBe(false);
    expect(service.matchesSecret(configId, '')).toBe(false);
    expect(service.matchesSecret(configId, 'wrong')).toBe(false);
    expect(service.matchesSecret(configId, service.secretFor(other))).toBe(false);
  });

  it('does not throw on a presented secret of the wrong length', () => {
    // timingSafeEqual throws rather than returning false on a length mismatch.
    expect(() => build().matchesSecret(configId, 'x')).not.toThrow();
  });

  it('knows that Telegram will not deliver to a non-HTTPS host', () => {
    expect(build({ apiBaseUrl: 'https://api.restor.uz' }).canReceiveUpdates).toBe(true);
    expect(build({ apiBaseUrl: 'http://localhost:3000' }).canReceiveUpdates).toBe(false);
  });
});
