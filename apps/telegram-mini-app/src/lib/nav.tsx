import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { setBackButton } from '../telegram';

/** Every screen of the Mini App. Sheets and dialogs are overlays, not routes. */
export type Route =
  | { name: 'menu' }
  | { name: 'search' }
  | { name: 'cart' }
  | { name: 'checkout' }
  | { name: 'order'; id: string; justPlaced?: boolean }
  | { name: 'orders' }
  | { name: 'profile' }
  | { name: 'settings' }
  | { name: 'addresses'; picking?: boolean }
  | { name: 'address-edit'; id?: string; fromCheckout?: boolean }
  | { name: 'favorites' }
  | { name: 'notifications' }
  | { name: 'promo-codes' }
  | { name: 'help' }
  | { name: 'about' };

interface Navigator {
  stack: Route[];
  current: Route;
  push: (route: Route) => void;
  replace: (route: Route) => void;
  /** Replaces the whole stack — after an order is placed, say. */
  reset: (routes: Route[]) => void;
  /** One step back: the top overlay if any, else the top screen. */
  back: () => void;
  /** Registers an open overlay so "back" closes it first. */
  registerOverlay: (close: () => void) => () => void;
}

const NavContext = createContext<Navigator | null>(null);

export function useNav(): Navigator {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavigatorProvider');
  return nav;
}

/**
 * One notion of "back" for the whole app.
 *
 * Every screen and every open sheet owns one browser-history entry, so the
 * three ways a customer goes back all do the same thing: Telegram's back
 * button (and Android's back gesture, which presses it), the browser's back,
 * and the arrows drawn in the app. All three end in `history.back()`, and the
 * `popstate` handler takes exactly one step — closing the top sheet first,
 * otherwise leaving the top screen.
 *
 * Screens below the top stay mounted (hidden), so going back finds the menu
 * exactly where it was: data loaded, scroll position restored.
 */
export function NavigatorProvider({ initial, children }: { initial: Route[]; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>(initial);
  const [overlayCount, setOverlayCount] = useState(0);

  const overlays = useRef<Array<{ id: number; close: () => void }>>([]);
  const nextOverlayId = useRef(0);
  /** Our entries currently on the browser history. */
  const historyDepth = useRef(0);
  /** `history.back()` calls whose popstate must be ignored (already handled). */
  const silentPops = useRef(0);
  const scrollTops = useRef<number[]>([]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const pushHistory = useCallback(() => {
    window.history.pushState({ restor: historyDepth.current + 1 }, '');
    historyDepth.current += 1;
  }, []);

  // The initial stack (a deep link opens [menu, order]) needs its entries too.
  // Only once: `initial` is read on mount (guarded for StrictMode's re-run).
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    // Scroll is restored by this navigator (screens) and by the sheet's
    // scroll lock (overlays). Left on "auto", the browser restores its own
    // idea of the position on every `popstate` — which, for an entry pushed
    // while a sheet had the page pinned, is the top of the menu.
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    for (let i = 1; i < initial.length; i += 1) pushHistory();
  }, []);

  const step = useCallback(() => {
    const top = overlays.current.pop();
    if (top) {
      setOverlayCount(overlays.current.length);
      top.close();
      return;
    }
    if (stackRef.current.length > 1) {
      setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      historyDepth.current = Math.max(0, historyDepth.current - 1);
      if (silentPops.current > 0) {
        silentPops.current -= 1;
        return;
      }
      step();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [step]);

  const back = useCallback(() => {
    if (historyDepth.current > 0) {
      window.history.back();
    } else {
      // Nothing of ours on the history (a reset left it short): step directly.
      step();
    }
  }, [step]);

  const push = useCallback(
    (route: Route) => {
      scrollTops.current[stackRef.current.length - 1] = window.scrollY;
      pushHistory();
      setStack((current) => [...current, route]);
    },
    [pushHistory],
  );

  const replace = useCallback((route: Route) => {
    setStack((current) => [...current.slice(0, -1), route]);
  }, []);

  const reset = useCallback(
    (routes: Route[]) => {
      while (historyDepth.current < routes.length - 1) pushHistory();
      scrollTops.current = [];
      setStack(routes);
    },
    [pushHistory],
  );

  const registerOverlay = useCallback(
    (close: () => void) => {
      const id = (nextOverlayId.current += 1);
      overlays.current.push({ id, close });
      setOverlayCount(overlays.current.length);
      pushHistory();

      // Called when the overlay closes by itself (✕, swipe, "Saqlash"): its
      // history entry is still there and must be consumed without stepping.
      return () => {
        const index = overlays.current.findIndex((entry) => entry.id === id);
        if (index === -1) return; // already closed by "back"
        overlays.current.splice(index, 1);
        setOverlayCount(overlays.current.length);
        if (historyDepth.current > 0) {
          silentPops.current += 1;
          window.history.back();
        }
      };
    },
    [pushHistory],
  );

  // Telegram's back button: visible whenever there is somewhere to go back to.
  useEffect(() => {
    const canGoBack = stack.length > 1 || overlayCount > 0;
    return setBackButton(canGoBack, back);
  }, [stack.length, overlayCount, back]);

  // Restore the scroll position of the screen we returned to; start new
  // screens at the top.
  const previousLength = useRef(stack.length);
  useLayoutEffect(() => {
    const index = stack.length - 1;
    if (stack.length < previousLength.current) {
      window.scrollTo(0, scrollTops.current[index] ?? 0);
    } else if (stack.length > previousLength.current) {
      window.scrollTo(0, 0);
    }
    previousLength.current = stack.length;
  }, [stack]);

  const value = useMemo<Navigator>(
    () => ({
      stack,
      current: stack[stack.length - 1]!,
      push,
      replace,
      reset,
      back,
      registerOverlay,
    }),
    [stack, push, replace, reset, back, registerOverlay],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/**
 * Makes an overlay (sheet, dialog) part of "back": while `open`, the back
 * button closes it instead of leaving the screen.
 */
export function useOverlay(open: boolean, onClose: () => void): void {
  const nav = useNav();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // `nav.registerOverlay` is stable, so only `open` matters.
  useEffect(() => {
    if (!open) return;
    return nav.registerOverlay(() => onCloseRef.current());
  }, [open]);
}

/** A stable key per route, for remounting a screen when its route changes. */
export function routeKey(route: Route): string {
  switch (route.name) {
    case 'order':
      return `order:${route.id}`;
    case 'address-edit':
      return `address-edit:${route.id ?? 'new'}`;
    default:
      return route.name;
  }
}
