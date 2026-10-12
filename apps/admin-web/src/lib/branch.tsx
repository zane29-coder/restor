import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BranchSummary } from '@restor/shared-types';
import { api } from './api';
import { useAuth } from './auth';

const STORAGE_KEY = 'restor.admin.branch';

interface BranchState {
  /** Branches this user may see, in the API's order. */
  branches: BranchSummary[];
  isLoading: boolean;
  /** `''` means every branch the user can see. */
  branchId: string;
  setBranchId: (id: string) => void;
  /** The selected branch, or `undefined` for "all". */
  current: BranchSummary | undefined;
}

const BranchContext = createContext<BranchState | null>(null);

/**
 * The branch the admin is looking at, chosen once in the top bar.
 *
 * Pages read it as the default for their own branch filter, so switching to
 * Chilonzor in the header narrows the dashboard, the orders and the stock
 * together instead of each screen keeping its own idea of "which branch".
 * It is a filter, never an authorisation: the API still scopes every query by
 * the token's branches.
 */
export function BranchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['branches', 'summary'],
    queryFn: () => api.branches.summaries(),
    staleTime: 60_000,
  });

  const branches = useMemo(() => {
    const all = query.data ?? [];
    const allowed = user?.branchIds ?? [];
    // An empty list means "every branch of the tenant".
    return allowed.length > 0 ? all.filter((b) => allowed.includes(b.id)) : all;
  }, [query.data, user?.branchIds]);

  const [branchId, setBranchIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  // A stored id can outlive the branch (deleted, or the user re-scoped), and a
  // user limited to one branch has nothing to choose.
  useEffect(() => {
    if (query.isLoading) return;
    if (branches.length === 1 && branchId !== branches[0]!.id) {
      setBranchIdState(branches[0]!.id);
    } else if (branchId && !branches.some((b) => b.id === branchId)) {
      setBranchIdState('');
    }
  }, [branches, branchId, query.isLoading]);

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Not persisted; still applies for this session.
    }
  }, []);

  const value = useMemo<BranchState>(
    () => ({
      branches,
      isLoading: query.isLoading,
      branchId,
      setBranchId,
      current: branches.find((b) => b.id === branchId),
    }),
    [branches, query.isLoading, branchId, setBranchId],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch(): BranchState {
  const context = useContext(BranchContext);
  if (!context) throw new Error('useBranch must be used inside <BranchProvider>');
  return context;
}

/**
 * Today's opening hours as `08:30 – 23:00`, or `null` when closed or unset.
 *
 * Uses the browser's weekday, which is the branch's for every restaurant
 * today; `isOpenNow` from the API is the authoritative open/closed answer.
 */
export function todaysHours(branch: Pick<BranchSummary, 'workingHours'>): string | null {
  // `Weekday` is ISO: Monday 1 … Sunday 7; `getDay()` has Sunday as 0.
  const today = new Date().getDay() || 7;
  const row = branch.workingHours.find((h) => h.dayOfWeek === today);
  if (!row || row.isClosed) return null;
  return `${row.opensAt} – ${row.closesAt}`;
}
