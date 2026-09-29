import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ErrorCode } from '@restor/shared-types';
import { AppConfig } from '../../config/configuration';
import { AppException } from '../../common/errors/app-exception';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: Date;
  queryId?: string;
  startParam?: string;
}

/**
 * Verifies Telegram Mini App `initData` (TZ §48).
 *
 * This is the whole security boundary for Mini App sign-in. The client hands
 * over a signed blob; anything inside it — including the Telegram user id — is
 * attacker-controlled until this HMAC check passes. Nothing in the payload may
 * be read before verification succeeds.
 *
 * Algorithm, per Telegram's documentation:
 *   secret  = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   check   = HMAC_SHA256(key = secret, message = data_check_string)
 * where `data_check_string` is every field except `hash`, sorted by key and
 * joined as `k=v` with newlines.
 */
@Injectable()
export class TelegramInitDataService {
  private readonly logger = new Logger(TelegramInitDataService.name);

  constructor(private readonly config: AppConfig) {}

  /**
   * @param initData Raw query-string exactly as `Telegram.WebApp.initData`
   *                 provides it. Do not re-encode or reorder it.
   * @param botToken Tenant's own bot token; falls back to the platform bot.
   */
  verify(initData: string, botToken?: string): VerifiedInitData {
    const token = botToken || this.config.telegram.botToken;
    if (!token) {
      throw new AppException(
        ErrorCode.TELEGRAM_INIT_DATA_INVALID,
        'No Telegram bot is configured for this restaurant',
        503,
      );
    }

    const params = new URLSearchParams(initData);
    const providedHash = params.get('hash');
    if (!providedHash) {
      throw this.invalid('initData carries no hash');
    }

    // Every field except `hash`, sorted, joined with newlines.
    const pairs: string[] = [];
    for (const [key, value] of params.entries()) {
      if (key === 'hash') continue;
      pairs.push(`${key}=${value}`);
    }
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
    const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (!safeEqualHex(expectedHash, providedHash)) {
      throw this.invalid('initData signature does not match');
    }

    // A valid signature is replayable forever, so freshness is enforced too.
    const authDateRaw = params.get('auth_date');
    const authDateSeconds = Number(authDateRaw);
    if (!authDateRaw || !Number.isFinite(authDateSeconds)) {
      throw this.invalid('initData carries no auth_date');
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - authDateSeconds;
    if (ageSeconds > this.config.telegram.initDataMaxAgeSeconds) {
      throw this.invalid('initData has expired; reopen the app');
    }
    // A timestamp meaningfully in the future means a forged or skewed client.
    if (ageSeconds < -300) {
      throw this.invalid('initData auth_date is in the future');
    }

    const userRaw = params.get('user');
    if (!userRaw) {
      throw this.invalid('initData carries no user');
    }

    let user: TelegramUser;
    try {
      user = JSON.parse(userRaw) as TelegramUser;
    } catch {
      throw this.invalid('initData user is not valid JSON');
    }

    if (typeof user.id !== 'number') {
      throw this.invalid('initData user has no numeric id');
    }

    return {
      user,
      authDate: new Date(authDateSeconds * 1000),
      queryId: params.get('query_id') ?? undefined,
      startParam: params.get('start_param') ?? undefined,
    };
  }

  private invalid(reason: string): AppException {
    // Logged with the reason, returned without it: telling a caller exactly
    // which check failed helps them craft the next forgery attempt.
    this.logger.warn({ reason }, 'Telegram initData rejected');
    return new AppException(
      ErrorCode.TELEGRAM_INIT_DATA_INVALID,
      'Telegram authentication failed',
      401,
    );
  }
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
