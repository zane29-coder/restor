import { KitchenTicketStatus, type KitchenTicket } from '@restor/shared-types';
import { formatElapsed } from '@restor/shared-utils';
import { kdsUrgencyFor } from '@restor/ui';

/**
 * One ticket card (TZ §21).
 *
 * The elapsed time is recomputed locally from `createdAt` rather than trusting
 * the server's `elapsedSeconds` snapshot, so the timer keeps ticking smoothly
 * between polls instead of jumping every three seconds.
 */
export function TicketCard({
  ticket,
  now,
  isBusy,
  onStart,
  onReady,
}: {
  ticket: KitchenTicket;
  now: number;
  isBusy: boolean;
  onStart: () => void;
  onReady: () => void;
}) {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now - new Date(ticket.createdAt).getTime()) / 1000),
  );
  const urgency = kdsUrgencyFor(elapsedSeconds);
  const isQueued = ticket.status === KitchenTicketStatus.QUEUED;

  return (
    <article className={`ticket ticket--${urgency}`}>
      <header className="ticket__head">
        <span className="ticket__number">{ticket.displayNumber}</span>
        {ticket.stationId && <span className="ticket__station">stansiya</span>}
        {/* The number is also stated in text, so colour is never the only cue. */}
        <span className="ticket__timer">{formatElapsed(elapsedSeconds)}</span>
      </header>

      <ul className="ticket__items">
        {ticket.items.map((item) => (
          <li key={item.id} className="ticket__item">
            <span className="ticket__qty">{item.quantity}×</span>
            {item.name}
            {item.variantName && <span style={{ opacity: 0.75 }}> · {item.variantName}</span>}
            {item.modifiers.length > 0 && (
              <div className="ticket__modifiers">+ {item.modifiers.join(', ')}</div>
            )}
            {item.comment && <div className="ticket__modifiers">✎ {item.comment}</div>}
          </li>
        ))}
      </ul>

      {ticket.comment && <p className="ticket__comment">✎ {ticket.comment}</p>}

      <div className="ticket__actions">
        {isQueued ? (
          <button
            type="button"
            className="ticket__btn ticket__btn--start"
            onClick={onStart}
            disabled={isBusy}
          >
            BOSHLASH
          </button>
        ) : (
          <button type="button" className="ticket__btn" disabled>
            TAYYORLANMOQDA
          </button>
        )}
        <button
          type="button"
          className="ticket__btn ticket__btn--ready"
          onClick={onReady}
          disabled={isBusy}
        >
          TAYYOR
        </button>
      </div>
    </article>
  );
}
