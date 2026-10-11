import { Injectable, Logger } from '@nestjs/common';
import {
  CashTransactionType,
  DomainEvent,
  ErrorCode,
  OrderStatus,
  PaymentMethod,
  PaymentTransactionStatus,
  PaymentTransactionType,
  type Payment,
} from '@restor/shared-types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppException } from '../../common/errors/app-exception';
import { apiUrl } from '../../common/constants';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { getContext, runUnscoped } from '../../common/context/request-context';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { SuboApiClient, type SuboOrder, type SuboProvider } from '../../integrations/subo/subo-api.client';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.service';
import { paymentStatusFor, toPayment } from './payments.service';

const PROVIDER = 'SUBO';

/** What the client needs to send a customer to the checkout page. */
export interface SuboCheckout {
  paymentId: string;
  orderId: string;
  suboOrderId: string;
  checkoutUrl: string;
  expiresAt: string | null;
  amount: number;
  status: string;
}

/** Credentials as the admin UI may see them — never the key itself. */
export interface SuboConfigView {
  provider: string;
  hasKey: boolean;
  isSandbox: boolean;
  isActive: boolean;
  callbackUrl: string;
}

/**
 * Online payments through Subo (TZ §9, §35, §36).
 *
 * Subo aggregates Atmos, Click and Payme behind one hosted checkout, so this is
 * the only online-payment integration RESTOR needs. Two properties of their API
 * drive the design here:
 *
 * **Callbacks are unsigned.** Their documentation is explicit that a webhook is
 * a signal, not evidence, and that status must be read back from
 * `GET /orders/:id`. So nothing in this service credits an order from a request
 * body. The webhook handler looks up our payment row, asks Subo what actually
 * happened, and acts on that answer. A forged callback therefore achieves
 * nothing beyond one wasted API call.
 *
 * **Cards are saved against a customer id.** Passing our `Customer.id` as
 * `customerId` makes Atmos store the card on their side; the next checkout for
 * that customer offers it at one tap. We never see or store a card number —
 * only Subo does, which is the entire point of using them.
 */
@Injectable()
export class SuboService {
  private readonly logger = new Logger(SuboService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SuboApiClient,
    private readonly encryption: EncryptionService,
    private readonly cash: CashService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly config: AppConfig,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Credentials                                                        */
  /* ------------------------------------------------------------------ */

  async getConfig(): Promise<SuboConfigView> {
    const row = await this.prisma.db.paymentProviderConfig.findFirst({
      where: { provider: PROVIDER },
    });

    return {
      provider: PROVIDER,
      hasKey: Boolean(row?.apiKeyEncrypted),
      isSandbox: row?.isSandbox ?? false,
      isActive: row?.isActive ?? false,
      callbackUrl: this.callbackUrl(),
    };
  }

  /**
   * Stores the tenant's Subo API key.
   *
   * The key is encrypted immediately and never returned by any route — Subo
   * shows it once at creation, so a leak from here would be unrecoverable for
   * the restaurant. Sandbox mode is derived from the key's own prefix rather
   * than asked for separately, which removes a way to get it wrong.
   */
  async saveConfig(input: { apiKey?: string; isActive?: boolean }): Promise<SuboConfigView> {
    const tenantId = this.requireTenant();

    const existing = await this.prisma.db.paymentProviderConfig.findFirst({
      where: { provider: PROVIDER },
      select: { id: true, apiKeyEncrypted: true },
    });

    const trimmed = input.apiKey?.trim();
    if (trimmed && !this.encryption.isConfigured) {
      throw AppException.internal('ENCRYPTION_KEY sozlanmagan — kalitni saqlab boʻlmaydi');
    }
    if (!trimmed && !existing?.apiKeyEncrypted && input.isActive) {
      throw AppException.badRequest('Avval Subo API kalitini kiriting');
    }

    const data = {
      ...(trimmed
        ? {
            apiKeyEncrypted: this.encryption.encrypt(trimmed),
            isSandbox: SuboApiClient.isSandbox(trimmed),
          }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };

    if (existing) {
      await this.prisma.db.paymentProviderConfig.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.db.paymentProviderConfig.create({
        data: { tenantId, provider: PROVIDER, ...data },
      });
    }

    await this.audit.record({
      action: 'PAYMENT_PROVIDER_CONFIGURED',
      entity: 'PaymentProviderConfig',
      entityId: existing?.id ?? null,
      // Deliberately records THAT a key was set, never the key.
      newValue: { provider: PROVIDER, keyReplaced: Boolean(trimmed), isActive: input.isActive },
    });

    return this.getConfig();
  }

  /**
   * Whether online payment can be offered at all: a key is stored and the
   * platform has switched it on. The storefront hides every online option
   * while this is false, whatever the restaurant's checkout settings say.
   */
  async isAvailable(): Promise<boolean> {
    const config = await this.getConfig();
    return config.hasKey && config.isActive;
  }

  /* ------------------------------------------------------------------ */
  /* Checkout                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Starts (or resumes) an online payment for an order.
   *
   * Resuming matters: a customer who closed the tab must be sent back to the
   * same Subo session, not given a second one. Two live checkouts for one order
   * is how a customer ends up charged twice.
   */
  async startCheckout(input: { orderId: string; provider?: SuboProvider; returnUrl?: string }): Promise<SuboCheckout> {
    const apiKey = await this.requireApiKey();

    const order = await this.prisma.db.order.findFirst({
      where: { id: input.orderId },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        displayNumber: true,
        total: true,
        paidTotal: true,
        status: true,
        customerId: true,
        customerName: true,
        customerPhone: true,
      },
    });
    if (!order) throw AppException.notFound('Order', ErrorCode.ORDER_NOT_FOUND);

    if (order.status === OrderStatus.CANCELLED) {
      throw AppException.badRequest('Bekor qilingan buyurtmani toʻlab boʻlmaydi');
    }

    const outstanding = order.total - order.paidTotal;
    if (outstanding <= 0) {
      throw new AppException(
        ErrorCode.PAYMENT_ALREADY_PROCESSED,
        `${order.displayNumber} allaqachon toʻlangan`,
        409,
      );
    }

    const live = await this.findLiveCheckout(order.id, outstanding);
    if (live) {
      return this.toCheckout(live, order.id);
    }

    const suboOrder = await this.client.createOrder(apiKey, {
      amountTiyin: SuboApiClient.toTiyin(outstanding),
      provider: input.provider,
      description: `${order.displayNumber} — buyurtma toʻlovi`,
      // Subo treats this as idempotent, so a double-tap on "pay" returns the
      // same Subo order instead of creating a second one. Suffixed with the
      // amount so a later partial top-up is still a distinct charge.
      externalReference: `${order.id}:${outstanding}`,
      // Atmos saves the card against this id; the next checkout offers it.
      ...(order.customerId ? { customerId: order.customerId } : {}),
      ...(order.customerName ? { customerName: order.customerName } : {}),
      ...(order.customerPhone ? { customerContact: order.customerPhone } : {}),
      callbackUrl: this.callbackUrl(),
      ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
    });

    const payment = await this.prisma.db.payment.create({
      data: {
        tenantId: order.tenantId,
        branchId: order.branchId,
        orderId: order.id,
        method: PaymentMethod.SUBO,
        amount: outstanding,
        status: PaymentTransactionStatus.PENDING,
        externalId: suboOrder.orderId,
        provider: suboOrder.provider,
        checkoutUrl: suboOrder.checkoutUrl,
        checkoutExpiresAt: suboOrder.expiresAt ? new Date(suboOrder.expiresAt) : null,
        // No shift: an online payment has no cashier and touches no drawer.
        cashShiftId: null,
      },
    });

    this.logger.log(
      {
        orderId: order.id,
        paymentId: payment.id,
        suboOrderId: suboOrder.orderId,
        sandbox: SuboApiClient.isSandbox(apiKey),
      },
      'Subo checkout created',
    );

    return this.toCheckout(payment, order.id);
  }

  /* ------------------------------------------------------------------ */
  /* Webhook                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Handles a Subo callback.
   *
   * Runs unscoped and resolves the tenant from our own payment row: a webhook
   * arrives with no token and no tenant header, and trusting either from the
   * request would be the whole ballgame.
   *
   * The body is used for exactly one thing — which payment to look at. What
   * happened to it comes from Subo's API, as their documentation instructs.
   * Returns quietly for anything unrecognised: replying 200 to a callback we
   * cannot place stops Subo's five retries on an event that will never apply.
   */
  async handleCallback(body: { orderId?: unknown; externalReference?: unknown }): Promise<void> {
    const suboOrderId = typeof body.orderId === 'string' ? body.orderId : null;
    if (!suboOrderId) {
      this.logger.warn('Subo callback without an orderId — ignored');
      return;
    }

    const payment = await runUnscoped(() =>
      this.prisma.db.payment.findFirst({
        where: { method: PaymentMethod.SUBO, externalId: suboOrderId },
        select: { id: true, tenantId: true },
      }),
    );

    if (!payment) {
      this.logger.warn({ suboOrderId }, 'Subo callback for an unknown payment — ignored');
      return;
    }

    await this.reconcile(payment.id, payment.tenantId);
  }

  /**
   * Asks Subo what happened to a payment and applies the answer.
   *
   * Safe to call repeatedly: crediting is guarded by the payment's own status,
   * so a replayed callback, a retry and the reconciliation sweep can all run
   * against the same charge without double-crediting the order.
   */
  async reconcile(paymentId: string, tenantId: string): Promise<void> {
    const payment = await runUnscoped(() =>
      this.prisma.db.payment.findFirst({
        where: { id: paymentId },
        include: {
          order: {
            select: {
              id: true,
              tenantId: true,
              branchId: true,
              displayNumber: true,
              total: true,
              paidTotal: true,
              refundedTotal: true,
            },
          },
        },
      }),
    );

    if (!payment?.externalId) return;

    // Already settled one way or the other. Nothing a later callback can add.
    if (payment.status !== PaymentTransactionStatus.PENDING) {
      this.logger.log({ paymentId, status: payment.status }, 'Subo payment already settled');
      return;
    }

    const apiKey = await this.requireApiKeyFor(tenantId);
    const remote = await this.client.getOrder(apiKey, payment.externalId);

    if (remote.status === 'PENDING') return;

    if (remote.status !== 'PAID') {
      await runUnscoped(() =>
        this.prisma.db.payment.update({
          where: { id: paymentId },
          data: {
            status:
              remote.status === 'EXPIRED'
                ? PaymentTransactionStatus.CANCELLED
                : PaymentTransactionStatus.FAILED,
            provider: remote.provider,
          },
        }),
      );
      await this.recordTransaction(paymentId, remote, PaymentTransactionStatus.FAILED);
      this.logger.log(
        { paymentId, status: remote.status, reason: remote.failureReason },
        'Subo payment did not succeed',
      );

      // The customer is told through their inbox and bot that the payment
      // did not go through, so they can retry from the order — the order
      // itself stays as it was, unpaid.
      this.events.emit(DomainEvent.PAYMENT_FAILED, {
        tenantId: payment.order.tenantId,
        branchId: payment.order.branchId,
        requestId: getContext()?.requestId ?? null,
        actorUserId: null,
        occurredAt: new Date().toISOString(),
        orderId: payment.order.id,
        displayNumber: payment.order.displayNumber,
        paymentId,
        method: PaymentMethod.SUBO,
        amount: payment.amount,
        isFullyPaid: false,
      });
      return;
    }

    // Subo is the authority on the amount too: crediting our own expectation
    // would let a partial capture look like a full one.
    const paidAmount = SuboApiClient.fromTiyin(remote.amountTiyin);
    const order = payment.order;

    await runUnscoped(() =>
      this.prisma.transaction(async (tx) => {
        // Re-read inside the transaction so two concurrent callbacks cannot
        // both pass the PENDING check and credit the order twice.
        const current = await tx.payment.findUnique({
          where: { id: paymentId },
          select: { status: true },
        });
        if (current?.status !== PaymentTransactionStatus.PENDING) return;

        await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: PaymentTransactionStatus.SUCCESS,
            amount: paidAmount,
            provider: remote.provider,
            paidAt: remote.paidAt ? new Date(remote.paidAt) : new Date(),
          },
        });

        const paidTotal = order.paidTotal + paidAmount;
        await tx.order.update({
          where: { id: order.id },
          data: {
            paidTotal,
            paymentStatus: paymentStatusFor(order.total, paidTotal, order.refundedTotal),
          },
        });

        // An online payment reaches an open shift's takings but not its
        // drawer; `shiftDeltaFor` keeps `expectedCash` untouched for it.
        const shift = await tx.cashShift.findFirst({
          where: { branchId: order.branchId, status: 'OPEN' },
          select: { id: true },
        });
        if (shift) {
          await this.cash.record(tx, {
            tenantId: order.tenantId,
            branchId: order.branchId,
            cashShiftId: shift.id,
            type: CashTransactionType.SALE,
            method: PaymentMethod.SUBO,
            amount: paidAmount,
            orderId: order.id,
            comment: `${order.displayNumber} — ${remote.provider ?? 'Subo'}`,
            createdByUserId: null,
          });
          await tx.payment.update({
            where: { id: paymentId },
            data: { cashShiftId: shift.id },
          });
        }
      }),
    );

    await this.recordTransaction(paymentId, remote, PaymentTransactionStatus.SUCCESS);

    this.events.emit(DomainEvent.PAYMENT_RECEIVED, {
      tenantId: order.tenantId,
      branchId: order.branchId,
      requestId: getContext()?.requestId ?? null,
      actorUserId: null,
      occurredAt: new Date().toISOString(),
      orderId: order.id,
      paymentId,
      method: PaymentMethod.SUBO,
      amount: paidAmount,
    });

    this.logger.log(
      { paymentId, orderId: order.id, amount: paidAmount, provider: remote.provider },
      'Subo payment credited',
    );
  }

  /** Our payment rows for an order, so a client can resume or poll. */
  async listCheckouts(orderId: string): Promise<Payment[]> {
    const rows = await this.prisma.db.payment.findMany({
      where: { orderId, method: PaymentMethod.SUBO },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPayment);
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Writes the provider's raw answer for reconciliation.
   *
   * `idempotencyKey` is unique, so a replayed callback collides here instead of
   * adding a duplicate row. The insert is allowed to fail for that reason and
   * only that reason.
   */
  private async recordTransaction(
    paymentId: string,
    remote: SuboOrder,
    status: PaymentTransactionStatus,
  ): Promise<void> {
    try {
      await runUnscoped(() =>
        this.prisma.db.paymentTransaction.create({
          data: {
            paymentId,
            type: PaymentTransactionType.CHARGE,
            amount: SuboApiClient.fromTiyin(remote.amountTiyin),
            status,
            externalId: remote.orderId,
            idempotencyKey: `subo:${remote.orderId}:${remote.status}`,
            rawPayload: remote as unknown as object,
            errorMessage: remote.failureReason,
          },
        }),
      );
    } catch {
      // Unique violation: this exact provider event is already recorded.
      this.logger.log({ paymentId, suboOrderId: remote.orderId }, 'Subo event already recorded');
    }
  }

  /**
   * An existing, still-usable checkout for this order and amount.
   *
   * Subo expires a session after 30 minutes; one that has lapsed is no use, so
   * a new one is created rather than handing back a dead link.
   */
  private async findLiveCheckout(orderId: string, amount: number) {
    return this.prisma.db.payment.findFirst({
      where: {
        orderId,
        method: PaymentMethod.SUBO,
        status: PaymentTransactionStatus.PENDING,
        amount,
        checkoutExpiresAt: { gt: new Date(Date.now() + 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private toCheckout(
    payment: {
      id: string;
      externalId: string | null;
      checkoutUrl: string | null;
      checkoutExpiresAt: Date | null;
      amount: number;
      status: string;
    },
    orderId: string,
  ): SuboCheckout {
    return {
      paymentId: payment.id,
      orderId,
      suboOrderId: payment.externalId ?? '',
      checkoutUrl: payment.checkoutUrl ?? '',
      expiresAt: payment.checkoutExpiresAt?.toISOString() ?? null,
      amount: payment.amount,
      status: payment.status,
    };
  }

  /**
   * Where Subo should POST its callbacks.
   *
   * Built through `apiUrl` so it carries the global prefix. Without it the
   * callback lands on the static site, which answers 405; Subo retries five
   * times, gives up, and the charge sits PENDING until someone reconciles it
   * by hand. The customer has paid and the order does not know.
   */
  private callbackUrl(): string {
    return apiUrl(this.config.apiBaseUrl, 'webhooks/subo');
  }

  private async requireApiKey(): Promise<string> {
    const row = await this.prisma.db.paymentProviderConfig.findFirst({
      where: { provider: PROVIDER, isActive: true },
      select: { apiKeyEncrypted: true },
    });

    const key = this.encryption.tryDecrypt(row?.apiKeyEncrypted);
    if (!key) {
      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        'Onlayn toʻlov sozlanmagan — Subo API kalitini kiriting',
        422,
      );
    }
    return key;
  }

  /** The same, for a webhook where no tenant is in context yet. */
  private async requireApiKeyFor(tenantId: string): Promise<string> {
    const row = await runUnscoped(() =>
      this.prisma.db.paymentProviderConfig.findFirst({
        where: { tenantId, provider: PROVIDER },
        select: { apiKeyEncrypted: true },
      }),
    );

    const key = this.encryption.tryDecrypt(row?.apiKeyEncrypted);
    if (!key) {
      throw new AppException(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        'Subo API kaliti topilmadi',
        422,
      );
    }
    return key;
  }

  private requireTenant(): string {
    const tenantId = getContext()?.tenantId;
    if (!tenantId) throw AppException.badRequest('Restoran aniqlanmadi');
    return tenantId;
  }
}
