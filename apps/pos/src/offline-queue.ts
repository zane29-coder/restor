import type { CreateOrderRequest, Order, PaymentMethod } from '@restor/shared-types';
import { RestorApiError } from '@restor/api-client';
import { api } from './api';

const QUEUE_KEY = 'restor.pos.queue';

/** What the customer handed over, replayed once the link returns. */
export interface QueuedPayment {
  parts: Array<{ method: PaymentMethod; amount: number }>;
}

export interface QueuedOrder {
  clientUuid: string;
  payload: CreateOrderRequest;
  /**
   * The tender taken at the till while offline.
   *
   * Carried with the order because the money changed hands at the counter —
   * the server simply has not heard about it yet. Replaying the order without
   * it would leave a sale that was paid in cash sitting UNPAID, and the
   * drawer would not balance at close.
   */
  payment?: QueuedPayment;
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

export function enqueue(
  payload: CreateOrderRequest & { clientUuid: string },
  payment?: QueuedPayment,
): void {
  const queue = readQueue();
  // Guard against the same order being queued twice by a double tap.
  if (queue.some((entry) => entry.clientUuid === payload.clientUuid)) return;

  queue.push({
    clientUuid: payload.clientUuid,
    payload,
    payment,
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

      // Settle it with the tender that was taken at the counter. A failure
      // here is not fatal to the replay: the order exists and is visible, and
      // a cashier can settle it from the order screen. Losing the ORDER would
      // be far worse than losing the payment record attached to it.
      if (entry.payment && entry.payment.parts.length > 0) {
        try {
          await settle(order.id, entry.payment);
        } catch {
          failed += 1;
        }
      }

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

/**
 * Records a tender against an order.
 *
 * One part goes through `payments`, several through `payments/mixed`, because
 * a mixed payment must land as one atomic write — two separate calls leave a
 * window where the order is half paid and a crash loses the rest.
 */
export async function settle(orderId: string, payment: QueuedPayment): Promise<void> {
  if (payment.parts.length === 1) {
    const part = payment.parts[0]!;
    await api.payments.create({ orderId, method: part.method, amount: part.amount });
    return;
  }
  await api.payments.createMixed({ orderId, parts: payment.parts });
}
