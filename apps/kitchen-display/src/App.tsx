import { useCallback, useEffect, useState } from 'react';
import type { BranchSummary, KitchenTicket } from '@restor/shared-types';
import { RestorApiError } from '@restor/api-client';
import { api, loadBranchId, saveBranchId } from './api';
import { LoginScreen } from './LoginScreen';
import { TicketCard } from './TicketCard';

/**
 * Kitchen Display System (TZ §21).
 *
 * Polls rather than holding a WebSocket: a kitchen screen runs unattended for
 * weeks, and a poll that misses a beat recovers by itself where a dropped
 * socket needs reconnection logic nobody is watching. Three seconds is well
 * inside the time it takes to read a new ticket.
 */
const POLL_INTERVAL_MS = 3_000;

export function App() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branchId, setBranchId] = useState<string | null>(loadBranchId());
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Restore the session on boot.
  useEffect(() => {
    void (async () => {
      try {
        if (await api.http.isAuthenticated()) {
          await api.auth.me();
          setIsAuthenticated(true);
        }
      } catch {
        await api.http.clearTokens();
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  // Branch picker options.
  useEffect(() => {
    if (!isAuthenticated) return;
    void api.branches
      .summaries()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [isAuthenticated]);

  const loadTickets = useCallback(async () => {
    if (!branchId) return;
    try {
      setTickets(await api.kitchen.tickets(branchId));
      setError(null);
    } catch (caught) {
      // A blip should not blank the board — the stale tickets stay on screen
      // with a warning, which is far safer than an empty kitchen display.
      setError(caught instanceof RestorApiError ? caught.message : 'Aloqa uzildi');
    }
  }, [branchId]);

  useEffect(() => {
    if (!isAuthenticated || !branchId) return;

    void loadTickets();
    const timer = setInterval(() => void loadTickets(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isAuthenticated, branchId, loadTickets]);

  // Local clock so the timers tick smoothly between polls.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  async function act(ticket: KitchenTicket, action: 'start' | 'ready') {
    setBusyTicketId(ticket.id);
    try {
      const updated =
        action === 'start'
          ? await api.kitchen.start(ticket.id)
          : await api.kitchen.ready(ticket.id);

      // Optimistic local update, then a refresh to pick up sibling tickets.
      setTickets((current) =>
        action === 'ready'
          ? current.filter((entry) => entry.id !== ticket.id)
          : current.map((entry) => (entry.id === ticket.id ? updated : entry)),
      );
      void loadTickets();
    } catch (caught) {
      setError(caught instanceof RestorApiError ? caught.message : 'Amal bajarilmadi');
    } finally {
      setBusyTicketId(null);
    }
  }

  if (!isReady) {
    return (
      <div className="kds">
        <div className="kds__center">Yuklanmoqda…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onSuccess={() => setIsAuthenticated(true)} />;
  }

  if (!branchId) {
    return (
      <div className="kds">
        <div className="kds__center">
          <div className="login-box">
            <h1 style={{ margin: 0 }}>Filialni tanlang</h1>
            <select
              className="kds__select"
              defaultValue=""
              onChange={(event) => {
                if (!event.target.value) return;
                saveBranchId(event.target.value);
                setBranchId(event.target.value);
              }}
            >
              <option value="" disabled>
                — tanlang —
              </option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  }

  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? '';

  return (
    <div className="kds">
      <header className="kds__header">
        <div className="kds__brand">
          RES<span>TOR</span>
        </div>
        <select
          className="kds__select"
          value={branchId}
          onChange={(event) => {
            saveBranchId(event.target.value);
            setBranchId(event.target.value);
          }}
          aria-label="Filial"
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 18 }}>{tickets.length} ta faol</span>
        <div className="kds__clock">
          {new Date(now).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </header>

      {error && <div className="kds__error">{error}</div>}

      {tickets.length === 0 ? (
        <div className="kds__empty">
          <div>
            <p style={{ fontSize: 30, margin: '0 0 8px' }}>✓</p>
            <p style={{ margin: 0 }}>Hamma buyurtma tayyor</p>
            <p style={{ fontSize: 15, marginTop: 8 }}>{branchName}</p>
          </div>
        </div>
      ) : (
        <div className="kds__board">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              now={now}
              isBusy={busyTicketId === ticket.id}
              onStart={() => void act(ticket, 'start')}
              onReady={() => void act(ticket, 'ready')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
