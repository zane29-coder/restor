import { useEffect } from 'react';
import type { Order } from '@restor/shared-types';
import { formatMoney } from '@restor/shared-utils';
import type { TenderPart } from './PaymentDialog';

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Naqd',
  CARD: 'Karta',
  TERMINAL: 'Terminal',
  SUBO: 'Onlayn',
  CLICK: 'Click',
  PAYME: 'Payme',
  QR: 'QR',
  BONUS: 'Bonus',
};

/**
 * The receipt shown after a sale, and printed if the cashier asks.
 *
 * Deliberately shown even when nothing will be printed: it is the cashier's
 * confirmation that the sale landed, and it carries the change they owe. The
 * number they need most — the change — is the largest thing on it.
 *
 * Printing is `window.print()` against a print stylesheet rather than a
 * driver integration. A thermal printer on this counter is reached through
 * the OS print queue like any other, and a POS that cannot print at all is a
 * worse failure than one that prints an A4-shaped receipt.
 */
export function Receipt({
  order,
  parts,
  change,
  branchName,
  onDismiss,
}: {
  order: Order;
  parts: TenderPart[];
  change: number;
  branchName: string;
  onDismiss: () => void;
}) {
  // Enter or Escape closes: the cashier's hands are already on the keyboard
  // and the next customer is waiting.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div className="pay-overlay" role="dialog" aria-modal="true" aria-label="Chek">
      <div className="pay-sheet receipt">
        <div className="receipt__paper">
          <div className="receipt__brand">RESTOR</div>
          <div className="receipt__meta">{branchName}</div>
          <div className="receipt__meta">
            {new Date(order.createdAt).toLocaleString('uz-UZ')}
          </div>
          <div className="receipt__number">{order.displayNumber}</div>

          <div className="receipt__rule" />

          {order.items.map((item) => (
            <div key={item.id} className="receipt__line">
              <span>
                {item.name}
                {item.quantity > 1 ? ` ×${item.quantity}` : ''}
              </span>
              <span>{formatMoney(item.total, 'UZS', { withCurrency: false })}</span>
            </div>
          ))}

          <div className="receipt__rule" />

          <div className="receipt__line">
            <span>Oraliq</span>
            <span>{formatMoney(order.subtotal, 'UZS', { withCurrency: false })}</span>
          </div>
          {order.discountTotal > 0 && (
            <div className="receipt__line">
              <span>Chegirma</span>
              <span>−{formatMoney(order.discountTotal, 'UZS', { withCurrency: false })}</span>
            </div>
          )}
          {order.deliveryFee > 0 && (
            <div className="receipt__line">
              <span>Yetkazish</span>
              <span>{formatMoney(order.deliveryFee, 'UZS', { withCurrency: false })}</span>
            </div>
          )}

          <div className="receipt__line receipt__line--total">
            <span>JAMI</span>
            <span>{formatMoney(order.total, 'UZS', { withCurrency: false })}</span>
          </div>

          {parts.map((part) => (
            <div key={part.method} className="receipt__line">
              <span>{METHOD_LABEL[part.method] ?? part.method}</span>
              <span>{formatMoney(part.amount, 'UZS', { withCurrency: false })}</span>
            </div>
          ))}

          <div className="receipt__rule" />
          <div className="receipt__meta receipt__thanks">Xaridingiz uchun rahmat!</div>
        </div>

        {change > 0 && (
          <div className="receipt__change">
            <span>QAYTIM</span>
            <strong>{formatMoney(change)}</strong>
          </div>
        )}

        <div className="pay-actions">
          <button
            type="button"
            className="pay-btn"
            style={{ background: '#6b7280' }}
            onClick={() => window.print()}
          >
            CHOP ETISH
          </button>
          <button type="button" className="pay-btn pay-btn--primary" onClick={onDismiss} autoFocus>
            KEYINGISI
          </button>
        </div>
      </div>
    </div>
  );
}
