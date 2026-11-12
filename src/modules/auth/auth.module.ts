import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { UsersModule } from '../users/users.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthSessionService } from './auth-session.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { AccountTypeGuard } from './guards/account-type.guard.js';
import { AuthRequestGuard } from './guards/auth-request.guard.js';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { RefreshCredentialCodec } from './refresh-credential.codec.js';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSessionService,
    AccessTokenService,
    AccessTokenGuard,
    AccountTypeGuard,
    AuthRequestGuard,
    RefreshCookieService,
    RefreshCredentialCodec,
  ],
  exports: [AccessTokenGuard, AccountTypeGuard, AccessTokenService],
})
export class AuthModule {}
