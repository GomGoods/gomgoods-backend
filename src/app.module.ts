import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor.js';
import { validateEnvironment } from './config/environment.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AccessTokenGuard } from './modules/auth/guards/access-token.guard.js';
import { AccountTypeGuard } from './modules/auth/guards/account-type.guard.js';
import { HealthModule } from './modules/health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath:
        process.env.NODE_ENV === 'test' ? ['.env.test', '.env'] : ['.env'],
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot({
      skipIf: () => process.env.NODE_ENV === 'test',
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AccessTokenGuard },
    { provide: APP_GUARD, useExisting: AccountTypeGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
