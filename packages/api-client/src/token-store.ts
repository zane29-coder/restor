/**
 * Where tokens live is platform-specific — `localStorage` in the browser,
 * `expo-secure-store` on the courier phone, an encrypted file in the POS
 * desktop shell. The client only needs this interface, so `@restor/api-client`
 * itself stays free of any platform API (TZ §71).
 */

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
}

export interface TokenStore {
  get(): StoredTokens | null | Promise<StoredTokens | null>;
  set(tokens: StoredTokens): void | Promise<void>;
  clear(): void | Promise<void>;
}

/**
 * Default store: keeps tokens in memory only. Safe everywhere and the right
 * choice for short-lived processes; swap it for a persistent one in an app that
 * must survive a reload.
 */
export class MemoryTokenStore implements TokenStore {
  private tokens: StoredTokens | null = null;

  get(): StoredTokens | null {
    return this.tokens;
  }

  set(tokens: StoredTokens): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }
}

/**
 * Browser store backed by `localStorage`.
 *
 * Every read is guarded: `localStorage` throws in a private window with site
 * data blocked, and a crash there would take the whole app down on boot.
 */
export class LocalStorageTokenStore implements TokenStore {
  constructor(private readonly key = 'restor.tokens') {}

  get(): StoredTokens | null {
    try {
      const raw = globalThis.localStorage?.getItem(this.key);
      return raw ? (JSON.parse(raw) as StoredTokens) : null;
    } catch {
      return null;
    }
  }

  set(tokens: StoredTokens): void {
    try {
      globalThis.localStorage?.setItem(this.key, JSON.stringify(tokens));
    } catch {
      // Storage unavailable or full — the session simply won't survive a reload.
    }
  }

  clear(): void {
    try {
      globalThis.localStorage?.removeItem(this.key);
    } catch {
      // Nothing to do.
    }
  }
}

/** Builds a {@link StoredTokens} from an auth response's `expiresIn` seconds. */
export function toStoredTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}): StoredTokens {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  };
}
