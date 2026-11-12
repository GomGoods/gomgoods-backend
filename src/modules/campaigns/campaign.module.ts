import { Module } from '@nestjs/common';
import { CampaignController } from './campaign.controller.js';
import { CampaignService } from './campaign.service.js';
import { CampaignRateLimit } from './campaign-rate-limit.js';
import { ForumRequestGuard, ForumResponsePolicy } from '../forum/forum-http-policy.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({ imports: [AuthModule], controllers: [CampaignController], providers: [CampaignService, CampaignRateLimit, ForumRequestGuard, ForumResponsePolicy] })
export class CampaignModule {}
