import type {
  AuthSession,
  AuthenticatedUser,
  ChangePasswordRequest,
  LoginRequest,
  TelegramAuthRequest,
  TokenPair,
} from '@restor/shared-types';
import type { HttpClient } from '../http-client';

export class AuthResource {
  constructor(private readonly http: HttpClient) {}

  /** Staff sign-in. Stores the returned pair so later calls are authenticated. */
  async login(payload: LoginRequest): Promise<AuthSession> {
    const session = await this.http.post<AuthSession>('auth/login', payload, {
      skipAuth: true,
    });
    await this.http.setTokens(session.tokens);
    return session;
  }

  /**
   * Telegram Mini App sign-in (TZ §48). `initData` is forwarded verbatim — the
   * backend verifies its signature before trusting any field.
   */
  async loginWithTelegram(payload: TelegramAuthRequest): Promise<AuthSession> {
    const session = await this.http.post<AuthSession>('auth/telegram', payload, {
      skipAuth: true,
    });
    await this.http.setTokens(session.tokens);
    return session;
  }

  me(): Promise<AuthenticatedUser> {
    return this.http.get<AuthenticatedUser>('auth/me');
  }

  /**
   * Explicit refresh. Normal calls refresh automatically inside
   * {@link HttpClient}; this exists for apps that warm the session on boot.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokens = await this.http.post<TokenPair>(
      'auth/refresh',
      { refreshToken },
      { skipAuth: true },
    );
    await this.http.setTokens(tokens);
    return tokens;
  }

  /** Revokes the refresh token server-side, then drops it locally. */
  async logout(): Promise<void> {
    try {
      await this.http.post<void>('auth/logout');
    } finally {
      // Clear locally even if the network call failed — the user asked to leave.
      await this.http.clearTokens();
    }
  }

  changePassword(payload: ChangePasswordRequest): Promise<void> {
    return this.http.post<void>('auth/change-password', payload);
  }
}
