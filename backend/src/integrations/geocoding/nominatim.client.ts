import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode, type GeoPlace } from '@restor/shared-types';
import { AppException } from '../../common/errors/app-exception';

/** The parts of a Nominatim `address` block this client reads. */
interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  house_number?: string;
  neighbourhood?: string;
  quarter?: string;
  suburb?: string;
  residential?: string;
  city?: string;
  town?: string;
  village?: string;
  city_district?: string;
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  address?: NominatimAddress;
}

/**
 * Address lookup through OpenStreetMap's Nominatim (TZ 48 §20.1).
 *
 * Chosen because it needs no key and no contract: the brief was not to switch
 * on a paid service unasked. Its usage policy is the constraint that shapes
 * this client —
 *
 *  - at most one request per second from the whole deployment, so calls are
 *    serialised here and spaced out;
 *  - a User-Agent that identifies the application;
 *  - results cached, because the same pin and the same street get asked about
 *    again and again.
 *
 * Calls go through the API rather than from the customer's phone so that the
 * provider can be swapped (Yandex, Google — both need a key and a contract)
 * without shipping a new Mini App, and so customers' IPs are not handed to a
 * third party. At real volume the public instance is not appropriate; see
 * docs/integrations/telegram.md.
 */
@Injectable()
export class NominatimClient {
  private readonly logger = new Logger(NominatimClient.name);

  private static readonly BASE_URL = 'https://nominatim.openstreetmap.org';
  private static readonly USER_AGENT = 'RESTOR/1.0 (restaurant ordering; +https://restor.uz)';
  private static readonly MIN_INTERVAL_MS = 1_100;
  private static readonly TIMEOUT_MS = 8_000;
  /** Past this wait the caller gets "busy" instead of a hung request. */
  private static readonly MAX_QUEUE_WAIT_MS = 6_000;
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly CACHE_MAX = 2_000;

  private readonly cache = new Map<string, { at: number; value: GeoPlace[] }>();
  private nextSlot = 0;

  async reverse(latitude: number, longitude: number): Promise<GeoPlace | null> {
    // ~1 m: two taps on the same spot are one lookup.
    const key = `r:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const places = await this.cached(key, async () => {
      const url = new URL('/reverse', NominatimClient.BASE_URL);
      url.search = new URLSearchParams({
        format: 'jsonv2',
        lat: String(latitude),
        lon: String(longitude),
        zoom: '18',
        addressdetails: '1',
        'accept-language': 'uz',
      }).toString();

      const body = await this.call<NominatimPlace & { error?: string }>(url);
      if (!body || body.error) return [];
      // The pin is what the customer chose; the geocoder only names it.
      return [toPlace(body, latitude, longitude)];
    });
    return places[0] ?? null;
  }

  async search(query: string, near?: { latitude: number; longitude: number }): Promise<GeoPlace[]> {
    const normalised = query.trim().toLowerCase().replace(/\s+/g, ' ');
    const key = `s:${normalised}:${near ? `${near.latitude.toFixed(2)},${near.longitude.toFixed(2)}` : ''}`;

    return this.cached(key, async () => {
      const params: Record<string, string> = {
        format: 'jsonv2',
        q: normalised,
        countrycodes: 'uz',
        addressdetails: '1',
        limit: '6',
        'accept-language': 'uz',
      };
      if (near) {
        // A soft bias towards the branch's city, not a hard boundary.
        const d = 0.35;
        params.viewbox = [
          near.longitude - d,
          near.latitude + d,
          near.longitude + d,
          near.latitude - d,
        ].join(',');
      }

      const url = new URL('/search', NominatimClient.BASE_URL);
      url.search = new URLSearchParams(params).toString();

      const body = await this.call<NominatimPlace[]>(url);
      return (body ?? []).map((place) => toPlace(place));
    });
  }

  /* ------------------------------------------------------------------ */

  private async cached(key: string, load: () => Promise<GeoPlace[]>): Promise<GeoPlace[]> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < NominatimClient.CACHE_TTL_MS) return hit.value;

    const value = await load();

    if (this.cache.size >= NominatimClient.CACHE_MAX) {
      // Oldest first: Map iterates in insertion order.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Waits for this process's turn, then makes one request. */
  private async call<T>(url: URL): Promise<T | null> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    if (slot - now > NominatimClient.MAX_QUEUE_WAIT_MS) {
      throw new AppException(
        ErrorCode.RATE_LIMITED,
        'Manzil xizmati hozir band. Bir oz kutib qayta urinib koʻring',
        503,
      );
    }
    this.nextSlot = slot + NominatimClient.MIN_INTERVAL_MS;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NominatimClient.TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': NominatimClient.USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status, path: url.pathname }, 'Geocoder refused a lookup');
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      // Coordinates are a customer's location — the URL is not logged.
      this.logger.warn({ path: url.pathname, err: String(error) }, 'Geocoder unreachable');
      throw new AppException(
        ErrorCode.INTERNAL_ERROR,
        'Manzilni aniqlab boʻlmadi. Qoʻlda kiriting',
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Builds the one-line label an address field should show. */
export function toPlace(place: NominatimPlace, pinLat?: number, pinLng?: number): GeoPlace {
  const address = place.address ?? {};
  const street = address.road ?? address.pedestrian ?? address.footway ?? null;
  const area =
    address.neighbourhood ?? address.quarter ?? address.residential ?? address.suburb ?? null;
  const city = address.city ?? address.town ?? address.village ?? null;

  const primary = street ?? area ?? place.name ?? null;
  const label =
    [primary, address.house_number].filter(Boolean).join(', ') ||
    (place.display_name ?? '').split(',').slice(0, 2).join(',').trim() ||
    [area, city].filter(Boolean).join(', ');

  return {
    label: label || 'Belgilangan joy',
    street: primary,
    house: address.house_number ?? null,
    latitude: pinLat ?? Number(place.lat),
    longitude: pinLng ?? Number(place.lon),
  };
}
