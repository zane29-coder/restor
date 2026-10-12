import type { BaseEntity } from '../api';
import type { Weekday } from '../enums';

/** A physical location of a tenant (TZ §8). */
export interface Branch extends BaseEntity {
  tenantId: string;
  name: string;
  slug: string;
  address: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Maximum delivery distance in metres; `null` disables the radius check. */
  deliveryRadiusM: number | null;
  /** Minor units (so 25 000 UZS is stored as 25000 — UZS has no subunit). */
  minOrderAmount: number;
  /** Base charge. Zero is valid: a branch that delivers free sets only this. */
  deliveryPrice: number;
  /** Free inside this distance; `null` means the base charge applies from
      the first metre. */
  freeDeliveryRadiusM: number | null;
  /** Free once the discounted goods total reaches this, at any distance. */
  freeDeliveryFrom: number | null;
  /** Added per started km beyond the free radius; `null` keeps it flat. */
  deliveryPricePerKm: number | null;
  /** Default minutes from ACCEPTED to READY, used for customer-facing ETAs. */
  averagePrepMinutes: number;
  /** Daily revenue goal in minor units; `null` when the owner set none. */
  dailyRevenueTarget: number | null;
  timezone: string;
  isActive: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  acceptsDineIn: boolean;
  workingHours: BranchWorkingHours[];
  /** Derived from `workingHours` at request time, in the branch's timezone. */
  isOpenNow?: boolean;
}

export interface BranchWorkingHours {
  id: string;
  branchId: string;
  dayOfWeek: Weekday;
  /** `HH:mm` in the branch's local timezone. */
  opensAt: string;
  closesAt: string;
  /** When true the branch does not trade that day and the times are ignored. */
  isClosed: boolean;
}

export interface CreateBranchRequest {
  name: string;
  address: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  /** `null` clears the limit; the schema accepts it and the service stores it. */
  deliveryRadiusM?: number | null;
  minOrderAmount?: number;
  deliveryPrice?: number;
  freeDeliveryRadiusM?: number | null;
  freeDeliveryFrom?: number | null;
  deliveryPricePerKm?: number | null;
  averagePrepMinutes?: number;
  dailyRevenueTarget?: number | null;
  timezone?: string;
  acceptsDelivery?: boolean;
  acceptsPickup?: boolean;
  acceptsDineIn?: boolean;
  workingHours?: Omit<BranchWorkingHours, 'id' | 'branchId'>[];
}

export type UpdateBranchRequest = Partial<CreateBranchRequest> & {
  isActive?: boolean;
};

/**
 * A drawn delivery area with its own tariff (TZ §11).
 *
 * When a branch has any active zone, the zones are its delivery area and the
 * radius rules stand down; where zones overlap the earlier one wins.
 */
export interface DeliveryZone {
  id: string;
  branchId: string;
  name: string;
  /** `#RRGGBB`. */
  color: string;
  /** Closed ring of `[latitude, longitude]`. */
  polygon: Array<[number, number]>;
  deliveryPrice: number;
  /** Overrides the branch minimum inside the zone; `null` keeps the branch's. */
  minOrderAmount: number | null;
  freeDeliveryFrom: number | null;
  isActive: boolean;
  sortOrder: number;
}

export type DeliveryZoneRequest = Omit<DeliveryZone, 'id' | 'branchId' | 'sortOrder'>;

/** Branch list entry for pickers — deliberately lighter than {@link Branch}. */
export interface BranchSummary {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  isOpenNow: boolean;
  deliveryPrice: number;
  minOrderAmount: number;
  /** Delivery is free from this goods total; `null` means never by amount. */
  freeDeliveryFrom: number | null;
  /** Typical minutes from accepted to ready — the storefront's time estimate. */
  averagePrepMinutes: number;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  phone: string | null;
  workingHours: Array<Omit<BranchWorkingHours, 'id' | 'branchId'>>;
  /** Straight-line metres from the coordinates supplied by the client. */
  distanceM?: number;
}
