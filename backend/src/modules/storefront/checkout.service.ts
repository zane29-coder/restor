import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  OrderSource,
  OrderType,
  PaymentMethod,
  type CheckoutResult,
  type OrderPricePreview,
} from '@restor/shared-types';
import { fullNameOf, missingProfileFields } from '@restor/shared-utils';
import type { CheckoutInput, CheckoutPreviewInput, CreateOrderInput } from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../database/prisma.service';
import { OrderPricingService } from '../orders/order-pricing.service';
import { OrdersService } from '../orders/orders.service';
import { SuboService } from '../payments/subo.service';
import { CustomerProfileService } from './customer-profile.service';
import { requireCustomerSession, type CustomerSession } from './customer-session';
import { StorefrontSettingsService } from './storefront-settings.service';
import { addressDetailsPatch, addressLine, paymentIntentFor } from './storefront.math';

/** The delivery target, already resolved and ready to be copied onto an order. */
interface ResolvedAddress {
  savedId: string | null;
  label: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  entrance: string | null;
  floor: string | null;
  apartment: string | null;
  intercom: string | null;
  comment: string | null;
}

/**
 * Placing an order from the Mini App (TZ 48 §14, §21, §24).
 *
 * The sequence, in one place so it can be read top to bottom:
 *
 *   1. who is asking — from the verified session only;
 *   2. the profile has a name, surname and phone, or the customer is asked
 *      for exactly the missing ones (`PROFILE_INCOMPLETE`) and resubmits the
 *      same checkout — same `clientUuid`, so no duplicate can result;
 *   3. the payment option is one this restaurant offers right now;
 *   4. the address: a saved one, with any corrected details written back;
 *   5. the order, through the ONE order path every client uses — server
 *      pricing, modifier validation, promo checks, idempotency on
 *      `clientUuid`;
 *   6. for an online option, the Subo checkout. The order is created first
 *      and stays UNPAID until Subo's own API says otherwise: a customer
 *      coming back from the payment page proves nothing.
 *
 * Order status and payment status stay separate throughout: an online order
 * is a NEW order that is UNPAID, which is exactly what the restaurant sees.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly pricing: OrderPricingService,
    private readonly subo: SuboService,
    private readonly profiles: CustomerProfileService,
    private readonly settings: StorefrontSettingsService,
  ) {}

  /** The exact breakdown the customer will be charged — priced as THEM, so a
   *  per-customer promo limit shows up here and not as a surprise later. */
  async preview(input: CheckoutPreviewInput): Promise<OrderPricePreview> {
    const session = await requireCustomerSession(this.prisma);
    const address =
      input.type === OrderType.DELIVERY && input.address
        ? await this.resolveAddress(session, input.address, false)
        : null;

    const priced = await this.pricing.price({
      branchId: input.branchId,
      type: input.type,
      items: input.items,
      promoCode: input.promoCode ?? undefined,
      customerId: session.customerId,
      deliveryLatitude: address?.latitude ?? null,
      deliveryLongitude: address?.longitude ?? null,
    });

    return this.pricing.toPreview(priced);
  }

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    const session = await requireCustomerSession(this.prisma);

    // 2. The profile.
    const account = await this.profiles.account(session.accountId);
    const missing = missingProfileFields(account);
    if (missing.length > 0) {
      throw new AppException(
        ErrorCode.PROFILE_INCOMPLETE,
        'Buyurtma uchun ism, familiya va telefon raqamingiz kerak',
        422,
        { missing },
      );
    }
    const fullName = fullNameOf(account)!;
    const phone = account.phone!;

    // 3. The payment option.
    const options = await this.settings.checkoutOptions();
    if (!options.paymentOptions.includes(input.paymentOption)) {
      throw new AppException(
        ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
        'Bu toʻlov usuli hozir mavjud emas. Boshqasini tanlang',
        422,
      );
    }
    const intent = paymentIntentFor(input.paymentOption);

    // The branch must take this kind of order. Delivery is also checked by
    // pricing (with the radius); pickup has no other guard.
    const branch = await this.prisma.db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, isActive: true },
      select: { acceptsDelivery: true, acceptsPickup: true },
    });
    if (!branch) throw AppException.notFound('Branch', ErrorCode.BRANCH_NOT_FOUND);
    if (input.type === OrderType.PICKUP && !branch.acceptsPickup) {
      throw AppException.badRequest('Bu filialdan olib ketish mumkin emas');
    }
    if (input.type === OrderType.DELIVERY && !branch.acceptsDelivery) {
      throw AppException.badRequest('Bu filial yetkazib bermaydi');
    }

    // 4. The address.
    const address =
      input.type === OrderType.DELIVERY && input.address
        ? await this.resolveAddress(session, input.address, input.address.saveDetails)
        : null;

    // A restaurant that asks for a map pin gets one: a typed address alone
    // sends couriers hunting, and zone pricing needs the coordinates.
    if (address && options.requireMapPin && (address.latitude === null || address.longitude === null)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Manzilni xaritada belgilang — bu restoran aniq nuqtani talab qiladi',
        422,
        { address: ['Xaritada belgilanmagan'] },
      );
    }

    // This restaurant learns who the customer is now, because it has an
    // order to fulfil — not when the Mini App was merely opened.
    await this.shareContactWithRestaurant(session.customerId, fullName, phone);

    // 5. The order.
    const orderInput: CreateOrderInput = {
      branchId: input.branchId,
      type: input.type,
      source: OrderSource.TELEGRAM_MINI_APP,
      items: input.items,
      customer: { name: fullName, phone },
      ...(address
        ? {
            deliveryAddress: {
              label: address.label,
              address: address.address,
              latitude: address.latitude,
              longitude: address.longitude,
              entrance: address.entrance,
              floor: address.floor,
              apartment: address.apartment,
              intercom: address.intercom,
              comment: address.comment,
            },
          }
        : {}),
      promoCode: input.promoCode ?? null,
      comment: input.comment ?? null,
      courierComment: input.type === OrderType.DELIVERY ? (input.courierComment ?? null) : null,
      // Recorded only when the restaurant asks; otherwise a stale value from
      // the client would print on a ticket nobody expects it on.
      cutleryCount: options.cutleryEnabled ? (input.cutleryCount ?? null) : null,
      leaveAtDoor:
        input.type === OrderType.DELIVERY && options.leaveAtDoorEnabled ? input.leaveAtDoor : false,
      paymentMethod: intent.method,
      ...(intent.provider ? { paymentProvider: intent.provider } : {}),
      clientUuid: input.clientUuid,
    };

    const order = await this.orders.create(orderInput, { customerId: session.customerId });

    // A replayed `clientUuid` returns the original order. It must be OURS:
    // the key is client-generated, so another customer's would otherwise
    // hand back their order.
    if (order.customerId !== session.customerId) {
      throw new AppException(ErrorCode.DUPLICATE_ORDER, 'Buyurtmani qayta yuboring', 409);
    }

    // 6. Online payment.
    if (intent.method !== PaymentMethod.SUBO) {
      return { order, payment: null, paymentError: null };
    }

    if (order.total - order.paidTotal <= 0) {
      // Fully discounted, or a replay of an order already paid.
      return { order, payment: null, paymentError: null };
    }

    try {
      const returnUrl = await this.returnUrl();
      const checkout = await this.subo.startCheckout({
        orderId: order.id,
        provider: intent.provider ?? undefined,
        ...(returnUrl ? { returnUrl } : {}),
      });
      return {
        order,
        payment: {
          checkoutUrl: checkout.checkoutUrl,
          expiresAt: checkout.expiresAt,
          amount: checkout.amount,
        },
        paymentError: null,
      };
    } catch (error) {
      // The order exists and stays UNPAID; the customer can retry from the
      // order screen, which reuses this order rather than creating another.
      this.logger.warn({ err: error, orderId: order.id }, 'Online checkout could not start');
      return {
        order,
        payment: null,
        paymentError:
          error instanceof AppException
            ? (error.getResponse() as { message?: string }).message ?? 'Toʻlov sahifasi ochilmadi'
            : 'Toʻlov sahifasi ochilmadi',
      };
    }
  }

  /* ------------------------------------------------------------------ */

  /**
   * A saved address with the customer's corrections, or a one-off address.
   *
   * Standing details (apartment, entrance, floor, intercom, the courier note
   * on the address) are written back to the saved address when asked, so the
   * customer types them once. The order still gets its own copy — editing
   * the address later never rewrites an old order.
   */
  private async resolveAddress(
    session: CustomerSession,
    input: NonNullable<CheckoutInput['address']>,
    saveDetails: boolean,
  ): Promise<ResolvedAddress> {
    if (input.addressId) {
      const saved = await this.profiles.ownedAddress(session.accountId, input.addressId);

      const patch = addressDetailsPatch(saved, {
        house: input.house,
        apartment: input.apartment,
        entrance: input.entrance,
        floor: input.floor,
        intercom: input.intercom,
        comment: input.comment,
      });
      const merged = { ...saved, ...patch };

      if (saveDetails && Object.keys(patch).length > 0) {
        await this.prisma.db.customerAccountAddress.update({
          where: { id: saved.id },
          data: patch,
        });
      }

      return {
        savedId: saved.id,
        label: merged.label,
        address: addressLine(merged.address, merged.house),
        latitude: merged.latitude,
        longitude: merged.longitude,
        entrance: merged.entrance,
        floor: merged.floor,
        apartment: merged.apartment,
        intercom: merged.intercom,
        comment: merged.comment,
      };
    }

    if (!input.address) {
      throw AppException.badRequest('Yetkazib berish manzilini tanlang');
    }

    const blank = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
    return {
      savedId: null,
      label: blank(input.label),
      address: addressLine(input.address, input.house),
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      entrance: blank(input.entrance),
      floor: blank(input.floor),
      apartment: blank(input.apartment),
      intercom: blank(input.intercom),
      comment: blank(input.comment),
    };
  }

  /**
   * Copies the name and phone onto this restaurant's own customer record.
   *
   * The phone is the restaurant's natural key. If another of its records
   * already holds the number — a regular who once phoned an order in — this
   * one keeps its placeholder rather than taking it over: the number is
   * unverified, and merging on it would hand one person's history, points
   * and addresses to whoever typed their number. The order itself carries the
   * real number either way.
   */
  private async shareContactWithRestaurant(
    customerId: string,
    fullName: string,
    phone: string,
  ): Promise<void> {
    try {
      await this.prisma.db.customer.update({
        where: { id: customerId },
        data: { fullName, phone },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.prisma.db.customer.update({ where: { id: customerId }, data: { fullName } });
        return;
      }
      throw error;
    }
  }

  /**
   * Where Subo sends the customer after paying: back to the restaurant's bot
   * chat, where the payment notification lands. Opening the Mini App URL in
   * the payment browser instead would load it outside Telegram, with no
   * session.
   */
  private async returnUrl(): Promise<string | null> {
    const bot = await this.prisma.db.telegramConfig.findFirst({
      where: { branchId: null, isActive: true },
      select: { botUsername: true },
    });
    return bot?.botUsername ? `https://t.me/${bot.botUsername}` : null;
  }
}
