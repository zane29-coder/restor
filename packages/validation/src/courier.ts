import { z } from 'zod';
import { courierStatusSchema, vehicleTypeSchema } from './enums';
import {
  emailSchema,
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  passwordSchema,
  phoneSchema,
  uuidSchema,
} from './primitives';

/* -------------------------------------------------------------------------- */
/* Dispatcher side                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Creating a courier also provisions their login, exactly like an employee:
 * a courier row without a user could not sign into the app.
 */
export const createCourierSchema = z.object({
  fullName: z.string().trim().min(2, 'Ism juda qisqa').max(120),
  phone: phoneSchema,
  email: emailSchema.optional(),
  password: passwordSchema,
  branchId: uuidSchema.nullish(),
  vehicleType: vehicleTypeSchema.default('SCOOTER'),
  /** What the courier earns per delivery when the branch has no rate set. */
  defaultFee: moneySchema.optional(),
});

export const updateCourierSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
  branchId: uuidSchema.nullish(),
  vehicleType: vehicleTypeSchema.optional(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
});

export const assignDeliverySchema = z.object({
  courierId: uuidSchema,
  /** Overrides the branch default for this job. */
  courierFee: moneySchema.optional(),
  comment: z.string().trim().max(300).optional(),
});

export const courierListQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  status: courierStatusSchema.optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/* -------------------------------------------------------------------------- */
/* Courier app                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Note what is absent: a `courierId`.
 *
 * Every `/courier/*` route derives the courier from the JWT, so the app cannot
 * read or move another courier's job even if the client were tampered with
 * (TZ §23).
 */
export const courierStatusUpdateSchema = z.object({
  status: courierStatusSchema,
});

export const reportLocationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracyM: z.number().nonnegative().max(100_000).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  speedMps: z.number().min(0).max(200).optional(),
  /** When the fix was taken; defaults to arrival time. Lets a queued batch
      of offline pings keep their real timestamps. */
  recordedAt: z.string().datetime({ offset: true }).optional(),
});

export const completeDeliverySchema = z.object({
  /**
   * Cash taken from the customer at the door.
   *
   * Omitted for an already-paid order. The server validates it against what
   * the order actually owes rather than trusting the number.
   */
  collectedCash: moneySchema.optional(),
  comment: z.string().trim().max(300).optional(),
});

export const failDeliverySchema = z.object({
  reason: z.string().trim().min(3, 'Sababni yozing').max(500),
});

/**
 * What a courier may change about themselves: the phone number, and nothing
 * else.
 *
 * Not their name, branch, vehicle or active flag — those are the dispatcher's
 * to set, and a courier editing their own name would break the audit trail.
 * The phone is different: it is the number customers ring at the door, so the
 * person holding it has to be able to correct it without filing a request.
 */
export const updateCourierProfileSchema = z.object({
  phone: phoneSchema,
});

/* -------------------------------------------------------------------------- */
/* Wallet & cash handover (TZ §26, §28)                                       */
/* -------------------------------------------------------------------------- */

export const declareHandoverSchema = z.object({
  /**
   * Optional: the app rarely has a branch to offer, so the server falls back
   * to the courier's assigned one. Sent explicitly only when a courier who
   * works across branches hands cash to a different till.
   */
  branchId: uuidSchema.optional(),
  amount: moneySchema.positive('Summa noldan katta boʻlishi kerak'),
  comment: z.string().trim().max(300).optional(),
});

export const confirmHandoverSchema = z.object({
  /**
   * What the cashier actually counted.
   *
   * Defaults to the declared amount. A mismatch is recorded rather than
   * silently accepted — that discrepancy is the whole point of a two-sided
   * confirmation.
   */
  amount: moneySchema.optional(),
  cashShiftId: uuidSchema.optional(),
  comment: z.string().trim().max(300).optional(),
});

export const courierTransactionSchema = z.object({
  courierId: uuidSchema,
  type: z.enum(['EXPENSE', 'ADJUSTMENT', 'DELIVERY_INCOME']),
  /** Signed for ADJUSTMENT; positive for the others. */
  amount: z.number().int(),
  comment: z.string().trim().max(300).optional(),
});

export type CreateCourierInput = z.infer<typeof createCourierSchema>;
export type UpdateCourierInput = z.infer<typeof updateCourierSchema>;
export type AssignDeliveryInput = z.infer<typeof assignDeliverySchema>;
export type CourierListQueryInput = z.infer<typeof courierListQuerySchema>;
export type ReportLocationInput = z.infer<typeof reportLocationSchema>;
export type CompleteDeliveryInput = z.infer<typeof completeDeliverySchema>;
export type UpdateCourierProfileInput = z.infer<typeof updateCourierProfileSchema>;
export type DeclareHandoverInput = z.infer<typeof declareHandoverSchema>;
export type ConfirmHandoverInput = z.infer<typeof confirmHandoverSchema>;
