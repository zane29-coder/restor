import type { CreateOrderRequest, Order } from '@restor/shared-types';
import { RestorApiError } from '@restor/api-client';
import { api } from './api';

const QUEUE_KEY = 'restor.pos.queue';

export interface QueuedOrder {
  clientUuid: string;
  payload: CreateOrderRequest;
  queuedAt: string;
  attempts: number;
}

/**
 * Offline order queue (TZ §18).
 *
 * When the network drops mid-service the till must keep taking orders. Each
 * one is stamped with a `clientUuid` BEFORE the first attempt and stored
 * locally; on reconnect the queue is replayed.
 *
 * Replay is safe because the backend is idempotent on `clientUuid` — a
 * duplicate returns the original order rather than creating a second one, so a
 * half-sent request during a flaky connection cannot double-charge a customer.
 *
 * `localStorage` rather than SQLite: the browser-based terminal has no SQLite,
 * and an order queue is small and short-lived. A desktop shell (Electron or
 * Tauri) can swap this module for a SQLite-backed one without the rest of the
 * app changing — see the README.
 */
export function readQueue(): QueuedOrder[] {
  try {
    const raw = globalThis.localStorage?.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOrder[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedOrder[]): void {
  try {
    globalThis.localStorage?.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Out of quota — nothing useful to do beyond keeping the app alive.
  }
}

export function enqueue(payload: CreateOrderRequest & { clientUuid: string }): void {
  const queue = readQueue();
  // Guard against the same order being queued twice by a double tap.
  if (queue.some((entry) => entry.clientUuid === payload.clientUuid)) return;

  queue.push({
    clientUuid: payload.clientUuid,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  writeQueue(queue);
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

/**
 * Replays queued orders oldest-first.
 *
 * Stops at the first NETWORK failure — if the connection is still down there
 * is no point burning through the rest. A rejection from the server (a
 * stop-listed product, say) is permanent, so that entry is dropped rather than
 * retried forever; it is surfaced to the cashier instead.
 */
export async function flushQueue(
  onOrderSynced?: (order: Order) => void,
): Promise<FlushResult> {
  const queue = readQueue();
  if (queue.length === 0) return { sent: 0, failed: 0, remaining: 0 };

  const remaining: QueuedOrder[] = [];
  let sent = 0;
  let failed = 0;
  let offline = false;

  for (const entry of queue) {
    if (offline) {
      remaining.push(entry);
      continue;
    }

    try {
      const order = await api.orders.create(entry.payload);
      sent += 1;
      onOrderSynced?.(order);
    } catch (error) {
      if (error instanceof RestorApiError && error.isNetworkFailure) {
        offline = true;
        remaining.push({ ...entry, attempts: entry.attempts + 1 });
      } else {
        // The server actively rejected it; retrying changes nothing.
        failed += 1;
      }
    }
  }

  writeQueue(remaining);
  return { sent, failed, remaining: remaining.length };
}

export function queueSize(): number {
  return readQueue().length;
}
