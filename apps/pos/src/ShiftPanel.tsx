import { useEffect, useState } from 'react';
import type { CashShift, ShiftSummary } from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import { RestorApiError } from '@restor/api-client';
import { api } from './api';

/**
 * Opening a shift (TZ §19).
 *
 * The till is gated behind this: cash taken outside a shift belongs to nobody
 * and reconciles against nothing. The float is counted into the drawer here
 * so the closing count has something to be measured against.
 */
export function OpenShiftScreen({
  branchId,
  branchName,
  onOpened,
}: {
  branchId: string;
  branchName: string;
  onOpened: (shift: CashShift) => void;
}) {
  const [openingCash, setOpeningCash] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setIsBusy(true);
    setError(null);
    try {
      onOpened(
        await api.cash.openShift({ branchId, openingCash: digits(openingCash) }),
      );
    } catch (caught) {
      setError(caught instanceof RestorApiError ? caught.message : 'Smena ochilmadi');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="pos__center">
      <div className="login-box">
        <h1>Smenani boshlash</h1>
        <p className="cart__meta" style={{ marginBottom: 14 }}>
          {branchName} · kassadagi boshlangʻich pulni sanab kiriting.
        </p>

        {error && <div className="pos__error" style={{ marginBottom: 12 }}>{error}</div>}

        <input
          className="pay-input"
          inputMode="numeric"
          value={openingCash}
          onChange={(event) => setOpeningCash(event.target.value)}
          placeholder="0"
          autoFocus
        />
        <p className="cart__meta" style={{ margin: '6px 0 16px' }}>
          Kassa boʻsh boʻlsa 0 qoldiring.
        </p>

        <button
          type="button"
          className="pay-btn pay-btn--primary"
          style={{ width: '100%' }}
          onClick={() => void open()}
          disabled={isBusy}
        >
          {isBusy ? 'OCHILMOQDA…' : 'SMENANI OCHISH'}
        </button>
      </div>
    </div>
  );
}

/**
 * Closing a shift: the X-report, then a physical count (TZ §19).
 *
 * The expected figure is shown BEFORE the cashier types what they counted,
 * which is a deliberate trade-off. Hiding it would give a cleaner audit, but
 * a cashier who cannot see the target has no way to spot their own miscount,
 * and every small difference turns into an investigation. The difference is
 * recorded either way.
 */
export function CloseShiftDialog({
  shift,
  onClose,
  onClosed,
}: {
  shift: CashShift;
  onClose: () => void;
  onClosed: (message: string) => void;
}) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [counted, setCounted] = useState('');
  const [comment, setComment] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.cash
      .shiftSummary(shift.id)
      .then(setSummary)
      .catch(() => setError('Hisobot yuklanmadi'));
  }, [shift.id]);

  const expected = summary?.expectedCash ?? shift.expectedCash;
  const countedAmount = digits(counted);
  const difference = countedAmount - expected;

  async function close() {
    setIsBusy(true);
    setError(null);
    try {
      await api.cash.closeShift(shift.id, {
        actualCash: countedAmount,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      onClosed(
        difference === 0
          ? 'Smena yopildi — farq yoʻq'
          : `Smena yopildi — farq ${formatMoney(difference)}`,
      );
    } catch (caught) {
      setError(caught instanceof RestorApiError ? caught.message : 'Smena yopilmadi');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="pay-overlay" role="dialog" aria-modal="true" aria-label="Smenani yopish">
      <div className="pay-sheet">
        <div className="pay-sheet__head">
          <span className="cart__meta">Smena hisoboti</span>
          <strong className="pay-sheet__total">{formatMoney(expected)}</strong>
        </div>

        {error && <div className="pos__error" style={{ marginBottom: 12 }}>{error}</div>}

        {summary ? (
          <div className="shift-report">
            <ReportRow label="Boshlangʻich qoldiq" value={summary.openingCash} />
            <ReportRow label="Naqd savdo" value={summary.cashSales} />
            <ReportRow label="Karta savdo" value={summary.cardSales} muted />
            <ReportRow label="Onlayn" value={summary.onlineSales} muted />
            <ReportRow label="Qaytarish" value={-summary.refunds} />
            <ReportRow label="Kassaga kirim" value={summary.cashIn} />
            <ReportRow label="Kassadan chiqim" value={-summary.cashOut} />
            <ReportRow label="Kuryerdan" value={summary.courierHandovers} />
            <div className="shift-report__rule" />
            <ReportRow label="Kassada boʻlishi kerak" value={expected} strong />
            <p className="cart__meta" style={{ marginTop: 6 }}>
              {summary.orderCount} ta buyurtma. Karta va onlayn savdo kassaga tushmaydi.
            </p>
          </div>
        ) : (
          <p className="cart__meta">Hisobot yuklanmoqda…</p>
        )}

        <div className="pay-section">
          <label className="cart__meta" htmlFor="counted">
            Kassadan sanab olindi
          </label>
          <input
            id="counted"
            className="pay-input"
            inputMode="numeric"
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
            placeholder={String(expected)}
            autoFocus
          />

          {counted !== '' && difference !== 0 && (
            <div className={`pay-change${difference < 0 ? ' pay-change--short' : ''}`}>
              <span>{difference < 0 ? 'Kamomad' : 'Ortiqcha'}</span>
              <strong>{formatMoney(Math.abs(difference))}</strong>
            </div>
          )}

          {counted !== '' && difference !== 0 && (
            <input
              className="pay-input"
              style={{ marginTop: 10 }}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Farq sababi (ixtiyoriy)"
            />
          )}
        </div>

        <div className="pay-actions">
          <button
            type="button"
            className="pay-btn"
            style={{ background: '#6b7280' }}
            onClick={onClose}
            disabled={isBusy}
          >
            BEKOR
          </button>
          <button
            type="button"
            className="pay-btn pay-btn--primary"
            onClick={() => void close()}
            disabled={isBusy || counted === ''}
          >
            {isBusy ? 'YOPILMOQDA…' : 'SMENANI YOPISH'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportRow({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: number;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={`shift-report__row${strong ? ' shift-report__row--strong' : ''}`}>
      <span className={muted ? 'cart__meta' : undefined}>{label}</span>
      <span className={muted ? 'cart__meta' : undefined}>{formatMoney(value)}</span>
    </div>
  );
}

function digits(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}
