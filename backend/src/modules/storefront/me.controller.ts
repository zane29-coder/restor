import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  CheckoutResult,
  CustomerNotificationItem,
  CustomerProfile,
  FavoriteProduct,
  GeoPlace,
  MyOrderDetail,
  MyOrderSummary,
  OnlineCheckoutLink,
  OrderPricePreview,
  Paginated,
  PublicPromoCode,
  SavedAddress,
} from '@restor/shared-types';
import {
  checkoutPreviewSchema,
  checkoutSchema,
  geoReverseQuerySchema,
  geoSearchQuerySchema,
  markNotificationsReadSchema,
  paginationSchema,
  saveAddressSchema,
  updateAddressSchema,
  updateCustomerProfileSchema,
  type CheckoutInput,
  type CheckoutPreviewInput,
  type GeoReverseQuery,
  type GeoSearchQuery,
  type MarkNotificationsReadInput,
  type PaginationOutput,
  type SaveAddressInput,
  type UpdateAddressInput,
  type UpdateCustomerProfileInput,
} from '@restor/validation';
import { z } from 'zod';
import { CustomerOnly } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { NominatimClient } from '../../integrations/geocoding/nominatim.client';
import { CustomerNotificationsService } from '../customer-notifications/customer-notifications.service';
import { CheckoutService } from './checkout.service';
import { CustomerProfileService } from './customer-profile.service';
import { requireCustomerSession } from './customer-session';
import { FavoritesService } from './favorites.service';
import { MyOrdersService } from './my-orders.service';

const retryPaymentSchema = z.object({ returnUrl: z.string().url().max(2048).optional() });

/**
 * The signed-in storefront customer (TZ 48).
 *
 * `@CustomerOnly()` on the class: a Mini App session and nothing else. Every
 * handler acts on "the customer of this session", which the services read
 * from the verified token — no route here takes a customer or account id.
 */
@ApiTags('me')
@CustomerOnly()
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: CustomerProfileService,
    private readonly favorites: FavoritesService,
    private readonly orders: MyOrdersService,
    private readonly checkouts: CheckoutService,
    private readonly inbox: CustomerNotificationsService,
    private readonly geocoder: NominatimClient,
  ) {}

  /* ------------------------------ Profile ----------------------------- */

  @Get('profile')
  profile(): Promise<CustomerProfile> {
    return this.profiles.get();
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Name, phone (unverified), optional details, notification choices' })
  updateProfile(
    @Body(zodBody(updateCustomerProfileSchema)) body: UpdateCustomerProfileInput,
  ): Promise<CustomerProfile> {
    return this.profiles.update(body);
  }

  /* ----------------------------- Addresses ---------------------------- */

  @Get('addresses')
  addresses(): Promise<SavedAddress[]> {
    return this.profiles.listAddresses();
  }

  @Post('addresses')
  createAddress(@Body(zodBody(saveAddressSchema)) body: SaveAddressInput): Promise<SavedAddress> {
    return this.profiles.createAddress(body);
  }

  @Patch('addresses/:id')
  updateAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateAddressSchema)) body: UpdateAddressInput,
  ): Promise<SavedAddress> {
    return this.profiles.updateAddress(id, body);
  }

  @Delete('addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAddress(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.profiles.deleteAddress(id);
  }

  /* ----------------------------- Favourites --------------------------- */

  @Get('favorites')
  favoriteList(): Promise<FavoriteProduct[]> {
    return this.favorites.list();
  }

  @Put('favorites/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  addFavorite(@Param('productId', ParseUUIDPipe) productId: string): Promise<void> {
    return this.favorites.add(productId);
  }

  @Delete('favorites/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFavorite(@Param('productId', ParseUUIDPipe) productId: string): Promise<void> {
    return this.favorites.remove(productId);
  }

  /* -------------------------------- Orders ---------------------------- */

  @Get('orders')
  @ApiOperation({ summary: 'Own order history, across restaurants' })
  orderList(@Query(zodBody(paginationSchema)) query: PaginationOutput): Promise<Paginated<MyOrderSummary>> {
    return this.orders.list(query);
  }

  @Get('orders/:id')
  order(@Param('id', ParseUUIDPipe) id: string): Promise<MyOrderDetail> {
    return this.orders.detail(id);
  }

  /** Re-opens the payment page for an unpaid online order — same order, same session. */
  @Post('orders/:id/pay')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  retryPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(retryPaymentSchema)) body: { returnUrl?: string },
  ): Promise<OnlineCheckoutLink> {
    return this.orders.retryPayment(id, body.returnUrl);
  }

  /** Asks Subo for the real status — the customer's return proves nothing. */
  @Post('orders/:id/payment-status')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  refreshPayment(@Param('id', ParseUUIDPipe) id: string): Promise<MyOrderDetail> {
    return this.orders.refreshPayment(id);
  }

  @Get('promo-codes')
  promoCodes(): Promise<PublicPromoCode[]> {
    return this.orders.promoCodes();
  }

  /* ------------------------------ Checkout ---------------------------- */

  @Post('checkout/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price the checkout as this customer' })
  previewCheckout(
    @Body(zodBody(checkoutPreviewSchema)) body: CheckoutPreviewInput,
  ): Promise<OrderPricePreview> {
    return this.checkouts.preview(body);
  }

  @Post('checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Place the order (idempotent on clientUuid) and start payment' })
  checkout(@Body(zodBody(checkoutSchema)) body: CheckoutInput): Promise<CheckoutResult> {
    return this.checkouts.checkout(body);
  }

  /* ---------------------------- Notifications ------------------------- */

  @Get('notifications')
  async notifications(
    @Query(zodBody(paginationSchema)) query: PaginationOutput,
  ): Promise<Paginated<CustomerNotificationItem>> {
    const session = await requireCustomerSession(this.prisma);
    return this.inbox.list(session.accountId, query);
  }

  @Get('notifications/unread-count')
  async unreadCount(): Promise<{ count: number }> {
    const session = await requireCustomerSession(this.prisma);
    return { count: await this.inbox.unreadCount(session.accountId) };
  }

  @Post('notifications/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @Body(zodBody(markNotificationsReadSchema)) body: MarkNotificationsReadInput,
  ): Promise<{ updated: number }> {
    const session = await requireCustomerSession(this.prisma);
    return { updated: await this.inbox.markRead(session.accountId, body.ids) };
  }

  /* -------------------------------- Geo ------------------------------- */

  /**
   * Names a map pin. Behind the customer session so the API is not a free
   * geocoding proxy for the internet.
   */
  @Get('geo/reverse')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reverse(@Query(zodBody(geoReverseQuerySchema)) query: GeoReverseQuery): Promise<GeoPlace | null> {
    return this.geocoder.reverse(query.lat, query.lng);
  }

  @Get('geo/search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  search(@Query(zodBody(geoSearchQuerySchema)) query: GeoSearchQuery): Promise<GeoPlace[]> {
    return this.geocoder.search(
      query.q,
      query.lat != null && query.lng != null ? { latitude: query.lat, longitude: query.lng } : undefined,
    );
  }
}
