/**
 * Zod mirrors of the shared domain enums.
 *
 * `z.nativeEnum` is used rather than a hand-written `z.enum([...])` tuple so
 * adding a member to `@restor/shared-types` automatically widens validation —
 * there is no second list to forget to update.
 */

import { z } from 'zod';
import {
  CashShiftStatus,
  CashTransactionType,
  CourierStatus,
  CourierTransactionType,
  Currency,
  DeliveryStatus,
  HandoverStatus,
  KitchenTicketStatus,
  LoyaltyTransactionType,
  NotificationChannel,
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  PromoCodeType,
  PromotionType,
  StorageProvider,
  SubscriptionStatus,
  TelegramEvent,
  TenantStatus,
  VehicleType,
  WaiterCallStatus,
  WaiterCallType,
} from '@restor/shared-types';

export const currencySchema = z.nativeEnum(Currency);
export const tenantStatusSchema = z.nativeEnum(TenantStatus);
export const subscriptionStatusSchema = z.nativeEnum(SubscriptionStatus);

export const orderStatusSchema = z.nativeEnum(OrderStatus);
export const orderTypeSchema = z.nativeEnum(OrderType);
export const orderSourceSchema = z.nativeEnum(OrderSource);
export const paymentStatusSchema = z.nativeEnum(PaymentStatus);
export const paymentMethodSchema = z.nativeEnum(PaymentMethod);

export const cashShiftStatusSchema = z.nativeEnum(CashShiftStatus);
export const cashTransactionTypeSchema = z.nativeEnum(CashTransactionType);

export const courierStatusSchema = z.nativeEnum(CourierStatus);
export const courierTransactionTypeSchema = z.nativeEnum(CourierTransactionType);
export const vehicleTypeSchema = z.nativeEnum(VehicleType);
export const deliveryStatusSchema = z.nativeEnum(DeliveryStatus);
export const handoverStatusSchema = z.nativeEnum(HandoverStatus);

export const promotionTypeSchema = z.nativeEnum(PromotionType);
export const promoCodeTypeSchema = z.nativeEnum(PromoCodeType);
export const loyaltyTransactionTypeSchema = z.nativeEnum(LoyaltyTransactionType);

export const telegramEventSchema = z.nativeEnum(TelegramEvent);
export const notificationChannelSchema = z.nativeEnum(NotificationChannel);
export const storageProviderSchema = z.nativeEnum(StorageProvider);

export const kitchenTicketStatusSchema = z.nativeEnum(KitchenTicketStatus);
export const waiterCallTypeSchema = z.nativeEnum(WaiterCallType);
export const waiterCallStatusSchema = z.nativeEnum(WaiterCallStatus);
