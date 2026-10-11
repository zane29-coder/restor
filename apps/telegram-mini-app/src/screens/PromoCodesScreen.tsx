import { useCallback, useEffect, useState } from 'react';
import type { PublicPromoCode } from '@restor/shared-types';
import { IconTag } from '@restor/ui';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, ListSkeleton, ScreenHeader } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { dateTime, promoValueLabel, som } from '../lib/format';
import { useNav } from '../lib/nav';
import { useCart } from '../state/cart';

/**
 * The restaurant's public promo codes (TZ 48 §18), with the conditions and
 * how many uses this customer has left. Whether a code applies is decided by
 * the server at checkout; "Qo'llash" only puts it into the checkout.
 */
export function PromoCodesScreen({ active }: { active: boolean }) {
  const cart = useCart();
  const nav = useNav();
  const toast = useToast();
  const [codes, setCodes] = useState<PublicPromoCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.me
      .promoCodes()
      .then((result) => {
        setCodes(result);
        setError(null);
      })
      .catch((caught) => setError(errorMessage(caught, 'Promo-kodlar yuklanmadi')));
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  function apply(code: PublicPromoCode) {
    cart.updateDraft({ promoCode: code.code });
    toast.show(`${code.code} buyurtmani rasmiylashtirishda qoʻllanadi`, 'success');
    if (cart.count > 0) nav.push({ name: 'cart' });
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.show('Nusxa olindi', 'success');
    } catch {
      toast.show(code);
    }
  }

  return (
    <div className="screen screen--tinted">
      <ScreenHeader title="Promo-kodlar" />

      {error && !codes ? (
        <ErrorState message={error} onRetry={load} />
      ) : !codes ? (
        <ListSkeleton rows={3} />
      ) : codes.length === 0 ? (
        <EmptyState icon={<IconTag size={30} />} title="Hozircha promo-kod yoʻq" text="Yangi aksiyalar boʻlsa, shu yerda koʻrinadi" />
      ) : (
        <div className="list">
          {codes.map((code) => (
            <article key={code.id} className="promo-card">
              <div className="promo-card__head">
                <button type="button" className="promo-card__code" onClick={() => void copy(code.code)} aria-label={`${code.code} — nusxa olish`}>
                  {code.code}
                </button>
                <span className="promo-card__value">{promoValueLabel(code.type, code.discount, code.maxDiscount)}</span>
              </div>
              {code.description && <p className="promo-card__desc">{code.description}</p>}
              <ul className="promo-card__terms">
                {code.minOrderAmount != null && <li>Minimal buyurtma: {som(code.minOrderAmount)}</li>}
                {code.endsAt && <li>Amal qiladi: {dateTime(code.endsAt)} gacha</li>}
                <li>{code.branchNames.length > 0 ? `Filiallar: ${code.branchNames.join(', ')}` : 'Barcha filiallarda'}</li>
                {code.usesLeft != null && <li>Sizda qolgan: {code.usesLeft} marta</li>}
                <li>Avtomatik aksiyalardan keyin qolgan summaga qoʻllanadi</li>
              </ul>
              <button type="button" className="btn btn--secondary btn--block" onClick={() => apply(code)}>
                Qoʻllash
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
