import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { UsersModule } from '../users/users.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { AccountTypeGuard } from './guards/account-type.guard.js';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenService,
    AccessTokenGuard,
    AccountTypeGuard,
  ],
  exports: [AccessTokenGuard, AccountTypeGuard],
})
export class AuthModule {}
