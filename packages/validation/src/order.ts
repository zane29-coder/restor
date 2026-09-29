import { z } from 'zod';
import { OrderType } from '@restor/shared-types';
import { orderSourceSchema, orderStatusSchema, orderTypeSchema, paymentMethodSchema } from './enums';
import {
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  phoneSchema,
  quantitySchema,
  uuidSchema,
} from './primitives';

export const deliveryAddressSchema = z.object({
  label: z.string().trim().max(60).nullish(),
  address: z.string().trim().min(5, 'Address is too short').max(500),
  latitude: latitudeSchema.nullish(),
  longitude: longitudeSchema.nullish(),
  entrance: z.string().trim().max(20).nullish(),
  floor: z.string().trim().max(20).nullish(),
  apartment: z.string().trim().max(20).nullish(),
  landmark: z.string().trim().max(200).nullish(),
  comment: z.string().trim().max(500).nullish(),
});

export const orderItemSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: quantitySchema,
  modifierIds: z.array(uuidSchema).max(30).default([]),
  comment: z.string().trim().max(300).optional(),
});

/**
 * Note what is absent: no prices. The client sends what was ordered, never what
 * it costs — the server prices every line from the live menu (TZ §76). A
 * tampered client cannot buy a pizza for 1 UZS.
 */
export const createOrderSchema = z
  .object({
    branchId: uuidSchema,
    type: orderTypeSchema,
    source: orderSourceSchema.optional(),
    items: z.array(orderItemSchema).min(1, 'The cart is empty').max(100),
    customer: z
      .object({
        id: uuidSchema.optional(),
        name: z.string().trim().max(120).optional(),
        phone: phoneSchema.optional(),
      })
      .optional(),
    deliveryAddress: deliveryAddressSchema.optional(),
    addressId: uuidSchema.optional(),
    tableId: uuidSchema.optional(),
    // `nullish`, not `optional`: a client building this payload from a form
    // naturally writes `comment: value || null`, and rejecting that is a
    // papercut with no upside — an absent comment and a null one mean the
    // same thing here.
    promoCode: z.string().trim().max(40).nullish(),
    comment: z.string().trim().max(1000).nullish(),
    paymentMethod: paymentMethodSchema.optional(),
    /** Idempotency key; the POS always sends one so a retry cannot duplicate. */
    clientUuid: z.string().uuid().optional(),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (v) => v.type !== OrderType.DELIVERY || Boolean(v.deliveryAddress || v.addressId),
    { message: 'A delivery order needs an address', path: ['deliveryAddress'] },
  )
  .refine((v) => v.type !== OrderType.TABLE || Boolean(v.tableId), {
    message: 'A table order needs a table', path: ['tableId'],
  })
  .refine(
    (v) => v.type === OrderType.DINE_IN || v.type === OrderType.TABLE || Boolean(v.customer?.phone),
    { message: 'A phone number is required for delivery and pickup orders', path: ['customer', 'phone'] },
  );

export const updateOrderStatusSchema = z
  .object({
    status: orderStatusSchema,
    comment: z.string().trim().max(500).optional(),
    cancelReason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== 'CANCELLED' || Boolean(v.cancelReason), {
    message: 'Give a cancellation reason — it is written to the audit log',
    path: ['cancelReason'],
  });

export const assignCourierSchema = z.object({
  courierId: uuidSchema,
  comment: z.string().trim().max(300).optional(),
});

export const orderListQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  status: z.union([orderStatusSchema, z.array(orderStatusSchema)]).optional(),
  type: orderTypeSchema.optional(),
  source: orderSourceSchema.optional(),
  courierId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/** Cart preview: same shape as an order, but nothing is persisted. */
export const previewOrderSchema = z.object({
  branchId: uuidSchema,
  type: orderTypeSchema,
  items: z.array(orderItemSchema).min(1).max(100),
  promoCode: z.string().trim().max(40).optional(),
  customerId: uuidSchema.optional(),
  deliveryAddress: deliveryAddressSchema.partial().optional(),
});

export const createPaymentSchema = z
  .object({
    orderId: uuidSchema,
    method: paymentMethodSchema,
    amount: moneySchema.positive('Amount must be greater than zero'),
    tendered: moneySchema.optional(),
  })
  .refine((v) => v.tendered === undefined || v.tendered >= v.amount, {
    message: 'Tendered cash is less than the amount being paid',
    path: ['tendered'],
  });

/** Mixed payment (TZ §17): several tenders settling one order at once. */
export const mixedPaymentSchema = z.object({
  orderId: uuidSchema,
  parts: z
    .array(z.object({ method: paymentMethodSchema, amount: moneySchema.positive() }))
    .min(2, 'A mixed payment needs at least two parts')
    .max(5),
});

export const refundSchema = z.object({
  orderId: uuidSchema,
  amount: moneySchema.positive(),
  reason: z.string().trim().min(3, 'Give a refund reason').max(500),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type OrderListQueryInput = z.infer<typeof orderListQuerySchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
