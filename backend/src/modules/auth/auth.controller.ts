import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthSession, AuthenticatedUser, TokenPair } from '@restor/shared-types';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  telegramAuthSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RefreshInput,
  type TelegramAuthInput,
} from '@restor/validation';
import type { Request } from 'express';
import { Ctx, CurrentUser, Public } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { RequestContext } from '../../common/context/request-context';
import { AuthService } from './auth.service';
import type { IssueContext } from './token.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Staff sign-in.
   *
   * Rate-limited harder than the global default: login is the one endpoint
   * where a brute-force attempt is both cheap and valuable (TZ §52).
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with phone/email and password' })
  login(
    @Body(zodBody(loginSchema)) body: LoginInput,
    @Req() req: Request,
  ): Promise<AuthSession> {
    return this.auth.login(body, issueContextFrom(req, body.deviceId));
  }

  /** Telegram Mini App sign-in — the signature is verified server-side (TZ §48). */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Telegram Mini App initData' })
  loginWithTelegram(
    @Body(zodBody(telegramAuthSchema)) body: TelegramAuthInput,
    @Req() req: Request,
  ): Promise<AuthSession> {
    return this.auth.loginWithTelegram(body, issueContextFrom(req));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  refresh(
    @Body(zodBody(refreshSchema)) body: RefreshInput,
    @Req() req: Request,
  ): Promise<TokenPair> {
    return this.auth.refresh(body.refreshToken, issueContextFrom(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentUser() userId: string,
    @Body() body: { refreshToken?: string },
  ): Promise<void> {
    await this.auth.logout(body?.refreshToken, userId);
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user with their flattened permissions' })
  me(@CurrentUser() userId: string): Promise<AuthenticatedUser> {
    return this.auth.me(userId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change your own password; ends every other session' })
  async changePassword(
    @CurrentUser() userId: string,
    @Body(zodBody(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(userId, body.currentPassword, body.newPassword);
  }

  /** Echoes the resolved context — invaluable when debugging permissions. */
  @Get('context')
  @ApiOperation({ summary: 'Debug: the request context derived from your token' })
  context(@Ctx() ctx: RequestContext): Omit<RequestContext, 'ip' | 'userAgent'> {
    const { ip: _ip, userAgent: _ua, ...rest } = ctx;
    return rest;
  }
}

function issueContextFrom(req: Request, deviceId?: string): IssueContext {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    deviceId,
  };
}
