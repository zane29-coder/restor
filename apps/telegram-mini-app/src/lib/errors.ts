import { RestorApiError } from '@restor/api-client';
import { ErrorCode } from '@restor/shared-types';

/**
 * Turns any failure into one Uzbek sentence for the screen.
 *
 * Branches on the error CODE, never on the server's message: some older
 * endpoints still answer in English, and a customer must never see that. A
 * server message is used only for codes whose messages are written for the
 * customer in Uzbek (payment provider, our own storefront validation).
 */
const BY_CODE: Record<string, string> = {
  NETWORK_ERROR: 'Internet aloqasi yoʻq. Ulanishni tekshirib, qayta urinib koʻring',
  TIMEOUT: 'Server javob bermadi. Qayta urinib koʻring',
  [ErrorCode.RATE_LIMITED]: 'Juda koʻp urinish. Birozdan soʻng qayta urinib koʻring',
  [ErrorCode.PRODUCT_UNAVAILABLE]: 'Savatdagi mahsulotlardan biri hozir mavjud emas',
  [ErrorCode.PRODUCT_NOT_FOUND]: 'Mahsulot topilmadi — menyu yangilangan boʻlishi mumkin',
  [ErrorCode.MODIFIER_SELECTION_INVALID]:
    'Mahsulot variantlari oʻzgargan. Uni savatdan qayta sozlang',
  [ErrorCode.MIN_ORDER_NOT_REACHED]: 'Yetkazib berish uchun minimal buyurtma summasiga yetmadi',
  [ErrorCode.OUTSIDE_DELIVERY_RADIUS]: 'Bu manzil yetkazib berish hududidan tashqarida',
  [ErrorCode.BRANCH_NOT_FOUND]: 'Filial topilmadi',
  [ErrorCode.BRANCH_CLOSED]: 'Filial hozir yopiq',
  [ErrorCode.PROMO_CODE_NOT_FOUND]: 'Bunday promo-kod topilmadi',
  [ErrorCode.PROMO_CODE_EXPIRED]: 'Promo-kodning amal qilish muddati tugagan',
  [ErrorCode.PROMO_CODE_LIMIT_REACHED]: 'Bu promo-koddan foydalanish limiti tugagan',
  [ErrorCode.PROMO_CODE_NOT_APPLICABLE]:
    'Promo-kod bu buyurtmaga qoʻllanmaydi (minimal summa yoki filial shartiga mos emas)',
  [ErrorCode.PROFILE_INCOMPLETE]: 'Ism, familiya va telefon raqamingizni kiriting',
  [ErrorCode.ADDRESS_NOT_FOUND]: 'Manzil topilmadi',
  [ErrorCode.ORDER_NOT_FOUND]: 'Buyurtma topilmadi',
  [ErrorCode.DUPLICATE_ORDER]: 'Buyurtmani qayta yuboring',
  [ErrorCode.TELEGRAM_INIT_DATA_INVALID]: 'Telegram orqali kirish tasdiqlanmadi. Ilovani qayta oching',
  [ErrorCode.TENANT_NOT_FOUND]: 'Restoran topilmadi',
  [ErrorCode.TENANT_BLOCKED]: 'Restoran vaqtincha ishlamayapti',
  [ErrorCode.UNAUTHORIZED]: 'Sessiya tugadi. Ilovani qayta oching',
  [ErrorCode.TOKEN_EXPIRED]: 'Sessiya tugadi. Ilovani qayta oching',
  [ErrorCode.TOKEN_INVALID]: 'Sessiya tugadi. Ilovani qayta oching',
  [ErrorCode.CUSTOMER_SESSION_REQUIRED]: 'Sessiya tugadi. Ilovani qayta oching',
  [ErrorCode.PAYMENT_ALREADY_PROCESSED]: 'Bu buyurtma allaqachon toʻlangan',
};

/** Codes whose server message is already a customer-facing Uzbek sentence. */
const TRUST_SERVER_MESSAGE = new Set<string>([
  ErrorCode.PAYMENT_PROVIDER_ERROR,
  ErrorCode.PAYMENT_METHOD_UNAVAILABLE,
  ErrorCode.PAYMENT_AMOUNT_MISMATCH,
  ErrorCode.CAMPAIGN_RATE_LIMITED,
  ErrorCode.CONFLICT,
]);

export function errorMessage(error: unknown, fallback = 'Xatolik yuz berdi. Qayta urinib koʻring'): string {
  if (!(error instanceof RestorApiError)) return fallback;

  if (TRUST_SERVER_MESSAGE.has(error.code) && error.message) return error.message;

  if (error.code === ErrorCode.VALIDATION_ERROR) {
    // Field messages from the shared schemas are Uzbek for every storefront
    // form; show the first one rather than a generic line.
    const first = error.details ? Object.values(error.details).flat()[0] : undefined;
    return first && !/^[A-Za-z]/.test(first) ? first : 'Kiritilgan maʼlumotlarni tekshiring';
  }

  return BY_CODE[error.code] ?? fallback;
}

/** Per-field messages from a validation error, keyed by the field's last path part. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof RestorApiError) || !error.details) return {};
  const out: Record<string, string> = {};
  for (const [path, messages] of Object.entries(error.details)) {
    const key = path.split('.').pop() ?? path;
    if (messages[0]) out[key] = messages[0];
  }
  return out;
}

export function isCode(error: unknown, code: string): error is RestorApiError {
  return error instanceof RestorApiError && error.code === code;
}

export function isNetworkFailure(error: unknown): boolean {
  return error instanceof RestorApiError && error.isNetworkFailure;
}
