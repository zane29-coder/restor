import { z } from 'zod';
import { FLOOR_PLAN, ReservationStatus, TableShape, WaiterCallType } from '@restor/shared-types';
import { phoneSchema, uuidSchema } from './primitives';

/* -------------------------------------------------------------------------- */
/* Tables and QR service (TZ §20)                                             */
/* -------------------------------------------------------------------------- */

/**
 * A table number.
 *
 * Free text rather than an integer: real floor plans have "12a", "VIP-2" and
 * "Terrassa 3", and forcing them into numbers makes staff invent a mapping
 * they then have to remember.
 */
const tableNumberSchema = z
  .string()
  .trim()
  .min(1, 'Stol raqamini kiriting')
  .max(20);

export const createTableSchema = z.object({
  branchId: uuidSchema,
  number: tableNumberSchema,
  name: z.string().trim().max(80).nullish(),
  seats: z.number().int().positive().max(100).nullish(),
  /** A floor area: terrace, second floor, VIP. Groups the list for staff. */
  zone: z.string().trim().max(80).nullish(),
  shape: z.nativeEnum(TableShape).optional(),
});

export const updateTableSchema = z.object({
  number: tableNumberSchema.optional(),
  name: z.string().trim().max(80).nullish(),
  seats: z.number().int().positive().max(100).nullish(),
  zone: z.string().trim().max(80).nullish(),
  isActive: z.boolean().optional(),
  shape: z.nativeEnum(TableShape).optional(),
});

const PLAN_WIDTH = FLOOR_PLAN.width;
const PLAN_HEIGHT = FLOOR_PLAN.height;

/**
 * Saving the floor plan: every moved table in one request, so a half-saved
 * layout cannot exist.
 */
export const tableLayoutSchema = z.object({
  items: z
    .array(
      z.object({
        id: uuidSchema,
        x: z.number().int().min(0).max(PLAN_WIDTH),
        y: z.number().int().min(0).max(PLAN_HEIGHT),
        shape: z.nativeEnum(TableShape).optional(),
      }),
    )
    .min(1)
    .max(300),
});

/* -------------------------------------------------------------------------- */
/* Reservations                                                               */
/* -------------------------------------------------------------------------- */

const reservationFields = {
  tableId: uuidSchema.nullish(),
  guestName: z.string().trim().min(2, 'Mehmon ismini kiriting').max(120),
  guestPhone: phoneSchema,
  partySize: z.number().int().min(1, 'Kamida 1 kishi').max(200),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(720).default(120),
  note: z.string().trim().max(500).nullish(),
};

export const createReservationSchema = z.object({
  branchId: uuidSchema,
  ...reservationFields,
});

/** Status changes go through the same patch; the service checks the move. */
export const updateReservationSchema = z
  .object({
    tableId: reservationFields.tableId,
    guestName: reservationFields.guestName.optional(),
    guestPhone: phoneSchema.optional(),
    partySize: reservationFields.partySize.optional(),
    startsAt: reservationFields.startsAt.optional(),
    durationMinutes: z.number().int().min(15).max(720).optional(),
    note: reservationFields.note,
    status: z.nativeEnum(ReservationStatus).optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'Oʻzgartirish uchun kamida bitta maydon kiriting',
  });

/** A window of at most 31 days; the board asks for one day at a time. */
export const reservationListQuerySchema = z
  .object({
    branchId: uuidSchema.optional(),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    tableId: uuidSchema.optional(),
  })
  .refine((v) => new Date(v.from) < new Date(v.to), { message: 'Oraliq notoʻgʻri', path: ['to'] })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 31 * 86_400_000, {
    message: 'Oraliq 31 kundan oshmasin',
    path: ['to'],
  });

/**
 * What a guest is asking for.
 *
 * Note what the guest does NOT send: which table they are at. That comes from
 * the scanned QR token in the path, so a guest cannot call a waiter to someone
 * else's table or ring the bell for the whole floor.
 */
export const waiterCallSchema = z.object({
  type: z.nativeEnum(WaiterCallType).default(WaiterCallType.CALL_WAITER),
});

export type CreateTableInput = z.infer<typeof createTableSchema>;
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
export type WaiterCallInput = z.infer<typeof waiterCallSchema>;
export type TableLayoutInput = z.infer<typeof tableLayoutSchema>;
export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;
export type ReservationListQueryInput = z.infer<typeof reservationListQuerySchema>;
