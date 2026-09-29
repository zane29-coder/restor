import { LocalStorageTokenStore, createRestorClient } from '@restor/api-client';

/**
 * A kitchen screen is signed in once and then left running for months, so the
 * token store must survive reloads and power cuts.
 */
export const api = createRestorClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '/api/v1',
  tokenStore: new LocalStorageTokenStore('restor.kds.tokens'),
});

const BRANCH_KEY = 'restor.kds.branchId';

/** The chosen branch is remembered per device, not per session. */
export function loadBranchId(): string | null {
  try {
    return globalThis.localStorage?.getItem(BRANCH_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveBranchId(branchId: string): void {
  try {
    globalThis.localStorage?.setItem(BRANCH_KEY, branchId);
  } catch {
    // Private mode or blocked storage: the screen still works this session.
  }
}
