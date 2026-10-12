import { STATUS_LABELS, STATUS_TONES } from '../lib/labels';

/** An order status as staff read it, in the same colour on every screen. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`pill ${STATUS_TONES[status] ?? 'tone-neutral'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
