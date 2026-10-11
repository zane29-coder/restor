import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ErrorCode,
  OrderType,
  type CheckoutPaymentOption,
  type CheckoutRequest,
  type OrderPricePreview,
  type RequiredProfileField,
  type SavedAddress,
} from '@restor/shared-types';
import { RestorApiError } from '@restor/api-client';
import {
  IconCard,
  IconCash,
  IconChevronRight,
  IconDoor,
  IconMapPin,
  IconMessage,
  IconPhone,
  IconPlus,
  IconTag,
} from '@restor/ui';
import { api } from '../api';
import { ProfileGateSheet } from '../components/ProfileGateSheet';
import { useToast } from '../components/Toast';
import { ErrorState, ListSkeleton, ScreenHeader, Skeleton, SwitchRow } from '../components/ui';
import { errorMessage, isCode, isNetworkFailure } from '../lib/errors';
import { PAYMENT_OPTION_LABELS, phone as formatPhoneDisplay, som } from '../lib/format';
import { useNav } from '../lib/nav';
import { useCart } from '../state/cart';
import { useSession } from '../state/session';
import { hapticResult, openExternal, setClosingConfirmation } from '../telegram';

const PROMO_CODES = new Set<string>([
  ErrorCode.PROMO_CODE_NOT_FOUND,
  ErrorCode.PROMO_CODE_EXPIRED,
  ErrorCode.PROMO_CODE_LIMIT_REACHED,
  ErrorCode.PROMO_CODE_NOT_APPLICABLE,
]);

const MENU_CHANGED = new Set<string>([
  ErrorCode.PRODUCT_UNAVAILABLE,
  ErrorCode.PRODUCT_NOT_FOUND,
  ErrorCode.MODIFIER_SELECTION_INVALID,
]);

/**
 * Placing the order (TZ 48 §14, §21–§24).
 *
 * Everything with a price comes from the server's preview, priced as this
 * customer; the button sends only what was chosen. A missing name or phone is
 * asked for at the moment "To'lash" is pressed, and the checkout then carries
 * on by itself — with the same idempotency key, so neither that nor a double
 * tap can place two orders.
 */
export function CheckoutScreen({ active }: { active: boolean }) {
  const session = useSession();
  const cart = useCart();
  const nav = useNav();
  const toast = useToast();
  const { draft } = cart.state;
  const branch = session.branch;
  const options = session.info.checkout;

  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OrderPricePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [promoInput, setPromoInput] = useState(draft.promoCode);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [gate, setGate] = useState<RequiredProfileField[] | null>(null);
  const autoOpenedEditor = useRef(false);

  /* ----------------------------- order type ----------------------------- */

  const types = useMemo(() => {
    const list: Array<typeof OrderType.DELIVERY | typeof OrderType.PICKUP> = [];
    if (branch?.acceptsDelivery) list.push(OrderType.DELIVERY);
    if (branch?.acceptsPickup) list.push(OrderType.PICKUP);
    return list;
  }, [branch]);

  const type = types.includes(draft.type) ? draft.type : (types[0] ?? OrderType.PICKUP);
  const isDelivery = type === OrderType.DELIVERY;

  /* ------------------------------ addresses ----------------------------- */

  const loadAddresses = useCallback(() => {
    setAddressError(null);
    api.me
      .addresses()
      .then(setAddresses)
      .catch((error) => setAddressError(errorMessage(error, 'Manzillar yuklanmadi')));
  }, []);

  // Reload when coming back from the address editor or picker.
  useEffect(() => {
    if (active) loadAddresses();
  }, [active, loadAddresses]);

  const selected =
    addresses?.find((address) => address.id === draft.addressId) ??
    addresses?.find((address) => address.isDefault) ??
    addresses?.[0] ??
    null;

  // Adopt the default address (and its standing details) the first time.
  useEffect(() => {
    if (!selected || draft.addressId === selected.id) return;
    cart.updateDraft({
      addressId: selected.id,
      apartment: selected.apartment ?? '',
      entrance: selected.entrance ?? '',
      floor: selected.floor ?? '',
      intercom: selected.intercom ?? '',
    });
  }, [selected?.id]);

  // No saved address at all: go straight to adding one, once.
  useEffect(() => {
    if (!active || !isDelivery || addresses === null || addresses.length > 0) return;
    if (autoOpenedEditor.current) return;
    autoOpenedEditor.current = true;
    nav.push({ name: 'address-edit', fromCheckout: true });
  }, [active, isDelivery, addresses]);

  /* ------------------------------- payment ------------------------------ */

  const paymentOption: CheckoutPaymentOption | null =
    draft.paymentOption && options.paymentOptions.includes(draft.paymentOption)
      ? draft.paymentOption
      : (options.paymentOptions[0] ?? null);
  const isOnline = paymentOption !== null && paymentOption !== 'CASH';

  /* ------------------------------- pricing ------------------------------ */

  const addressPayload = useMemo(
    () =>
      isDelivery && selected
        ? {
            addressId: selected.id,
            apartment: draft.apartment,
            entrance: draft.entrance,
            floor: draft.floor,
            intercom: draft.intercom,
            saveDetails: true,
          }
        : undefined,
    [isDelivery, selected, draft.apartment, draft.entrance, draft.floor, draft.intercom],
  );

  const previewKey = JSON.stringify([branch?.id, type, cart.items, draft.promoCode, selected?.id]);

  useEffect(() => {
    if (!branch || cart.items.length === 0) return;
    if (isDelivery && !selected) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      api.me
        .previewCheckout({
          branchId: branch.id,
          type,
          items: cart.items,
          promoCode: draft.promoCode || null,
          ...(addressPayload ? { address: { addressId: addressPayload.addressId } } : {}),
        })
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          setPreviewError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof RestorApiError && PROMO_CODES.has(error.code)) {
            // The code is the problem, not the order: drop it and price again.
            setPromoError(errorMessage(error));
            cart.updateDraft({ promoCode: '' });
            return;
          }
          setPreview(null);
          setPreviewError(errorMessage(error, 'Narxni hisoblab boʻlmadi'));
        })
        .finally(() => !cancelled && setPreviewing(false));
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewKey]);

  /* ------------------------------- submit ------------------------------- */

  // A ref, not state: two taps inside one frame both see `submitting` false.
  const inFlight = useRef(false);

  async function submit(flags: { profileChecked?: boolean } = {}) {
    if (inFlight.current || !branch || !paymentOption) return;

    if (cart.items.length === 0) {
      toast.show('Savat boʻsh', 'error');
      return;
    }
    if (isDelivery && !selected) {
      nav.push({ name: 'address-edit', fromCheckout: true });
      return;
    }

    // Checked again by the server; this only saves a round trip.
    const missing = session.profile.missingFields;
    if (!flags.profileChecked && missing.length > 0) {
      setGate(missing);
      return;
    }

    const body: Omit<CheckoutRequest, 'clientUuid'> = {
      branchId: branch.id,
      type,
      items: cart.items,
      promoCode: draft.promoCode || null,
      comment: cart.state.comment.trim() || null,
      courierComment: isDelivery ? draft.courierComment.trim() || null : null,
      cutleryCount: options.cutleryEnabled ? cart.state.cutlery : null,
      leaveAtDoor: isDelivery && options.leaveAtDoorEnabled ? draft.leaveAtDoor : false,
      ...(addressPayload ? { address: addressPayload } : {}),
      paymentOption,
    };
    // The same order content always gets the same key: a retry after a lost
    // response, or a second tap, returns the order already created.
    const clientUuid = cart.idempotencyKeyFor(JSON.stringify(body));

    inFlight.current = true;
    setSubmitting(true);
    setClosingConfirmation(true);
    try {
      const result = await api.me.checkout({ ...body, clientUuid });
      hapticResult('success');
      cart.markPlaced();
      session.refreshUnread();
      nav.reset([{ name: 'menu' }, { name: 'order', id: result.order.id, justPlaced: true }]);

      if (result.payment) {
        openExternal(result.payment.checkoutUrl);
      } else if (result.paymentError) {
        toast.show(`Buyurtma yaratildi, lekin toʻlov sahifasi ochilmadi: ${result.paymentError}`, 'error');
      }
    } catch (error) {
      hapticResult('error');
      handleError(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
      setClosingConfirmation(false);
    }
  }

  function handleError(error: unknown) {
    if (isCode(error, ErrorCode.PROFILE_INCOMPLETE)) {
      const missing = (error.details?.missing ?? []) as RequiredProfileField[];
      setGate(missing.length > 0 ? missing : ['firstName', 'lastName', 'phone']);
      return;
    }
    if (error instanceof RestorApiError && PROMO_CODES.has(error.code)) {
      setPromoError(errorMessage(error));
      cart.updateDraft({ promoCode: '' });
      toast.show(errorMessage(error), 'error');
      return;
    }
    if (error instanceof RestorApiError && MENU_CHANGED.has(error.code)) {
      session.reloadMenu();
      toast.show(errorMessage(error), 'error');
      nav.back();
      return;
    }
    if (isNetworkFailure(error)) {
      toast.show('Aloqa uzildi. Qayta bosing — buyurtma ikki marta yaratilmaydi', 'error');
      return;
    }
    toast.show(errorMessage(error), 'error');
  }

  /* -------------------------------- view -------------------------------- */

  if (!branch) {
    return (
      <div className="screen">
        <ScreenHeader title="Buyurtmani rasmiylashtirish" />
        <ErrorState message="Filial tanlanmagan" />
      </div>
    );
  }

  const total = preview?.total ?? null;
  const belowMinimum = isDelivery && preview !== null && preview.subtotal < branch.minOrderAmount;
  const canSubmit =
    !submitting &&
    paymentOption !== null &&
    cart.items.length > 0 &&
    (!isDelivery || selected !== null) &&
    !belowMinimum &&
    preview !== null &&
    !previewing;

  return (
    <div className="screen screen--with-bar">
      <ScreenHeader title="Buyurtmani rasmiylashtirish" subtitle={session.info.restaurant.name} />

      {types.length > 1 && (
        <div className="segmented" role="tablist" aria-label="Buyurtma turi">
          {types.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={entry === type}
              className={`segmented__item${entry === type ? ' segmented__item--active' : ''}`}
              onClick={() => cart.updateDraft({ type: entry })}
            >
              {entry === OrderType.DELIVERY ? 'Yetkazib berish' : 'Olib ketish'}
            </button>
          ))}
        </div>
      )}

      {isDelivery ? (
        <section className="card-block">
          {addressError ? (
            <ErrorState message={addressError} onRetry={loadAddresses} />
          ) : addresses === null ? (
            <ListSkeleton rows={1} />
          ) : selected ? (
            <>
              <button
                type="button"
                className="row-btn"
                onClick={() => nav.push({ name: 'addresses', picking: true })}
              >
                <IconMapPin size={22} />
                <span className="row-btn__text">
                  {selected.label && <span className="row-btn__caption">{selected.label}</span>}
                  <span className="row-btn__title">
                    {selected.house ? `${selected.address}, ${selected.house}` : selected.address}
                  </span>
                </span>
                <IconChevronRight size={18} />
              </button>

              <div className="field-grid">
                <label className="field">
                  <span className="field__label">Kvartira</span>
                  <input
                    inputMode="text"
                    maxLength={20}
                    value={draft.apartment}
                    onChange={(event) => cart.updateDraft({ apartment: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Domofon</span>
                  <input
                    maxLength={20}
                    value={draft.intercom}
                    onChange={(event) => cart.updateDraft({ intercom: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Podyezd</span>
                  <input
                    inputMode="numeric"
                    maxLength={20}
                    value={draft.entrance}
                    onChange={(event) => cart.updateDraft({ entrance: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Qavat</span>
                  <input
                    inputMode="numeric"
                    maxLength={20}
                    value={draft.floor}
                    onChange={(event) => cart.updateDraft({ floor: event.target.value })}
                  />
                </label>
              </div>
              <p className="hint">Bu maʼlumotlar manzilingizga saqlanadi — keyingi safar qayta yozmaysiz.</p>

              <label className="field field--icon">
                <IconMessage size={20} />
                <input
                  maxLength={300}
                  placeholder="Kuryer uchun izoh (faqat shu buyurtma)"
                  value={draft.courierComment}
                  onChange={(event) => cart.updateDraft({ courierComment: event.target.value })}
                />
              </label>

              {options.leaveAtDoorEnabled && (
                <div className="switch-with-icon">
                  <IconDoor size={20} />
                  <SwitchRow
                    label="Eshik oldida qoldirish"
                    checked={draft.leaveAtDoor}
                    onChange={(checked) => cart.updateDraft({ leaveAtDoor: checked })}
                  />
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              className="row-btn row-btn--accent"
              onClick={() => nav.push({ name: 'address-edit', fromCheckout: true })}
            >
              <IconPlus size={22} />
              <span className="row-btn__text">
                <span className="row-btn__title">Yetkazib berish manzilini qoʻshing</span>
              </span>
              <IconChevronRight size={18} />
            </button>
          )}
        </section>
      ) : (
        <section className="card-block">
          <div className="row-btn row-btn--static">
            <IconMapPin size={22} />
            <span className="row-btn__text">
              <span className="row-btn__caption">Olib ketish manzili</span>
              <span className="row-btn__title">{branch.name}</span>
              <span className="row-btn__sub">{branch.address}</span>
            </span>
          </div>
        </section>
      )}

      <section className="card-block">
        <button type="button" className="row-btn" onClick={() => nav.push({ name: 'settings' })}>
          <IconPhone size={22} />
          <span className="row-btn__text">
            <span className="row-btn__caption">Oluvchi</span>
            <span className="row-btn__title">
              {[session.profile.firstName, session.profile.lastName].filter(Boolean).join(' ') ||
                'Ism kiritilmagan'}
            </span>
            <span className="row-btn__sub">
              {session.profile.phone ? formatPhoneDisplay(session.profile.phone) : 'Telefon kiritilmagan'}
            </span>
          </span>
          <IconChevronRight size={18} />
        </button>
      </section>

      <section className="card-block">
        <h2 className="block-title">Toʻlov</h2>
        {options.paymentOptions.length === 0 ? (
          <p className="notice notice--warn">Restoran hozircha onlayn buyurtma uchun toʻlov usulini yoqmagan.</p>
        ) : (
          <div className="pay-options" role="radiogroup" aria-label="Toʻlov usuli">
            {options.paymentOptions.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === paymentOption}
                className={`pay-option${option === paymentOption ? ' pay-option--active' : ''}`}
                onClick={() => cart.updateDraft({ paymentOption: option })}
              >
                {option === 'CASH' ? <IconCash size={22} /> : <IconCard size={22} />}
                <span className="pay-option__label">{PAYMENT_OPTION_LABELS[option]}</span>
                <span className="pay-option__sub">
                  {option === 'CASH' ? (isDelivery ? 'Kuryerga' : 'Kassada') : 'Onlayn'}
                </span>
              </button>
            ))}
          </div>
        )}
        {isOnline && (
          <p className="hint">
            Toʻlov xavfsiz Subo sahifasida amalga oshiriladi. Saqlangan kartalaringiz oʻsha sahifada
            koʻrsatiladi — karta maʼlumotlari restoranda saqlanmaydi.
          </p>
        )}
        {paymentOption === 'CASH' && isDelivery && (
          <p className="hint">Naqd toʻlov buyurtma yetkazilganda kuryerga qilinadi.</p>
        )}
      </section>

      <section className="card-block">
        <h2 className="block-title">Buyurtma narxi</h2>

        <div className="promo">
          <label className="field field--icon promo__field">
            <IconTag size={20} />
            <input
              placeholder="Promokod"
              autoCapitalize="characters"
              value={promoInput}
              maxLength={40}
              onChange={(event) => {
                setPromoInput(event.target.value.toUpperCase());
                setPromoError(null);
              }}
            />
          </label>
          {draft.promoCode && draft.promoCode === promoInput.trim() ? (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                cart.updateDraft({ promoCode: '' });
                setPromoInput('');
              }}
            >
              Bekor qilish
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={promoInput.trim().length < 3}
              onClick={() => {
                setPromoError(null);
                cart.updateDraft({ promoCode: promoInput.trim() });
              }}
            >
              Qoʻllash
            </button>
          )}
        </div>
        {promoError && <p className="field__error">{promoError}</p>}

        {previewError ? (
          <div className="notice notice--error">{previewError}</div>
        ) : !preview ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <Skeleton height={14} />
            <Skeleton height={14} width="70%" />
          </div>
        ) : (
          <dl className="breakdown">
            <div>
              <dt>Savatdagi mahsulotlar</dt>
              <dd>{som(preview.subtotal)}</dd>
            </div>
            {preview.appliedPromotions
              .filter((promotion) => promotion.amount > 0)
              .map((promotion, index) => (
                <div key={`${promotion.name}-${index}`} className="breakdown__discount">
                  <dt>{promotion.promoCodeId ? `Promokod ${promotion.name}` : promotion.name}</dt>
                  <dd>−{som(promotion.amount)}</dd>
                </div>
              ))}
            {isDelivery && (
              <div>
                <dt>Yetkazib berish</dt>
                <dd className={preview.deliveryFee === 0 ? 'breakdown__free' : undefined}>
                  {preview.deliveryFee === 0 ? 'Bepul' : som(preview.deliveryFee)}
                </dd>
              </div>
            )}
            {preview.serviceFee > 0 && (
              <div>
                <dt>Xizmat yigʻimi</dt>
                <dd>{som(preview.serviceFee)}</dd>
              </div>
            )}
          </dl>
        )}

        {belowMinimum && (
          <div className="notice notice--warn">
            Yetkazib berish uchun minimal buyurtma: {som(branch.minOrderAmount)}
          </div>
        )}
        {!branch.isOpenNow && (
          <div className="notice">Filial hozir yopiq — buyurtma ish vaqtida koʻrib chiqiladi.</div>
        )}
      </section>

      <div className="bottom-bar bottom-bar--total">
        <div className="bottom-bar__total">
          <span>Jami</span>
          <strong>{total === null ? '—' : som(total)}</strong>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--grow btn--large"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {submitting ? 'Yuborilmoqda…' : isOnline ? 'Toʻlash' : 'Buyurtma berish'}
        </button>
      </div>

      <ProfileGateSheet
        open={gate !== null}
        missing={gate ?? []}
        onClose={() => setGate(null)}
        onSaved={() => {
          setGate(null);
          // Carry on from where the customer pressed the button — the
          // profile was just saved, so it is not asked for again.
          window.setTimeout(() => void submit({ profileChecked: true }), 0);
        }}
      />
    </div>
  );
}
