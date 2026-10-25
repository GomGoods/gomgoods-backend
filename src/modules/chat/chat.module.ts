import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { ChatAuthService } from './chat-auth.service.js';
import { ChatRateLimit } from './chat-rate-limit.js';
import { ChatController } from './chat.controller.js';
import { ChatEvents } from './chat.events.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [ChatController],
  providers: [
    ChatAuthService,
    ChatRateLimit,
    ChatEvents,
    ChatGateway,
    ChatService,
  ],
})
export class ChatModule {}
