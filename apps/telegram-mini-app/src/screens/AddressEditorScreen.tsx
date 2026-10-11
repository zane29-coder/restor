import { useEffect, useRef, useState } from 'react';
import type { GeoPlace, SaveAddressRequest, SavedAddress } from '@restor/shared-types';
import { IconLocate, IconSearch, IconTrash } from '@restor/ui';
import { api } from '../api';
import { ConfirmDialog } from '../components/BottomSheet';
import { MapPicker, type MapPickerHandle } from '../components/MapPicker';
import { useToast } from '../components/Toast';
import { ErrorState, ListSkeleton, ScreenHeader, SwitchRow } from '../components/ui';
import { errorMessage, fieldErrors } from '../lib/errors';
import { useNav } from '../lib/nav';
import { useCart } from '../state/cart';
import { useSession } from '../state/session';
import { hapticResult } from '../telegram';

const LABELS = ['Uy', 'Ish', 'Universitet'];
/** Tashkent centre, for a customer with no pin and a branch without one. */
const FALLBACK = { latitude: 41.3111, longitude: 69.2797 };

interface Form {
  label: string;
  address: string;
  house: string;
  apartment: string;
  entrance: string;
  floor: string;
  intercom: string;
  comment: string;
  isDefault: boolean;
  latitude: number | null;
  longitude: number | null;
}

function toForm(address: SavedAddress | null): Form {
  return {
    label: address?.label ?? '',
    address: address?.address ?? '',
    house: address?.house ?? '',
    apartment: address?.apartment ?? '',
    entrance: address?.entrance ?? '',
    floor: address?.floor ?? '',
    intercom: address?.intercom ?? '',
    comment: address?.comment ?? '',
    isDefault: address?.isDefault ?? false,
    latitude: address?.latitude ?? null,
    longitude: address?.longitude ?? null,
  };
}

/**
 * Adding or editing a saved address (TZ 48 §20).
 *
 * The map names the street under the pin; the customer adds what a geocoder
 * cannot know — house, apartment, entrance, floor, intercom. Location access
 * is asked only when "my location" is pressed, and refusing it changes
 * nothing else: the map and the typed fields work without it.
 */
export function AddressEditorScreen({ id, fromCheckout }: { id?: string; fromCheckout?: boolean }) {
  const nav = useNav();
  const cart = useCart();
  const session = useSession();
  const toast = useToast();
  const mapRef = useRef<MapPickerHandle>(null);

  const [loaded, setLoaded] = useState<SavedAddress | null | undefined>(id ? undefined : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => toForm(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [customLabel, setCustomLabel] = useState(false);
  /** Once the customer types the street themselves, the map stops overwriting it. */
  const streetTouched = useRef(false);
  const geocodeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    api.me
      .addresses()
      .then((all) => {
        const found = all.find((entry) => entry.id === id) ?? null;
        if (!found) {
          setLoadError('Manzil topilmadi');
          return;
        }
        setLoaded(found);
        setForm(toForm(found));
        streetTouched.current = true;
        setCustomLabel(Boolean(found.label && !LABELS.includes(found.label)));
      })
      .catch((error) => setLoadError(errorMessage(error, 'Manzil yuklanmadi')));
  }, [id]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  const start = {
    latitude: form.latitude ?? session.branch?.latitude ?? FALLBACK.latitude,
    longitude: form.longitude ?? session.branch?.longitude ?? FALLBACK.longitude,
  };

  /** The map came to rest: remember the pin and name the street under it. */
  function onSettle(latitude: number, longitude: number) {
    setForm((current) => ({ ...current, latitude, longitude }));
    window.clearTimeout(geocodeTimer.current);
    geocodeTimer.current = window.setTimeout(() => {
      setResolving(true);
      api.me
        .reverseGeocode(latitude, longitude)
        .then((place) => {
          if (!place) return;
          setForm((current) => ({
            ...current,
            address: streetTouched.current && current.address ? current.address : (place.street ?? place.label),
            house: current.house || place.house || '',
          }));
        })
        .catch(() => undefined) // Typing the address by hand still works.
        .finally(() => setResolving(false));
    }, 500);
  }

  // Search as the customer types, a beat after they stop.
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.me
        .searchPlaces(query.trim(), start)
        .then(setResults)
        .catch(() => setResults([]));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [query]);

  function locate() {
    if (!navigator.geolocation) {
      toast.show('Qurilma joylashuvni aniqlay olmaydi — xaritadan tanlang', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        streetTouched.current = false;
        mapRef.current?.flyTo(position.coords.latitude, position.coords.longitude);
      },
      (error) =>
        toast.show(
          error.code === error.PERMISSION_DENIED
            ? 'Joylashuvga ruxsat berilmadi — xaritadan tanlang yoki qoʻlda kiriting'
            : 'Joylashuv aniqlanmadi — xaritadan tanlang',
          'error',
        ),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function save() {
    const next: Record<string, string> = {};
    if (form.address.trim().length < 3) next.address = 'Koʻcha nomini kiriting';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      hapticResult('warning');
      return;
    }

    const payload: SaveAddressRequest = {
      label: form.label.trim() || null,
      address: form.address.trim(),
      house: form.house.trim() || null,
      apartment: form.apartment.trim() || null,
      entrance: form.entrance.trim() || null,
      floor: form.floor.trim() || null,
      intercom: form.intercom.trim() || null,
      comment: form.comment.trim() || null,
      latitude: form.latitude,
      longitude: form.longitude,
      ...(form.isDefault ? { isDefault: true } : {}),
    };

    setBusy(true);
    try {
      const saved = loaded ? await api.me.updateAddress(loaded.id, payload) : await api.me.createAddress(payload);
      hapticResult('success');
      if (fromCheckout) {
        cart.updateDraft({
          addressId: saved.id,
          apartment: saved.apartment ?? '',
          entrance: saved.entrance ?? '',
          floor: saved.floor ?? '',
          intercom: saved.intercom ?? '',
        });
      }
      nav.back();
    } catch (error) {
      setErrors(fieldErrors(error));
      toast.show(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!loaded) return;
    setConfirmDelete(false);
    setBusy(true);
    try {
      await api.me.deleteAddress(loaded.id);
      if (cart.state.draft.addressId === loaded.id) cart.updateDraft({ addressId: null });
      nav.back();
    } catch (error) {
      toast.show(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="screen">
        <ScreenHeader title="Manzil" />
        <ErrorState message={loadError} />
      </div>
    );
  }
  if (loaded === undefined) {
    return (
      <div className="screen">
        <ScreenHeader title="Manzil" />
        <ListSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="screen screen--tinted">
      <ScreenHeader
        title={loaded ? 'Manzilni tahrirlash' : 'Yangi manzil'}
        actions={
          loaded ? (
            <button type="button" className="icon-btn" aria-label="Manzilni oʻchirish" onClick={() => setConfirmDelete(true)}>
              <IconTrash size={22} />
            </button>
          ) : undefined
        }
      />

      <div className="map-block">
        <MapPicker ref={mapRef} latitude={start.latitude} longitude={start.longitude} onSettle={onSettle} />
        <button type="button" className="map-block__locate" aria-label="Mening joylashuvim" onClick={locate}>
          <IconLocate size={22} />
        </button>
        <div className="map-block__search">
          <IconSearch size={18} />
          <input
            type="search"
            placeholder="Manzilni qidirish"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Manzilni qidirish"
          />
        </div>
        {results.length > 0 && (
          <ul className="map-block__results" role="listbox">
            {results.map((place, index) => (
              <li key={`${place.latitude}-${place.longitude}-${index}`}>
                <button
                  type="button"
                  onClick={() => {
                    setResults([]);
                    setQuery('');
                    streetTouched.current = false;
                    setForm((current) => ({
                      ...current,
                      address: place.street ?? place.label,
                      house: place.house ?? current.house,
                    }));
                    mapRef.current?.flyTo(place.latitude, place.longitude);
                  }}
                >
                  {place.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className="card-block form">
        <div className="chips" role="radiogroup" aria-label="Manzil nomi">
          {LABELS.map((label) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={!customLabel && form.label === label}
              className={`chip-btn${!customLabel && form.label === label ? ' chip-btn--active' : ''}`}
              onClick={() => {
                setCustomLabel(false);
                set('label', form.label === label ? '' : label);
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={customLabel}
            className={`chip-btn${customLabel ? ' chip-btn--active' : ''}`}
            onClick={() => {
              setCustomLabel(true);
              if (LABELS.includes(form.label)) set('label', '');
            }}
          >
            Boshqa
          </button>
        </div>
        {customLabel && (
          <label className="field">
            <span className="field__label">Manzil nomi</span>
            <input maxLength={60} placeholder="Masalan: Onamning uyi" value={form.label} onChange={(e) => set('label', e.target.value)} />
          </label>
        )}

        <label className="field">
          <span className="field__label">Koʻcha {resolving && <span className="muted">· aniqlanmoqda…</span>}</span>
          <input
            maxLength={500}
            value={form.address}
            onChange={(event) => {
              streetTouched.current = true;
              set('address', event.target.value);
            }}
            aria-invalid={Boolean(errors.address)}
          />
          {errors.address && <span className="field__error">{errors.address}</span>}
        </label>

        <div className="field-grid">
          <label className="field">
            <span className="field__label">Uy</span>
            <input maxLength={20} value={form.house} onChange={(e) => set('house', e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Kvartira</span>
            <input maxLength={20} value={form.apartment} onChange={(e) => set('apartment', e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Podyezd</span>
            <input inputMode="numeric" maxLength={20} value={form.entrance} onChange={(e) => set('entrance', e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Qavat</span>
            <input inputMode="numeric" maxLength={20} value={form.floor} onChange={(e) => set('floor', e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Domofon</span>
            <input maxLength={20} value={form.intercom} onChange={(e) => set('intercom', e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span className="field__label">Kuryer uchun izoh</span>
          <textarea
            rows={2}
            maxLength={500}
            placeholder="Masalan: darvoza kodi 1234, chapdagi kirish"
            value={form.comment}
            onChange={(e) => set('comment', e.target.value)}
          />
        </label>

        {!loaded?.isDefault && (
          <SwitchRow label="Asosiy manzil" checked={form.isDefault} onChange={(value) => set('isDefault', value)} />
        )}
      </section>

      <div className="form-actions">
        <button type="button" className="btn btn--primary btn--block btn--large" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Manzilni oʻchirasizmi?"
        text="Avvalgi buyurtmalardagi manzil oʻzgarmaydi."
        confirmLabel="Oʻchirish"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
