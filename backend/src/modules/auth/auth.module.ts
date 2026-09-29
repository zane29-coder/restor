import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TelegramInitDataService } from './telegram-init-data.service';
import { TokenService } from './token.service';

/**
 * `JwtModule` is registered without a secret on purpose: access and refresh
 * tokens are signed with DIFFERENT secrets, so each call passes its own. A
 * module-level default would make it easy to sign a refresh token with the
 * access secret by omission.
 *
 * `global: true` because `JwtAuthGuard` is registered as an APP_GUARD, which
 * Nest resolves in the root module's context.
 */
@Module({
  imports: [JwtModule.register({ global: true }), AuditModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, TelegramInitDataService],
  exports: [AuthService, PasswordService, TokenService, TelegramInitDataService],
})
export class AuthModule {}
