import {
  CheckoutPaymentOption,
  OnlinePaymentProvider,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@restor/shared-types';

/**
 * Storefront decisions extracted as pure functions (TZ 48).
 *
 * Each of these decides something a customer is charged or promised — which
 * payment buttons appear, what is written to an order, whether "pay again" is
 * offered — and each fails silently when wrong. Kept here so the tests can
 * pin them without a database.
 */

/** The online options in the order the checkout lists them. */
const ONLINE_ORDER: readonly OnlinePaymentProvider[] = [
  OnlinePaymentProvider.ATMOS,
  OnlinePaymentProvider.CLICK,
  OnlinePaymentProvider.PAYME,
];

/**
 * What the checkout may offer.
 *
 * An online provider appears only when the restaurant enabled it AND its Subo
 * key is active: a button that opens a payment page which then refuses is
 * worse than no button. Cash is last, because a card in hand is the faster
 * path for a customer who has one.
 */
export function availablePaymentOptions(
  settings: { cashEnabled: boolean; onlineProviders: readonly string[] },
  onlineAvailable: boolean,
): CheckoutPaymentOption[] {
  const options: CheckoutPaymentOption[] = [];

  if (onlineAvailable) {
    for (const provider of ONLINE_ORDER) {
      if (settings.onlineProviders.includes(provider)) options.push(provider);
    }
  }
  if (settings.cashEnabled) options.push(CheckoutPaymentOption.CASH);

  return options;
}

/** What a checkout option is recorded as on the order. */
export function paymentIntentFor(option: CheckoutPaymentOption): {
  method: PaymentMethod;
  provider: OnlinePaymentProvider | null;
} {
  if (option === CheckoutPaymentOption.CASH) {
    return { method: PaymentMethod.CASH, provider: null };
  }
  return { method: PaymentMethod.SUBO, provider: option };
}

/**
 * Whether the customer may be sent to pay this order again.
 *
 * Only an online order, still owed, not cancelled. A cash order is settled by
 * the courier; a paid one has nothing to pay; a cancelled one must not take
 * money. The retry reuses the same order — and Subo's live session when one
 * exists — so it can never create a second order or a second charge.
 */
export function canRetryPayment(order: {
  paymentMethod: PaymentMethod | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: number;
  paidTotal: number;
}): boolean {
  if (order.paymentMethod !== PaymentMethod.SUBO) return false;
  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) return false;
  if (order.paymentStatus !== PaymentStatus.UNPAID && order.paymentStatus !== PaymentStatus.PARTIALLY_PAID) {
    return false;
  }
  return order.total - order.paidTotal > 0;
}

/** The address details a customer types at the door, as stored. */
export interface AddressDetails {
  house: string | null;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  intercom: string | null;
  comment: string | null;
}

const DETAIL_FIELDS: ReadonlyArray<keyof AddressDetails> = [
  'house',
  'apartment',
  'entrance',
  'floor',
  'intercom',
  'comment',
];

/**
 * Which standing details a checkout should write back to the saved address.
 *
 * Only fields the customer actually sent (`undefined` means "not touched"),
 * and only where they differ — so a checkout that changed nothing does not
 * bump `updatedAt`, and one that cleared the floor does clear it. Empty
 * strings are stored as `null`.
 */
export function addressDetailsPatch(
  saved: AddressDetails,
  submitted: Partial<Record<keyof AddressDetails, string | null | undefined>>,
): Partial<AddressDetails> {
  const patch: Partial<AddressDetails> = {};

  for (const field of DETAIL_FIELDS) {
    const raw = submitted[field];
    if (raw === undefined) continue;
    const next = raw?.trim() ? raw.trim() : null;
    if (next !== saved[field]) patch[field] = next;
  }

  return patch;
}

/** `Uzum Bogʻi 2-tor koʻchasi, 280A` — the street line plus the house. */
export function addressLine(address: string, house: string | null | undefined): string {
  const street = address.trim();
  const number = house?.trim();
  if (!number) return street;
  // Do not repeat a house number the geocoder already put in the street line.
  if (street.endsWith(number)) return street;
  return `${street}, ${number}`;
}

/** How many more times a customer may use a code; `null` is unlimited. */
export function promoUsesLeft(userLimit: number | null, usedByCustomer: number): number | null {
  if (userLimit == null) return null;
  return Math.max(0, userLimit - usedByCustomer);
}
