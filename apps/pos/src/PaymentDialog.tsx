import { useEffect, useMemo, useState } from 'react';
import { PaymentMethod } from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';

export interface TenderPart {
  method: PaymentMethod;
  amount: number;
}

type Mode = 'CASH' | 'CARD' | 'MIXED';

/** Notes a cashier in Tashkent actually has in the drawer. */
const QUICK_NOTES = [10_000, 20_000, 50_000, 100_000, 200_000];

/**
 * The payment step (TZ §17).
 *
 * Three things this screen exists to get right, in the order they bite:
 *
 *  1. **Change.** The cashier types what the customer handed over, not what
 *     the bill is, and the change is computed and shown large. Doing that
 *     arithmetic in your head at a queue is how tills come up short.
 *  2. **Mixed payment.** Part cash, part card is routine here, and it has to
 *     land as ONE settlement — see `settle` in the offline queue.
 *  3. **Never settling more than is owed.** The server refuses it anyway, but
 *     a button that can produce a rejected payment is a button that wastes a
 *     cashier's time at the worst moment.
 */
export function PaymentDialog({
  total,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  total: number;
  isSubmitting: boolean;
  onCancel: () => void;
  /**
   * `tendered` is what the customer physically handed over, which is NOT the
   * same as the sum of `parts`: the order is credited with what it costs, and
   * the difference is change the cashier owes. Passing only `parts` would
   * make every change calculation come out as zero.
   */
  onConfirm: (parts: TenderPart[], tendered: number) => void;
}) {
  const [mode, setMode] = useState<Mode>('CASH');
  const [tendered, setTendered] = useState('');
  const [cashPart, setCashPart] = useState('');

  // Escape is the fastest way out when a customer changes their mind.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, isSubmitting]);

  const tenderedAmount = digits(tendered);
  const change = Math.max(0, tenderedAmount - total);
  const cashAmount = Math.min(digits(cashPart), total);
  const cardAmount = Math.max(0, total - cashAmount);

  const parts = useMemo<TenderPart[]>(() => {
    switch (mode) {
      case 'CASH':
        // The ORDER is credited with what it costs, never with the banknote.
        // Change is the cashier's business, not the order's.
        return [{ method: PaymentMethod.CASH, amount: total }];
      case 'CARD':
        return [{ method: PaymentMethod.CARD, amount: total }];
      case 'MIXED':
        return [
          { method: PaymentMethod.CASH, amount: cashAmount },
          { method: PaymentMethod.CARD, amount: cardAmount },
        ].filter((part) => part.amount > 0);
    }
  }, [mode, total, cashAmount, cardAmount]);

  const canConfirm =
    !isSubmitting &&
    total > 0 &&
    (mode !== 'CASH' || tenderedAmount === 0 || tenderedAmount >= total) &&
    (mode !== 'MIXED' || (cashAmount > 0 && cashAmount < total));

  return (
    <div className="pay-overlay" role="dialog" aria-modal="true" aria-label="Toʻlov">
      <div className="pay-sheet">
        <div className="pay-sheet__head">
          <span className="cart__meta">Toʻlanadi</span>
          <strong className="pay-sheet__total">{formatMoney(total)}</strong>
        </div>

        <div className="pay-modes">
          {(
            [
              ['CASH', 'NAQD'],
              ['CARD', 'KARTA'],
              ['MIXED', 'ARALASH'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`pay-mode${mode === value ? ' pay-mode--active' : ''}`}
              onClick={() => setMode(value)}
              disabled={isSubmitting}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'CASH' && (
          <div className="pay-section">
            <label className="cart__meta" htmlFor="tendered">
              Mijoz berdi (ixtiyoriy — qaytimni hisoblash uchun)
            </label>
            <input
              id="tendered"
              className="pay-input"
              inputMode="numeric"
              value={tendered}
              onChange={(event) => setTendered(event.target.value)}
              placeholder={String(total)}
              autoFocus
            />

            <div className="pay-quick">
              <button
                type="button"
                className="pay-quick__btn"
                onClick={() => setTendered(String(total))}
              >
                Aniq
              </button>
              {QUICK_NOTES.filter((note) => note >= total).slice(0, 3).map((note) => (
                <button
                  key={note}
                  type="button"
                  className="pay-quick__btn"
                  onClick={() => setTendered(String(note))}
                >
                  {formatMoney(note, 'UZS', { withCurrency: false })}
                </button>
              ))}
            </div>

            <div className="pay-keypad" aria-label="Raqamli klaviatura">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map(key => <button key={key} type="button" disabled={isSubmitting} aria-label={key === '⌫' ? 'Oxirgi raqamni o‘chirish' : key} onClick={() => setTendered(value => key === '⌫' ? value.slice(0, -1) : `${value}${key}`)}>{key}</button>)}
            </div>

            {tenderedAmount > 0 && tenderedAmount < total && (
              <p className="pay-warn">
                Yetarli emas — yana {formatMoney(total - tenderedAmount)} kerak
              </p>
            )}
            {change > 0 && (
              <div className="pay-change">
                <span>Qaytim</span>
                <strong>{formatMoney(change)}</strong>
              </div>
            )}
          </div>
        )}

        {mode === 'MIXED' && (
          <div className="pay-section">
            <label className="cart__meta" htmlFor="cash-part">
              Naqd qismi
            </label>
            <input
              id="cash-part"
              className="pay-input"
              inputMode="numeric"
              value={cashPart}
              onChange={(event) => setCashPart(event.target.value)}
              placeholder="0"
              autoFocus
            />
            <div className="pay-split">
              <div>
                <span className="cart__meta">Naqd</span>
                <strong>{formatMoney(cashAmount)}</strong>
              </div>
              <div>
                <span className="cart__meta">Karta</span>
                <strong>{formatMoney(cardAmount)}</strong>
              </div>
            </div>
            {cashAmount >= total && (
              <p className="pay-warn">Naqd qismi jamidan kam boʻlishi kerak</p>
            )}
          </div>
        )}

        <div className="pay-actions">
          <button
            type="button"
            className="pay-btn"
            style={{ background: '#6b7280' }}
            onClick={onCancel}
            disabled={isSubmitting}
          >
            BEKOR
          </button>
          <button
            type="button"
            className="pay-btn pay-btn--primary"
            // A cashier who did not type what was handed over is telling us it
            // was exact, so there is no change.
            onClick={() => onConfirm(parts, mode === 'CASH' ? Math.max(tenderedAmount, total) : total)}
            disabled={!canConfirm}
          >
            {isSubmitting ? 'YUBORILMOQDA…' : 'TASDIQLASH'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Digits only: a cashier typing "50 000" or "50.000" means fifty thousand. */
function digits(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}
