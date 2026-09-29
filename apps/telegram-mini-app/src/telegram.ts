/**
 * Telegram WebApp bridge (TZ §48).
 *
 * The only thing that matters for security here is `initData`: it is forwarded
 * to the backend VERBATIM and verified there against the bot token. Nothing in
 * `initDataUnsafe` is ever trusted for identity — as its name says — and is
 * used only to theme the UI before the server has answered.
 */

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name?: string; last_name?: string; username?: string };
    start_param?: string;
  };
  themeParams: TelegramThemeParams;
  colorScheme: 'light' | 'dark';
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  close: () => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  };
  MainButton: {
    text: string;
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    setText: (text: string) => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    enable: () => void;
    disable: () => void;
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
  const webApp = getWebApp();
  return Boolean(webApp?.initData);
}

/**
 * Applies Telegram's theme to our CSS variables so the Mini App matches the
 * user's Telegram appearance instead of fighting it.
 */
export function applyTelegramTheme(): void {
  const webApp = getWebApp();
  if (!webApp) return;

  const root = document.documentElement;
  const theme = webApp.themeParams;

  const map: Array<[string, string | undefined]> = [
    ['--bg', theme.bg_color],
    ['--surface', theme.bg_color],
    ['--surface-alt', theme.secondary_bg_color],
    ['--text', theme.text_color],
    ['--text-muted', theme.hint_color],
    ['--primary', theme.button_color],
  ];

  for (const [variable, value] of map) {
    if (value) root.style.setProperty(variable, value);
  }
}

/** Boots the bridge: tells Telegram we are ready and expands to full height. */
export function initTelegram(): void {
  const webApp = getWebApp();
  if (!webApp) return;

  webApp.ready();
  webApp.expand();
  applyTelegramTheme();
}

/** Short haptic tap — used on add-to-cart, where it reads as confirmation. */
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  getWebApp()?.HapticFeedback?.impactOccurred(style);
}

/**
 * Drives Telegram's native bottom button.
 *
 * Using it instead of an in-page button is what makes a Mini App feel native:
 * it sits outside the scroll area and matches every other Telegram app.
 */
export function useMainButton(
  text: string,
  onClick: () => void,
  options: { visible: boolean; enabled?: boolean; loading?: boolean } = { visible: true },
): void {
  const webApp = getWebApp();
  if (!webApp) return;

  const button = webApp.MainButton;

  if (!options.visible) {
    button.hide();
    return;
  }

  button.setText(text);
  if (options.enabled === false) button.disable();
  else button.enable();

  if (options.loading) button.showProgress(true);
  else button.hideProgress();

  button.show();

  // The caller is responsible for removing the handler; see App.tsx.
  button.onClick(onClick);
}
