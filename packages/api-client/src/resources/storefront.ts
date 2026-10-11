import type {
  CampaignAudience,
  CheckoutPreviewRequest,
  CheckoutRequest,
  CheckoutResult,
  CreateCampaignRequest,
  CustomerNotificationItem,
  CustomerProfile,
  FavoriteProduct,
  GeoPlace,
  MarketingCampaign,
  MyOrderDetail,
  MyOrderSummary,
  OnlineCheckoutLink,
  OrderPricePreview,
  Paginated,
  PaginationQuery,
  PublicPromoCode,
  RecommendationList,
  RecommendationPlacement,
  SaveAddressRequest,
  SaveRecommendationListRequest,
  SavedAddress,
  StorefrontInfo,
  StorefrontSettings,
  UpdateCustomerProfileRequest,
  UpdateStorefrontSettingsRequest,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

/** The restaurant's storefront: public info, and its settings for staff. */
export class StorefrontResource {
  constructor(private readonly http: HttpClient) {}

  /** Public — name, colours, contact and the checkout's payment options. */
  info(): Promise<StorefrontInfo> {
    return this.http.get<StorefrontInfo>('storefront', { skipAuth: true });
  }

  settings(): Promise<StorefrontSettings> {
    return this.http.get<StorefrontSettings>('storefront/settings');
  }

  updateSettings(payload: UpdateStorefrontSettingsRequest): Promise<StorefrontSettings> {
    return this.http.patch<StorefrontSettings>('storefront/settings', payload);
  }

  /* ------------------------- Recommendations ------------------------ */

  recommendations(placement?: RecommendationPlacement): Promise<RecommendationList[]> {
    return this.http.get<RecommendationList[]>('recommendations', { query: { placement } });
  }

  /** Replaces one list in full — its order is the content being edited. */
  saveRecommendations(payload: SaveRecommendationListRequest): Promise<RecommendationList> {
    return this.http.put<RecommendationList>('recommendations', payload);
  }

  /* ---------------------------- Campaigns --------------------------- */

  campaigns(query?: PaginationQuery): Promise<Paginated<MarketingCampaign>> {
    return this.http.getPaginated<MarketingCampaign>('marketing/campaigns', { query });
  }

  campaignAudience(): Promise<CampaignAudience> {
    return this.http.get<CampaignAudience>('marketing/campaigns/audience');
  }

  sendCampaign(payload: CreateCampaignRequest): Promise<MarketingCampaign> {
    return this.http.post<MarketingCampaign>('marketing/campaigns', payload);
  }
}

/**
 * The signed-in storefront customer (Mini App).
 *
 * No method takes a customer or account id: the server reads who is asking
 * from the session, and only from there.
 */
export class MeResource {
  constructor(private readonly http: HttpClient) {}

  profile(): Promise<CustomerProfile> {
    return this.http.get<CustomerProfile>('me/profile');
  }

  updateProfile(payload: UpdateCustomerProfileRequest): Promise<CustomerProfile> {
    return this.http.patch<CustomerProfile>('me/profile', payload);
  }

  addresses(): Promise<SavedAddress[]> {
    return this.http.get<SavedAddress[]>('me/addresses');
  }

  createAddress(payload: SaveAddressRequest): Promise<SavedAddress> {
    return this.http.post<SavedAddress>('me/addresses', payload);
  }

  updateAddress(id: string, payload: Partial<SaveAddressRequest>): Promise<SavedAddress> {
    return this.http.patch<SavedAddress>(`me/addresses/${id}`, payload);
  }

  deleteAddress(id: string): Promise<void> {
    return this.http.delete<void>(`me/addresses/${id}`);
  }

  favorites(): Promise<FavoriteProduct[]> {
    return this.http.get<FavoriteProduct[]>('me/favorites');
  }

  addFavorite(productId: string): Promise<void> {
    return this.http.put<void>(`me/favorites/${productId}`);
  }

  removeFavorite(productId: string): Promise<void> {
    return this.http.delete<void>(`me/favorites/${productId}`);
  }

  orders(query?: PaginationQuery): Promise<Paginated<MyOrderSummary>> {
    return this.http.getPaginated<MyOrderSummary>('me/orders', { query });
  }

  order(id: string): Promise<MyOrderDetail> {
    return this.http.get<MyOrderDetail>(`me/orders/${id}`);
  }

  /** Re-opens the payment page for an unpaid online order. Never a new order. */
  retryPayment(id: string, returnUrl?: string): Promise<OnlineCheckoutLink> {
    return this.http.post<OnlineCheckoutLink>(`me/orders/${id}/pay`, returnUrl ? { returnUrl } : {});
  }

  /** Asks the server to read the real status back from the payment provider. */
  refreshPayment(id: string): Promise<MyOrderDetail> {
    return this.http.post<MyOrderDetail>(`me/orders/${id}/payment-status`);
  }

  promoCodes(): Promise<PublicPromoCode[]> {
    return this.http.get<PublicPromoCode[]>('me/promo-codes');
  }

  previewCheckout(payload: CheckoutPreviewRequest): Promise<OrderPricePreview> {
    return this.http.post<OrderPricePreview>('me/checkout/preview', payload);
  }

  /**
   * Places the order. `clientUuid` must be generated before the first
   * attempt and reused on every retry — it is also sent as the idempotency
   * key, so a lost response cannot become a second order.
   */
  checkout(payload: CheckoutRequest): Promise<CheckoutResult> {
    return this.http.post<CheckoutResult>('me/checkout', payload, {
      idempotencyKey: payload.clientUuid,
      // Payment providers can be slow to open a session.
      timeoutMs: 40_000,
    });
  }

  notifications(query?: PaginationQuery): Promise<Paginated<CustomerNotificationItem>> {
    return this.http.getPaginated<CustomerNotificationItem>('me/notifications', { query });
  }

  unreadCount(): Promise<{ count: number }> {
    return this.http.get<{ count: number }>('me/notifications/unread-count');
  }

  markNotificationsRead(ids?: string[]): Promise<{ updated: number }> {
    return this.http.post<{ updated: number }>('me/notifications/read', ids ? { ids } : {});
  }

  reverseGeocode(latitude: number, longitude: number): Promise<GeoPlace | null> {
    return this.http.get<GeoPlace | null>('me/geo/reverse', { query: { lat: latitude, lng: longitude } });
  }

  searchPlaces(query: string, near?: { latitude: number; longitude: number }): Promise<GeoPlace[]> {
    return this.http.get<GeoPlace[]>('me/geo/search', {
      query: { q: query, lat: near?.latitude, lng: near?.longitude },
    });
  }
}
