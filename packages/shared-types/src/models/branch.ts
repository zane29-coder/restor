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
  deliveryPrice: number;
  /** Default minutes from ACCEPTED to READY, used for customer-facing ETAs. */
  averagePrepMinutes: number;
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
  deliveryRadiusM?: number;
  minOrderAmount?: number;
  deliveryPrice?: number;
  averagePrepMinutes?: number;
  timezone?: string;
  acceptsDelivery?: boolean;
  acceptsPickup?: boolean;
  acceptsDineIn?: boolean;
  workingHours?: Omit<BranchWorkingHours, 'id' | 'branchId'>[];
}

export type UpdateBranchRequest = Partial<CreateBranchRequest> & {
  isActive?: boolean;
};

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
  /** Straight-line metres from the coordinates supplied by the client. */
  distanceM?: number;
}
