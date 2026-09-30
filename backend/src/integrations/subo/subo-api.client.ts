import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@restor/shared-types';
import { AppException } from '../../common/errors/app-exception';

/** Which provider settled a charge. Subo picks one, or the customer does. */
export type SuboProvider = 'ATMOS' | 'CLICK' | 'PAYME';

export type SuboStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';

export interface SuboCreateOrderParams {
  /** Tiyin, not soʻm. 1 UZS = 100 tiyin; Subo accepts 1 000–500 000 000. */
  amountTiyin: number;
  provider?: SuboProvider;
  description?: string;
  /** Our order id. Subo treats it as an idempotency key. */
  externalReference?: string;
  /**
   * Our customer id. Atmos saves the card against it, so the next checkout
   * for the same customer offers the saved card at one tap.
   */
  customerId?: string;
  customerName?: string;
  customerContact?: string;
  callbackUrl?: string;
  returnUrl?: string;
}

export interface SuboOrder {
  orderId: string;
  status: SuboStatus;
  provider: SuboProvider | null;
  checkoutUrl: string;
  externalReference: string | null;
  customerId: string | null;
  /** Tiyin. Subo returns this as a string, so it is parsed on the way in. */
  amountTiyin: number;
  atmosTransactionId: string | null;
  providerTransactionId: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** Subo's error body. `message` is Uzbek and safe to surface to a cashier. */
interface SuboErrorBody {
  statusCode?: number;
  message?: string | string[];
  error?: string;
}

/**
 * Thin HTTP client for the Subo external payment API (docs.subo.uz).
 *
 * Subo aggregates Atmos, Click and Payme behind one hosted checkout, so this
 * replaces what would otherwise be three separate provider integrations. Two
 * properties of their API shape this client:
 *
 *  - **Amounts are in tiyin.** RESTOR stores UZS as whole soʻm, because UZS has
 *    no circulating subunit. Every crossing multiplies or divides by 100, and
 *    that conversion lives here alone so no caller has to remember it.
 *  - **Callbacks are unsigned.** Their own documentation says to treat a
 *    webhook as a signal and confirm with `GET /orders/:id`. This client
 *    therefore exposes `getOrder`, and the webhook handler must use it before
 *    crediting anything.
 */
@Injectable()
export class SuboApiClient {
  private readonly logger = new Logger(SuboApiClient.name);

  private static readonly BASE_URL = 'https://subo.uz/api/external/v1';
  private static readonly TIMEOUT_MS = 20_000;

  /** Subo's limits, in tiyin. Checked here so a bad amount fails before HTTP. */
  private static readonly MIN_TIYIN = 1_000;
  private static readonly MAX_TIYIN = 500_000_000;

  /** Whole soʻm to tiyin. The only place this factor appears. */
  static toTiyin(amountUzs: number): number {
    return Math.round(amountUzs * 100);
  }

  /** Tiyin back to whole soʻm. */
  static fromTiyin(amountTiyin: number): number {
    return Math.round(amountTiyin / 100);
  }

  async createOrder(apiKey: string, params: SuboCreateOrderParams): Promise<SuboOrder> {
    if (
      params.amountTiyin < SuboApiClient.MIN_TIYIN ||
      params.amountTiyin > SuboApiClient.MAX_TIYIN
    ) {
      throw new AppException(
        ErrorCode.PAYMENT_AMOUNT_MISMATCH,
        `Onlayn toʻlov summasi ${SuboApiClient.fromTiyin(SuboApiClient.MIN_TIYIN)} – ` +
          `${SuboApiClient.fromTiyin(SuboApiClient.MAX_TIYIN)} soʻm oraligʻida boʻlishi kerak`,
        422,
      );
    }

    const body = await this.call<Record<string, unknown>>(apiKey, 'POST', '/orders', {
      amountTiyin: params.amountTiyin,
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.description ? { description: params.description } : {}),
      ...(params.externalReference ? { externalReference: params.externalReference } : {}),
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.customerName ? { customerName: params.customerName } : {}),
      ...(params.customerContact ? { customerContact: params.customerContact } : {}),
      ...(params.callbackUrl ? { callbackUrl: params.callbackUrl } : {}),
      ...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
    });

    return toOrder(body);
  }

  /**
   * The authoritative status of a charge.
   *
   * Called after every webhook, and by the reconciliation sweep for orders
   * whose callback never arrived.
   */
  async getOrder(apiKey: string, orderId: string): Promise<SuboOrder> {
    const body = await this.call<Record<string, unknown>>(
      apiKey,
      'GET',
      `/orders/${encodeURIComponent(orderId)}`,
    );
    return toOrder(body);
  }

  /** Whether a key is a sandbox key, which changes nothing but is worth logging. */
  static isSandbox(apiKey: string): boolean {
    return apiKey.startsWith('sk_test_');
  }

  private async call<T>(
    apiKey: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${SuboApiClient.BASE_URL}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SuboApiClient.TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new AppException(
          ErrorCode.PAYMENT_PROVIDER_ERROR,
          'Subo javob bermadi — keyinroq qayta urinib koʻring',
          504,
        );
      }
      // The API key must never reach a log line.
      this.logger.error({ url, method }, `Subo request failed: ${String(cause)}`);
      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        'Subo bilan aloqa yoʻq',
        502,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    if (!response.ok) {
      const parsed = safeParse<SuboErrorBody>(text);
      const message = Array.isArray(parsed?.message)
        ? parsed.message.join('; ')
        : (parsed?.message ?? `Subo HTTP ${response.status}`);

      this.logger.warn({ url, status: response.status, message }, 'Subo rejected a call');

      // 401 means our key is wrong or revoked — an operator problem, not the
      // customer's, so it must not read as "your card failed".
      if (response.status === 401) {
        throw new AppException(
          ErrorCode.PAYMENT_PROVIDER_ERROR,
          'Subo API kaliti notoʻgʻri yoki bekor qilingan',
          502,
        );
      }

      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        message,
        response.status === 404 ? 404 : 422,
      );
    }

    const parsed = safeParse<T>(text);
    if (parsed == null) {
      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        'Subo tushunarsiz javob qaytardi',
        502,
      );
    }
    return parsed;
  }
}

function safeParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Normalises a Subo order payload.
 *
 * `amountTiyin` arrives as a string (`"5000000"`) in responses but is sent as a
 * number, so it is coerced rather than trusted to be either.
 */
function toOrder(body: Record<string, unknown>): SuboOrder {
  return {
    orderId: String(body.orderId ?? ''),
    status: (body.status as SuboStatus) ?? 'PENDING',
    provider: (body.provider as SuboProvider | null) ?? null,
    checkoutUrl: String(body.checkoutUrl ?? ''),
    externalReference: (body.externalReference as string | null) ?? null,
    customerId: (body.customerId as string | null) ?? null,
    amountTiyin: Number(body.amountTiyin ?? 0),
    atmosTransactionId: (body.atmosTransactionId as string | null) ?? null,
    providerTransactionId: (body.providerTransactionId as string | null) ?? null,
    failureReason: (body.failureReason as string | null) ?? null,
    paidAt: (body.paidAt as string | null) ?? null,
    createdAt: String(body.createdAt ?? new Date().toISOString()),
    expiresAt: (body.expiresAt as string | null) ?? null,
  };
}
