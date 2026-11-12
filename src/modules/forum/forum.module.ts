import { Module } from '@nestjs/common';
import { ForumController } from './forum.controller.js';
import { ForumRateLimit } from './forum-rate-limit.js';
import { ForumService } from './forum.service.js';

@Module({ controllers: [ForumController], providers: [ForumService, ForumRateLimit] })
export class ForumModule {}
