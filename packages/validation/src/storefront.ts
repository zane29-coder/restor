import { z } from 'zod';
import {
  CampaignKind,
  CheckoutPaymentOption,
  Gender,
  OnlinePaymentProvider,
  OrderType,
  RecommendationPlacement,
} from '@restor/shared-types';
import { orderItemSchema } from './order';
import { emailSchema, latitudeSchema, longitudeSchema, phoneSchema, uuidSchema } from './primitives';

/**
 * The customer side of the storefront (TZ 48).
 *
 * Messages here reach a customer's screen, so they are Uzbek. None of these
 * schemas accepts an account or customer id — who is asking comes from the
 * verified session, never from the body.
 */

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A personal name: letters (any script), spaces, apostrophes and hyphens.
 * Uzbek names carry both `ʻ` and `'` — `Gʻofur`, `O'g'iloy` — so both pass.
 */
const personNameSchema = z
  .string()
  .trim()
  .min(2, 'Kamida 2 ta harf kiriting')
  .max(60, 'Juda uzun')
  .regex(/^[\p{L}][\p{L}\p{M}' ʻʼ`’-]*$/u, 'Faqat harflar kiritilishi mumkin');

/**
 * Uzbek mobile numbers only for now: the checkout is a delivery to a door in
 * Uzbekistan, and a courier has to be able to ring it.
 */
const uzPhoneSchema = phoneSchema.refine(
  // Zod still runs this after `phoneSchema` rejected the value, handing it
  // a non-string; that case is already an issue, so it simply does not add one.
  (value) => typeof value !== 'string' || value.startsWith('+998'),
  { message: 'Oʻzbekiston raqamini kiriting: +998 XX XXX XX XX' },
);

const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD koʻrinishida boʻlsin')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return false;
    const year = date.getUTCFullYear();
    return year >= 1900 && date.getTime() <= Date.now();
  }, 'Tugʻilgan sana notoʻgʻri');

export const updateCustomerProfileSchema = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    phone: uzPhoneSchema.optional(),
    email: emailSchema.nullish(),
    birthDate: birthDateSchema.nullish(),
    gender: z.nativeEnum(Gender).nullish(),
    notifyTelegram: z.boolean().optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Oʻzgartirish uchun kamida bitta maydon kiriting',
  });

/* -------------------------------------------------------------------------- */
/* Addresses                                                                  */
/* -------------------------------------------------------------------------- */

const shortField = (max: number) => z.string().trim().max(max, 'Juda uzun').nullish();

const addressFields = {
  label: shortField(60),
  address: z.string().trim().min(3, 'Manzilni kiriting').max(500),
  house: shortField(20),
  latitude: latitudeSchema.nullish(),
  longitude: longitudeSchema.nullish(),
  apartment: shortField(20),
  entrance: shortField(20),
  floor: shortField(20),
  intercom: shortField(20),
  comment: shortField(500),
};

/** A pin needs both halves; one coordinate locates nothing. */
function coordinatesPaired(value: { latitude?: number | null; longitude?: number | null }) {
  return (value.latitude == null) === (value.longitude == null);
}

export const saveAddressSchema = z
  .object({ ...addressFields, isDefault: z.boolean().optional() })
  .refine(coordinatesPaired, {
    message: 'Xaritadagi nuqta toʻliq emas',
    path: ['latitude'],
  });

export const updateAddressSchema = z
  .object({
    ...addressFields,
    address: addressFields.address.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine(coordinatesPaired, {
    message: 'Xaritadagi nuqta toʻliq emas',
    path: ['latitude'],
  });

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

const checkoutAddressSchema = z
  .object({
    addressId: uuidSchema.optional(),
    ...addressFields,
    address: addressFields.address.optional(),
    saveDetails: z.boolean().default(true),
  })
  .refine((value) => Boolean(value.addressId || value.address), {
    message: 'Yetkazib berish manzilini tanlang',
    path: ['address'],
  })
  .refine(coordinatesPaired, {
    message: 'Xaritadagi nuqta toʻliq emas',
    path: ['latitude'],
  });

/**
 * The storefront supports the two order types a customer at home can place.
 * Dine-in and QR-table orders have their own flows.
 */
const storefrontOrderTypeSchema = z.enum([OrderType.DELIVERY, OrderType.PICKUP]);

/** What is common to pricing a checkout and placing it. Note: no prices. */
const checkoutBase = z.object({
  branchId: uuidSchema,
  type: storefrontOrderTypeSchema,
  items: z.array(orderItemSchema).min(1, 'Savat boʻsh').max(100),
  promoCode: z.string().trim().max(40).nullish(),
  comment: z.string().trim().max(500, 'Izoh juda uzun').nullish(),
  courierComment: z.string().trim().max(300, 'Izoh juda uzun').nullish(),
  cutleryCount: z.number().int().min(0).max(20).nullish(),
  leaveAtDoor: z.boolean().default(false),
  address: checkoutAddressSchema.optional(),
});

const deliveryNeedsAddress = (value: { type: string; address?: unknown }) =>
  value.type !== OrderType.DELIVERY || Boolean(value.address);

export const checkoutPreviewSchema = checkoutBase.refine(deliveryNeedsAddress, {
  message: 'Yetkazib berish manzilini tanlang',
  path: ['address'],
});

export const checkoutSchema = checkoutBase
  .extend({
    paymentOption: z.nativeEnum(CheckoutPaymentOption),
    /** Idempotency key, generated before the first attempt. */
    clientUuid: z.string().uuid(),
    returnUrl: z.string().url().max(2048).optional(),
  })
  .refine(deliveryNeedsAddress, {
    message: 'Yetkazib berish manzilini tanlang',
    path: ['address'],
  });

export const markNotificationsReadSchema = z.object({
  ids: z.array(uuidSchema).max(200).optional(),
});

/* -------------------------------------------------------------------------- */
/* Restaurant-side settings                                                   */
/* -------------------------------------------------------------------------- */

export const updateStorefrontSettingsSchema = z
  .object({
    cashEnabled: z.boolean().optional(),
    onlineProviders: z
      .array(z.nativeEnum(OnlinePaymentProvider))
      .max(3)
      .refine((list) => new Set(list).size === list.length, 'Takrorlanmasin')
      .optional(),
    cutleryEnabled: z.boolean().optional(),
    leaveAtDoorEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Oʻzgartirish uchun kamida bitta maydon kiriting',
  });

const recommendationTargetSchema = z.union([
  z.object({ productId: uuidSchema }).strict(),
  z.object({ categoryId: uuidSchema }).strict(),
]);

export const saveRecommendationListSchema = z
  .object({
    placement: z.nativeEnum(RecommendationPlacement),
    sourceProductId: uuidSchema.nullish(),
    targets: z.array(recommendationTargetSchema).max(30, 'Koʻpi bilan 30 ta'),
  })
  .refine(
    (value) => value.placement !== RecommendationPlacement.CART || !value.sourceProductId,
    { message: 'Savat tavsiyalari bitta mahsulotga bogʻlanmaydi', path: ['sourceProductId'] },
  );

export const recommendationListQuerySchema = z.object({
  placement: z.nativeEnum(RecommendationPlacement).optional(),
});

export const createCampaignSchema = z
  .object({
    kind: z.nativeEnum(CampaignKind),
    title: z.string().trim().min(3, 'Sarlavha juda qisqa').max(120),
    body: z.string().trim().min(3, 'Matn juda qisqa').max(1000),
    productId: uuidSchema.nullish(),
    promoCodeId: uuidSchema.nullish(),
  })
  .refine((value) => value.kind !== CampaignKind.NEW_PRODUCT || Boolean(value.productId), {
    message: 'Yangi mahsulot haqidagi xabar uchun mahsulotni tanlang',
    path: ['productId'],
  })
  .refine((value) => value.kind !== CampaignKind.PROMO_CODE || Boolean(value.promoCodeId), {
    message: 'Promo-kod haqidagi xabar uchun kodni tanlang',
    path: ['promoCodeId'],
  });

export const geoReverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const geoSearchQuerySchema = z.object({
  q: z.string().trim().min(3, 'Kamida 3 ta belgi').max(120),
  /** Biases results towards the branch the customer is ordering from. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export type UpdateCustomerProfileInput = z.infer<typeof updateCustomerProfileSchema>;
export type SaveAddressInput = z.infer<typeof saveAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CheckoutPreviewInput = z.infer<typeof checkoutPreviewSchema>;
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;
export type UpdateStorefrontSettingsInput = z.infer<typeof updateStorefrontSettingsSchema>;
export type SaveRecommendationListInput = z.infer<typeof saveRecommendationListSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type GeoReverseQuery = z.infer<typeof geoReverseQuerySchema>;
export type GeoSearchQuery = z.infer<typeof geoSearchQuerySchema>;
