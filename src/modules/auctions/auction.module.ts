import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { ForumRequestGuard,ForumResponsePolicy } from '../forum/forum-http-policy.js';
import { AuctionController } from './auction.controller.js';
import { AuctionService } from './auction.service.js';
import { AuctionRateLimit } from './auction-rate-limit.js';
import { AuctionWorker } from './auction.worker.js';
import { AuctionGateway } from './auction.gateway.js';
@Module({imports:[AuthModule,OrdersModule],controllers:[AuctionController],providers:[AuctionService,AuctionRateLimit,AuctionWorker,AuctionGateway,ForumRequestGuard,ForumResponsePolicy]})
export class AuctionModule{}
