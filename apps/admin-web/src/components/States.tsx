import type { ReactNode } from 'react';
import { IconAlert, IconInbox } from '@restor/ui';
import { RestorApiError } from '../lib/api';

export function Loading({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <div className="center">
      <div style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
        <div className="spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}

/**
 * Renders an API failure.
 *
 * Shows the server's message rather than a generic one: the backend already
 * returns something safe and specific ("Missing permission: orders.cancel"),
 * and hiding it just makes the user guess.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof RestorApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Nomaʼlum xatolik';

  const requestId = error instanceof RestorApiError ? error.requestId : undefined;

  return (
    <div className="card">
      <div className="alert alert--error" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <IconAlert size={16} style={{ marginTop: 1 }} />
        {message}
      </div>
      {requestId && (
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
          Request ID: <code>{requestId}</code>
        </p>
      )}
      {onRetry && (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          Qayta urinish
        </button>
      )}
    </div>
  );
}

export function Empty({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="card center" style={{ minHeight: 180 }}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 10, textAlign: 'center' }}>
        <IconInbox size={34} strokeWidth={1.5} style={{ color: 'var(--border)' }} />
        <p style={{ fontWeight: 600, color: 'var(--text)', margin: 0 }}>{title}</p>
        {description && <p className="muted" style={{ margin: 0 }}>{description}</p>}
      </div>
    </div>
  );
}
