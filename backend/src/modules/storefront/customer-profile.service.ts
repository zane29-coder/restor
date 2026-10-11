import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ErrorCode, type CustomerProfile, type SavedAddress } from '@restor/shared-types';
import { missingProfileFields } from '@restor/shared-utils';
import type {
  SaveAddressInput,
  UpdateAddressInput,
  UpdateCustomerProfileInput,
} from '@restor/validation';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../../database/prisma.service';
import { requireCustomerSession } from './customer-session';

/** Enough for home, work, parents and a few more; a list beyond it is a bug. */
const MAX_ADDRESSES = 20;

type AccountRow = Prisma.CustomerAccountGetPayload<object>;
type AddressRow = Prisma.CustomerAccountAddressGetPayload<object>;

/**
 * The customer's own profile and address book (TZ 48 §12, §13, §20).
 *
 * Both live on the RESTOR-wide account, so they are typed once and work in
 * every restaurant. None of these tables is tenant-scoped; isolation is the
 * `accountId` from the verified session, applied on every query below — a
 * customer asking for someone else's address id gets a 404, never the row.
 *
 * The phone is stored normalised and explicitly UNVERIFIED. There is no SMS
 * check yet, so `phoneVerifiedAt` is never set here, and nothing treats the
 * number as proof of identity.
 */
@Injectable()
export class CustomerProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------------------------------------------ */
  /* Profile                                                            */
  /* ------------------------------------------------------------------ */

  async get(): Promise<CustomerProfile> {
    const session = await requireCustomerSession(this.prisma);
    return toProfile(await this.account(session.accountId));
  }

  async update(input: UpdateCustomerProfileInput): Promise<CustomerProfile> {
    const session = await requireCustomerSession(this.prisma);
    const before = await this.account(session.accountId);

    const phoneChanged = input.phone !== undefined && input.phone !== before.phone;

    const row = await this.prisma.db.customerAccount.update({
      where: { id: session.accountId },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        // A new number is a new, unchecked claim — whatever was true of the
        // old one does not carry over.
        ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.birthDate !== undefined
          ? { birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00Z`) : null }
          : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(input.notifyTelegram !== undefined ? { notifyTelegram: input.notifyTelegram } : {}),
        ...(input.marketingOptIn !== undefined
          ? {
              marketingOptIn: input.marketingOptIn,
              // When consent was given is what anyone asks about later.
              marketingOptInAt: input.marketingOptIn ? new Date() : null,
            }
          : {}),
      },
    });

    return toProfile(row);
  }

  /** Used by checkout, which needs the raw row. */
  async account(accountId: string): Promise<AccountRow> {
    const row = await this.prisma.db.customerAccount.findFirst({
      where: { id: accountId, deletedAt: null },
    });
    if (!row) {
      throw new AppException(
        ErrorCode.CUSTOMER_SESSION_REQUIRED,
        'Davom etish uchun ilovaga qayta kiring',
        401,
      );
    }
    return row;
  }

  /* ------------------------------------------------------------------ */
  /* Addresses                                                          */
  /* ------------------------------------------------------------------ */

  async listAddresses(): Promise<SavedAddress[]> {
    const session = await requireCustomerSession(this.prisma);
    const rows = await this.prisma.db.customerAccountAddress.findMany({
      where: { accountId: session.accountId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map(toSavedAddress);
  }

  async createAddress(input: SaveAddressInput): Promise<SavedAddress> {
    const session = await requireCustomerSession(this.prisma);

    const existing = await this.prisma.db.customerAccountAddress.count({
      where: { accountId: session.accountId, deletedAt: null },
    });
    if (existing >= MAX_ADDRESSES) {
      throw AppException.conflict(`Koʻpi bilan ${MAX_ADDRESSES} ta manzil saqlash mumkin`);
    }

    // The first address is the default whether or not it was asked for:
    // checkout picks the default, and an account with addresses but no
    // default would make the customer choose every time.
    const makeDefault = input.isDefault === true || existing === 0;

    const row = await this.prisma.transaction(async (tx) => {
      if (makeDefault) {
        await tx.customerAccountAddress.updateMany({
          where: { accountId: session.accountId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.customerAccountAddress.create({
        data: {
          ...addressData(input),
          accountId: session.accountId,
          address: input.address.trim(),
          isDefault: makeDefault,
        },
      });
    });

    return toSavedAddress(row);
  }

  async updateAddress(id: string, input: UpdateAddressInput): Promise<SavedAddress> {
    const session = await requireCustomerSession(this.prisma);
    await this.ownedAddress(session.accountId, id);

    const row = await this.prisma.transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.customerAccountAddress.updateMany({
          where: { accountId: session.accountId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.customerAccountAddress.update({
        where: { id },
        data: {
          ...addressData(input),
          // Unsetting the only default is refused by omission: the default is
          // moved by choosing another address, not by clearing this one.
          ...(input.isDefault === true ? { isDefault: true } : {}),
        },
      });
    });

    return toSavedAddress(row);
  }

  /** Soft delete; orders keep their own copy of the address anyway. */
  async deleteAddress(id: string): Promise<void> {
    const session = await requireCustomerSession(this.prisma);
    const address = await this.ownedAddress(session.accountId, id);

    await this.prisma.transaction(async (tx) => {
      await tx.customerAccountAddress.update({
        where: { id },
        data: { deletedAt: new Date(), isDefault: false },
      });

      // Removing the default hands the role to the most recently used one,
      // so checkout still has something to preselect.
      if (address.isDefault) {
        const next = await tx.customerAccountAddress.findFirst({
          where: { accountId: session.accountId, deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });
        if (next) {
          await tx.customerAccountAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
    });
  }

  /** The customer's own address, or a 404 — never someone else's. */
  async ownedAddress(accountId: string, id: string): Promise<AddressRow> {
    const row = await this.prisma.db.customerAccountAddress.findFirst({
      where: { id, accountId, deletedAt: null },
    });
    if (!row) throw AppException.notFound('Address', ErrorCode.ADDRESS_NOT_FOUND);
    return row;
  }
}

/** Only the fields that were sent; empty strings become `null`. */
function addressData(input: UpdateAddressInput) {
  const text = (value: string | null | undefined) =>
    value === undefined ? undefined : value?.trim() ? value.trim() : null;

  const data: Record<string, unknown> = {
    label: text(input.label),
    address: input.address?.trim(),
    house: text(input.house),
    apartment: text(input.apartment),
    entrance: text(input.entrance),
    floor: text(input.floor),
    intercom: text(input.intercom),
    comment: text(input.comment),
    latitude: input.latitude,
    longitude: input.longitude,
  };

  for (const key of Object.keys(data)) {
    if (data[key] === undefined) delete data[key];
  }
  return data as Partial<AddressRow> & { address?: string };
}

export function toProfile(row: AccountRow): CustomerProfile {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    phoneVerified: row.phoneVerifiedAt !== null,
    email: row.email,
    birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, 10) : null,
    gender: row.gender,
    telegram: {
      username: row.telegramUsername,
      firstName: row.telegramFirstName,
      lastName: row.telegramLastName,
      photoUrl: row.telegramPhotoUrl,
    },
    notifyTelegram: row.notifyTelegram,
    marketingOptIn: row.marketingOptIn,
    missingFields: missingProfileFields(row),
  };
}

export function toSavedAddress(row: AddressRow): SavedAddress {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    house: row.house,
    latitude: row.latitude,
    longitude: row.longitude,
    apartment: row.apartment,
    entrance: row.entrance,
    floor: row.floor,
    intercom: row.intercom,
    comment: row.comment,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
