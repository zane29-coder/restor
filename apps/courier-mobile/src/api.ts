import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createRestorClient, type StoredTokens, type TokenStore } from '@restor/api-client';

/**
 * Tokens in the device keychain / Android Keystore.
 *
 * A courier's phone is the most likely device to be lost or stolen, and its
 * token can move money (cash collected on delivery). `AsyncStorage` is plain
 * text on a rooted device; SecureStore is not.
 */
class SecureTokenStore implements TokenStore {
  private readonly key = 'restor.courier.tokens';

  async get(): Promise<StoredTokens | null> {
    try {
      const raw = await SecureStore.getItemAsync(this.key);
      return raw ? (JSON.parse(raw) as StoredTokens) : null;
    } catch {
      return null;
    }
  }

  async set(tokens: StoredTokens): Promise<void> {
    try {
      await SecureStore.setItemAsync(this.key, JSON.stringify(tokens));
    } catch {
      // Keychain unavailable; the session simply won't survive a restart.
    }
  }

  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(this.key);
    } catch {
      // Nothing to do.
    }
  }
}

const apiUrl =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://10.0.2.2:3000/api/v1'; // Android emulator's alias for the host machine

export const api = createRestorClient({
  baseUrl: apiUrl,
  tokenStore: new SecureTokenStore(),
  // Couriers work on patchy mobile data; a longer timeout beats a false
  // failure that makes them re-tap "delivered".
  timeoutMs: 30_000,
});
