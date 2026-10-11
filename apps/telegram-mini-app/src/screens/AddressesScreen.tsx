import { useCallback, useEffect, useState } from 'react';
import type { SavedAddress } from '@restor/shared-types';
import { IconBriefcase, IconChevronRight, IconHome, IconMapPin, IconPlus } from '@restor/ui';
import { api } from '../api';
import { EmptyState, ErrorState, ListSkeleton, ScreenHeader } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { useNav } from '../lib/nav';
import { useCart } from '../state/cart';

export function addressIcon(label: string | null) {
  const value = (label ?? '').toLowerCase();
  if (value === 'uy') return <IconHome size={22} />;
  if (value === 'ish') return <IconBriefcase size={22} />;
  return <IconMapPin size={22} />;
}

export function addressLine(address: SavedAddress): string {
  return address.house ? `${address.address}, ${address.house}` : address.address;
}

export function addressDetails(address: SavedAddress): string {
  return [
    address.apartment && `${address.apartment}-xonadon`,
    address.entrance && `${address.entrance}-podyezd`,
    address.floor && `${address.floor}-qavat`,
    address.intercom && `domofon ${address.intercom}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * "Manzillarim" (TZ 48 §20) — and, opened from checkout, the address picker.
 * Addresses belong to the customer's RESTOR account, so the same list is
 * there in every restaurant.
 */
export function AddressesScreen({ picking, active }: { picking?: boolean; active: boolean }) {
  const nav = useNav();
  const cart = useCart();
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.me
      .addresses()
      .then((result) => {
        setAddresses(result);
        setError(null);
      })
      .catch((caught) => setError(errorMessage(caught, 'Manzillar yuklanmadi')));
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  function choose(address: SavedAddress) {
    if (!picking) {
      nav.push({ name: 'address-edit', id: address.id });
      return;
    }
    cart.updateDraft({
      addressId: address.id,
      apartment: address.apartment ?? '',
      entrance: address.entrance ?? '',
      floor: address.floor ?? '',
      intercom: address.intercom ?? '',
    });
    nav.back();
  }

  return (
    <div className="screen screen--tinted">
      <ScreenHeader title={picking ? 'Manzilni tanlang' : 'Manzillarim'} />

      {error && !addresses ? (
        <ErrorState message={error} onRetry={load} />
      ) : !addresses ? (
        <ListSkeleton rows={3} />
      ) : addresses.length === 0 ? (
        <EmptyState
          icon={<IconMapPin size={30} />}
          title="Saqlangan manzil yoʻq"
          text="Manzilni bir marta saqlang — barcha restoranlarda ishlatiladi"
        />
      ) : (
        <div className="list">
          {addresses.map((address) => {
            const isChosen = picking && cart.state.draft.addressId === address.id;
            return (
              <div key={address.id} className={`address-card${isChosen ? ' address-card--chosen' : ''}`}>
                <button type="button" className="address-card__main" onClick={() => choose(address)}>
                  {addressIcon(address.label)}
                  <span className="address-card__text">
                    <span className="address-card__label">
                      {address.label ?? 'Manzil'}
                      {address.isDefault && <span className="badge-soft">Asosiy</span>}
                    </span>
                    <span className="address-card__line">{addressLine(address)}</span>
                    {addressDetails(address) && (
                      <span className="address-card__details">{addressDetails(address)}</span>
                    )}
                  </span>
                  {!picking && <IconChevronRight size={18} />}
                </button>
                {picking && (
                  <button
                    type="button"
                    className="link-btn address-card__edit"
                    onClick={() => nav.push({ name: 'address-edit', id: address.id, fromCheckout: true })}
                  >
                    Tahrirlash
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="form-actions">
        <button
          type="button"
          className="btn btn--secondary btn--block btn--large"
          onClick={() => nav.push({ name: 'address-edit', fromCheckout: picking })}
        >
          <IconPlus size={20} />
          Yangi manzil qoʻshish
        </button>
      </div>
    </div>
  );
}
