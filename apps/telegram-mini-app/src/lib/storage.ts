import { tenantSlug } from '../api';
import { deviceUserKey } from '../telegram';

/**
 * Small, non-secret state that should survive closing the sheet: the cart,
 * the checkout draft, the chosen branch.
 *
 * Never a token — those stay in memory (see api.ts). Keyed by restaurant AND
 * Telegram user, so two accounts on one phone, or two restaurants' Mini Apps,
 * never see each other's cart. Every access tolerates a WebView that refuses
 * storage: the app then simply forgets on close.
 */
function key(name: string): string {
  return `restor:${tenantSlug}:${deviceUserKey()}:${name}`;
}

export function load<T>(name: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key(name));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(name: string, value: unknown): void {
  try {
    window.localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    // Storage full or disabled: the in-memory state still works this session.
  }
}

export function remove(name: string): void {
  try {
    window.localStorage.removeItem(key(name));
  } catch {
    // Nothing to do.
  }
}
