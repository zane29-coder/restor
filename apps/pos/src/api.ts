import { LocalStorageTokenStore, createRestorClient } from '@restor/api-client';

export const api = createRestorClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '/api/v1',
  tokenStore: new LocalStorageTokenStore('restor.pos.tokens'),
});

const BRANCH_KEY = 'restor.pos.branchId';

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
    // Storage blocked; the terminal still works for this session.
  }
}
