import type {
  CampaignKind,
  CheckoutPaymentOption,
  CustomerNotificationType,
  Gender,
  NotificationCategory,
  OnlinePaymentProvider,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  PromoCodeType,
  RecommendationPlacement,
} from '../enums';
import type { CreateOrderItemRequest, Order } from './order';

/**
 * The customer side of the storefront (TZ 48): what the Telegram Mini App
 * reads and writes about the signed-in customer.
 *
 * Everything here belongs to ONE person, identified by the verified session —
 * never by an id in a request. A customer account spans restaurants, so lists
 * (orders, favourites, notifications) carry the restaurant they came from.
 */

/* -------------------------------------------------------------------------- */
/* The restaurant, as the storefront sees it                                   */
/* -------------------------------------------------------------------------- */

/** Public: what a storefront needs before anyone signs in. */
export interface StorefrontInfo {
  restaurant: {
    name: string;
    slug: string;
    logoUrl: string | null;
    /** White-label colour; RESTOR orange when the restaurant set none. */
    primaryColor: string;
    phone: string | null;
    /** The restaurant's own bot, for "Yordam xizmati". */
    botUsername: string | null;
  };
  /** A promo banner across the top of the menu; null when none is set. */
  banner: { imageUrl: string | null; title: string | null; text: string | null } | null;
  checkout: StorefrontCheckoutOptions;
}

export interface StorefrontCheckoutOptions {
  /**
   * Only options a customer can actually complete right now, in display
   * order. An online provider is absent while the restaurant's Subo key is
   * missing or inactive, whatever the settings say.
   */
  paymentOptions: CheckoutPaymentOption[];
  cutleryEnabled: boolean;
  leaveAtDoorEnabled: boolean;
  /** Delivery addresses must carry map coordinates; checked by the server too. */
  requireMapPin: boolean;
}

/** The admin view of the same settings. */
export interface StorefrontSettings {
  cashEnabled: boolean;
  onlineProviders: OnlinePaymentProvider[];
  cutleryEnabled: boolean;
  leaveAtDoorEnabled: boolean;
  /** `#RRGGBB`, or null to use the tenant's white-label colour. */
  accentColor: string | null;
  /** The tenant's white-label colour, shown as the fallback. */
  brandColor: string;
  bannerUrl: string | null;
  bannerTitle: string | null;
  bannerText: string | null;
  requireMapPin: boolean;
  /**
   * Whether the restaurant's Subo key is stored and active. While false the
   * online providers are saved but not offered to customers.
   */
  onlineAvailable: boolean;
}

export type UpdateStorefrontSettingsRequest = Partial<
  Omit<StorefrontSettings, 'onlineAvailable' | 'brandColor'>
>;

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

/** The three fields an order cannot be placed without. */
export type RequiredProfileField = 'firstName' | 'lastName' | 'phone';

export interface CustomerProfile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  /** E.164. Typed by the customer and NOT verified — see `phoneVerified`. */
  phone: string | null;
  /** True only after a real SMS check, which does not exist yet. */
  phoneVerified: boolean;
  email: string | null;
  /** `YYYY-MM-DD`. */
  birthDate: string | null;
  gender: Gender | null;
  /** What Telegram reports — for the avatar and a greeting, never an order. */
  telegram: {
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    photoUrl: string | null;
  };
  /** Order updates through the restaurant's bot. */
  notifyTelegram: boolean;
  /** Promotions and new dishes. Off until the customer opts in. */
  marketingOptIn: boolean;
  /** Which required fields are still empty; checkout asks for exactly these. */
  missingFields: RequiredProfileField[];
}

export interface UpdateCustomerProfileRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string | null;
  birthDate?: string | null;
  gender?: Gender | null;
  notifyTelegram?: boolean;
  marketingOptIn?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                  */
/* -------------------------------------------------------------------------- */

export interface SavedAddress {
  id: string;
  label: string | null;
  /** Street line. */
  address: string;
  house: string | null;
  latitude: number | null;
  longitude: number | null;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  intercom: string | null;
  /** Standing note for couriers. */
  comment: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveAddressRequest {
  label?: string | null;
  address: string;
  house?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  apartment?: string | null;
  entrance?: string | null;
  floor?: string | null;
  intercom?: string | null;
  comment?: string | null;
  isDefault?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Favourites                                                                 */
/* -------------------------------------------------------------------------- */

export interface FavoriteProduct {
  productId: string;
  restaurantName: string;
  restaurantSlug: string;
  /** True when it belongs to the restaurant this session is for — only those
   *  can go into this cart. */
  isCurrentRestaurant: boolean;
  name: string;
  imageUrl: string | null;
  /** List price; the branch menu is what prices a cart. */
  price: number;
  /** False once the restaurant retired the product. */
  isActive: boolean;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export interface CustomerNotificationItem {
  id: string;
  type: CustomerNotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  /** `null` for a RESTOR-wide service message. */
  restaurantName: string | null;
  orderId: string | null;
  productId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface MarkNotificationsReadRequest {
  /** Omit to mark everything read. */
  ids?: string[];
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

export interface MyOrderSummary {
  id: string;
  displayNumber: string;
  restaurantName: string;
  restaurantSlug: string;
  isCurrentRestaurant: boolean;
  branchName: string | null;
  type: OrderType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  paymentProvider: string | null;
  total: number;
  itemCount: number;
  /** First few line names, for the list row. */
  itemsPreview: string[];
  createdAt: string;
}

export interface MyOrderDetail {
  order: Order;
  restaurantName: string;
  restaurantSlug: string;
  isCurrentRestaurant: boolean;
  /**
   * An online order that is still owed and not cancelled. The retry reuses the
   * same order — and Subo's live session when there is one.
   */
  canRetryPayment: boolean;
}

/* -------------------------------------------------------------------------- */
/* Promo codes                                                                */
/* -------------------------------------------------------------------------- */

export interface PublicPromoCode {
  id: string;
  code: string;
  type: PromoCodeType;
  /** Percent for PERCENTAGE, soʻm for FIXED, unused for FREE_DELIVERY. */
  discount: number;
  maxDiscount: number | null;
  minOrderAmount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  description: string | null;
  /** Empty means every branch. */
  branchNames: string[];
  /** How many more times THIS customer may use it; `null` is unlimited. */
  usesLeft: number | null;
}

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where a delivery goes: a saved address, optionally with corrected details,
 * or a one-off address typed at checkout.
 */
export interface CheckoutAddress {
  addressId?: string;
  label?: string | null;
  address?: string;
  house?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  apartment?: string | null;
  entrance?: string | null;
  floor?: string | null;
  intercom?: string | null;
  /** Standing courier note; a one-off note goes in `courierComment`. */
  comment?: string | null;
  /**
   * Write apartment / entrance / floor / intercom back to the saved address,
   * so the customer does not type them again next time. Default true.
   */
  saveDetails?: boolean;
}

export interface CheckoutRequest {
  branchId: string;
  type: OrderType;
  items: CreateOrderItemRequest[];
  promoCode?: string | null;
  /** Note to the restaurant. */
  comment?: string | null;
  courierComment?: string | null;
  cutleryCount?: number | null;
  leaveAtDoor?: boolean;
  address?: CheckoutAddress;
  paymentOption: CheckoutPaymentOption;
  /**
   * Generated once per checkout attempt and reused on retry, so a double tap
   * or a lost response returns the same order instead of a second one.
   */
  clientUuid: string;
  /** Where Subo sends the customer back to. */
  returnUrl?: string;
}

/** Prices the checkout as the session's customer: promo limits per person. */
export type CheckoutPreviewRequest = Omit<CheckoutRequest, 'paymentOption' | 'clientUuid' | 'returnUrl'>;

export interface OnlineCheckoutLink {
  /** Subo's hosted page; valid about 30 minutes. */
  checkoutUrl: string;
  expiresAt: string | null;
  amount: number;
}

export interface CheckoutResult {
  order: Order;
  /** Set for an online order whose payment page is ready. */
  payment: OnlineCheckoutLink | null;
  /**
   * Set when the order was created but the payment page could not be opened
   * (provider down, not connected). The order stays UNPAID; the customer can
   * retry from the order screen without creating a second order.
   */
  paymentError: string | null;
}

/* -------------------------------------------------------------------------- */
/* Recommendations (admin)                                                    */
/* -------------------------------------------------------------------------- */

export interface RecommendationTarget {
  kind: 'PRODUCT' | 'CATEGORY';
  /** Product or category id. */
  id: string;
  /** For display in the editor. */
  name: string;
}

/**
 * One list. `sourceProductId` is the product whose sheet shows it, or `null`
 * for the default product-sheet list and for the cart list.
 */
export interface RecommendationList {
  placement: RecommendationPlacement;
  sourceProductId: string | null;
  sourceProductName: string | null;
  targets: RecommendationTarget[];
}

export interface SaveRecommendationListRequest {
  placement: RecommendationPlacement;
  sourceProductId?: string | null;
  /** Replaces the whole list, in this order. */
  targets: Array<{ productId: string } | { categoryId: string }>;
}

/* -------------------------------------------------------------------------- */
/* Marketing campaigns (admin)                                                */
/* -------------------------------------------------------------------------- */

export interface MarketingCampaign {
  id: string;
  kind: CampaignKind;
  title: string;
  body: string;
  productId: string | null;
  productName: string | null;
  promoCodeId: string | null;
  promoCode: string | null;
  recipientCount: number;
  telegramQueued: number;
  createdByName: string | null;
  createdAt: string;
}

export interface CreateCampaignRequest {
  kind: CampaignKind;
  title: string;
  body: string;
  productId?: string | null;
  promoCodeId?: string | null;
}

/** Who a send would reach, and when the next one is allowed. */
export interface CampaignAudience {
  /** Customers of this restaurant who opted in to marketing. */
  optedIn: number;
  /** When the cooling-off window ends; `null` means a send is allowed now. */
  nextAllowedAt: string | null;
  /** Hours between two sends — shown so the limit is not a surprise. */
  cooldownHours: number;
}

/* -------------------------------------------------------------------------- */
/* Geo                                                                        */
/* -------------------------------------------------------------------------- */

/** A place from the geocoder, for filling an address from a map pin. */
export interface GeoPlace {
  /** One line, as it should appear in the address field. */
  label: string;
  street: string | null;
  house: string | null;
  latitude: number;
  longitude: number;
}
