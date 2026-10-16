import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor.js';
import { validateEnvironment } from './config/environment.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { AccessTokenGuard } from './modules/auth/guards/access-token.guard.js';
import { AccountTypeGuard } from './modules/auth/guards/account-type.guard.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { CheckoutModule } from './modules/checkout/checkout.module.js';
import { DiscoveryModule } from './modules/discovery/discovery.module.js';
import { FollowsModule } from './modules/follows/follows.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ListingsModule } from './modules/listings/listings.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { ShipmentsModule } from './modules/shipments/shipments.module.js';
import { StoresModule } from './modules/stores/stores.module.js';
import { UsersModule } from './modules/users/users.module.js';
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
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    UsersModule,
    CartModule,
    CheckoutModule,
    StoresModule,
    CategoriesModule,
    DiscoveryModule,
    FollowsModule,
    OrdersModule,
    ShipmentsModule,
    ProductsModule,
    ListingsModule,
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
