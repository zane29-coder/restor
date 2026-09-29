import { z } from 'zod';
import {
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  phoneSchema,
  timeSchema,
  timezoneSchema,
  weekdaySchema,
} from './primitives';

export const workingHoursSchema = z
  .object({
    dayOfWeek: weekdaySchema,
    opensAt: timeSchema,
    closesAt: timeSchema,
    isClosed: z.boolean().default(false),
  })
  .refine((v) => v.isClosed || v.opensAt !== v.closesAt, {
    message: 'Opening and closing time must differ',
    path: ['closesAt'],
  });

export const createBranchSchema = z
  .object({
    name: z.string().trim().min(2, 'Branch name is too short').max(120),
    address: z.string().trim().min(5, 'Address is too short').max(500),
    phone: phoneSchema.optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    deliveryRadiusM: z.number().int().positive().max(100_000).nullable().default(null),
    minOrderAmount: moneySchema.default(0),
    deliveryPrice: moneySchema.default(0),
    averagePrepMinutes: z.number().int().positive().max(240).default(20),
    timezone: timezoneSchema.default('Asia/Tashkent'),
    acceptsDelivery: z.boolean().default(true),
    acceptsPickup: z.boolean().default(true),
    acceptsDineIn: z.boolean().default(false),
    workingHours: z.array(workingHoursSchema).max(14).optional(),
  })
  .refine(
    (v) =>
      // Coordinates are all-or-nothing: half a point is worse than none, and a
      // delivery radius is meaningless without a centre.
      (v.latitude === undefined) === (v.longitude === undefined),
    { message: 'Provide both latitude and longitude, or neither', path: ['longitude'] },
  )
  .refine((v) => v.deliveryRadiusM === null || v.latitude !== undefined, {
    message: 'A delivery radius needs branch coordinates',
    path: ['deliveryRadiusM'],
  });

export const updateBranchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().min(5).max(500).optional(),
  phone: phoneSchema.nullish(),
  latitude: latitudeSchema.nullish(),
  longitude: longitudeSchema.nullish(),
  deliveryRadiusM: z.number().int().positive().max(100_000).nullish(),
  minOrderAmount: moneySchema.optional(),
  deliveryPrice: moneySchema.optional(),
  averagePrepMinutes: z.number().int().positive().max(240).optional(),
  timezone: timezoneSchema.optional(),
  acceptsDelivery: z.boolean().optional(),
  acceptsPickup: z.boolean().optional(),
  acceptsDineIn: z.boolean().optional(),
  isActive: z.boolean().optional(),
  workingHours: z.array(workingHoursSchema).max(14).optional(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type WorkingHoursInput = z.infer<typeof workingHoursSchema>;
