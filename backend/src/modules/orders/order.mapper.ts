import type { Prisma } from '@prisma/client';
import type { Order, OrderDeliveryAddress } from '@restor/shared-types';

/**
 * The relation set every order read needs.
 *
 * Declared once and shared, so the API cannot return an order with items in
 * one endpoint and without them in another.
 */
export const ORDER_INCLUDE = {
  branch: { select: { id: true, name: true } },
  items: {
    include: { modifiers: true },
    orderBy: { createdAt: 'asc' },
  },
  appliedPromotions: true,
} as const satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

export function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    branch: row.branch,

    number: row.number,
    displayNumber: row.displayNumber,

    type: row.type,
    source: row.source,
    status: row.status,
    paymentStatus: row.paymentStatus,

    customerId: row.customerId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,

    items: row.items.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      variantName: item.variantName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      total: item.total,
      discountTotal: item.discountTotal,
      comment: item.comment,
      modifiers: item.modifiers.map((modifier) => ({
        id: modifier.id,
        orderItemId: modifier.orderItemId,
        modifierId: modifier.modifierId,
        name: modifier.name,
        price: modifier.price,
        quantity: modifier.quantity,
      })),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.createdAt.toISOString(),
    })),

    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    deliveryFee: row.deliveryFee,
    serviceFee: row.serviceFee,
    total: row.total,
    paidTotal: row.paidTotal,
    refundedTotal: row.refundedTotal,

    deliveryAddress: toAddress(row),
    tableId: row.tableId,
    tableNumber: row.tableNumber,

    courierId: row.courierId,
    promoCodeId: row.promoCodeId,
    appliedPromotions: row.appliedPromotions.map((promotion) => ({
      promotionId: promotion.promotionId,
      promoCodeId: null,
      name: promotion.name,
      amount: promotion.amount,
    })),

    comment: row.comment,
    cancelReason: row.cancelReason,
    estimatedReadyAt: row.estimatedReadyAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    readyAt: row.readyAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,

    createdByUserId: row.createdByUserId,
    clientUuid: row.clientUuid,

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Rebuilds the address object from the denormalised columns. */
function toAddress(row: OrderRow): OrderDeliveryAddress | null {
  if (!row.addressText) return null;

  return {
    label: row.addressLabel,
    address: row.addressText,
    latitude: row.addressLatitude,
    longitude: row.addressLongitude,
    entrance: row.addressEntrance,
    floor: row.addressFloor,
    apartment: row.addressApartment,
    landmark: row.addressLandmark,
    comment: row.addressComment,
  };
}
