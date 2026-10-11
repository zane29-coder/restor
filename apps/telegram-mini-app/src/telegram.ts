/**
 * Telegram WebApp bridge (TZ §48).
 *
 * The only thing that matters for security here is `initData`: it is forwarded
 * to the backend VERBATIM and verified there against the bot token. Nothing in
 * `initDataUnsafe` is ever trusted for identity — as its name says. It is used
 * only to namespace local storage and to theme the UI before the server has
 * answered.
 *
 * Every method beyond the oldest API is optional-chained: a customer on an
 * old Telegram build gets a slightly plainer app, never a crash.
 */

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}

interface BackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (handler: () => void) => void;
  offClick: (handler: () => void) => void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
    start_param?: string;
  };
  version: string;
  platform: string;
  themeParams: TelegramThemeParams;
  colorScheme: 'light' | 'dark';
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  close: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink?: (url: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
  BackButton?: BackButton;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged?: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/** True when running inside Telegram rather than a plain browser tab. */
export function isInsideTelegram(): boolean {
  return Boolean(getWebApp()?.initData);
}

/** Version gate for methods that throw on old clients instead of no-oping. */
function supports(version: string): boolean {
  const webApp = getWebApp();
  try {
    return Boolean(webApp?.isVersionAtLeast?.(version));
  } catch {
    return false;
  }
}

/**
 * Light or dark, following the customer's Telegram. The palette itself is
 * RESTOR's (styles.css); Telegram only decides which of its two variants.
 */
export function colorScheme(): 'light' | 'dark' {
  return getWebApp()?.colorScheme === 'dark' ? 'dark' : 'light';
}

/** Boots the bridge before React paints, so the first frame is already right. */
export function initTelegram(): void {
  const webApp = getWebApp();
  document.documentElement.dataset.theme = colorScheme();
  if (!webApp) return;

  webApp.ready();
  webApp.expand();

  // A vertical swipe inside a menu, a bottom sheet or a map would otherwise
  // minimise the whole app halfway through a gesture.
  if (supports('7.7')) webApp.disableVerticalSwipes?.();

  webApp.onEvent?.('themeChanged', () => {
    document.documentElement.dataset.theme = colorScheme();
    paintChrome();
  });

  paintChrome();
}

/** Matches Telegram's own header and background to the app's surface. */
export function paintChrome(): void {
  const webApp = getWebApp();
  if (!webApp || !supports('6.1')) return;
  const styles = getComputedStyle(document.documentElement);
  const surface = styles.getPropertyValue('--surface').trim() || '#ffffff';
  const background = styles.getPropertyValue('--bg').trim() || '#ffffff';
  try {
    webApp.setHeaderColor?.(surface);
    webApp.setBackgroundColor?.(background);
    if (supports('7.10')) webApp.setBottomBarColor?.(background);
  } catch {
    // Cosmetic; an older client rejecting a colour is not worth a crash.
  }
}

/** Short haptic tap — used on add-to-cart, where it reads as confirmation. */
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  getWebApp()?.HapticFeedback?.impactOccurred(style);
}

export function hapticResult(type: 'error' | 'success' | 'warning'): void {
  getWebApp()?.HapticFeedback?.notificationOccurred(type);
}

/**
 * Telegram's native back button, driven by the app's navigator.
 *
 * On Android it is also what the system back gesture presses, so as long as
 * it is visible the gesture walks back through the app instead of closing it.
 */
export function setBackButton(visible: boolean, handler: () => void): () => void {
  const button = getWebApp()?.BackButton;
  if (!button || !supports('6.1')) return () => undefined;

  button.onClick(handler);
  if (visible) button.show();
  else button.hide();

  return () => button.offClick(handler);
}

/**
 * Asks Telegram to confirm before the sheet is swiped away — on while a
 * checkout is in flight, so a half-placed order is not abandoned by accident.
 */
export function setClosingConfirmation(enabled: boolean): void {
  const webApp = getWebApp();
  if (!webApp || !supports('6.2')) return;
  if (enabled) webApp.enableClosingConfirmation?.();
  else webApp.disableClosingConfirmation?.();
}

/**
 * Opens an external page (a payment form) on top of the app. Inside Telegram
 * it is the in-app browser, so the customer returns to the Mini App
 * unchanged when they close it.
 */
export function openExternal(url: string): void {
  const webApp = getWebApp();
  if (webApp?.openLink) {
    webApp.openLink(url, { try_instant_view: false });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** Opens a t.me link (the bot chat) inside Telegram itself. */
export function openTelegram(url: string): void {
  const webApp = getWebApp();
  if (webApp?.openTelegramLink && supports('6.1')) webApp.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

/** Runs `handler` when the app comes back to the foreground. */
export function onActivated(handler: () => void): () => void {
  const webApp = getWebApp();
  const onVisible = () => {
    if (document.visibilityState === 'visible') handler();
  };
  document.addEventListener('visibilitychange', onVisible);
  webApp?.onEvent?.('activated', handler);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    webApp?.offEvent?.('activated', handler);
  };
}

/** Namespaces local data per Telegram user, for a device several people share. */
export function deviceUserKey(): string {
  const id = getWebApp()?.initDataUnsafe.user?.id;
  return id ? String(id) : 'anon';
}
