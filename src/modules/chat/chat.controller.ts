import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import type { SafeUser } from '../users/user.select.js';
import {
  CreateConversationDto,
  InboxPageDto,
  MessagePageDto,
  ReceiptDto,
  SendMessageDto,
} from './chat.dto.js';
import { ChatService } from './chat.service.js';
import {
  ChatResponse,
  conversationSchema,
  createSchema,
  inboxSchema,
  messagePageSchema,
  receiptSchema,
  sendSchema,
  unreadSchema,
} from './chat.responses.js';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('conversations')
  @ChatResponse(createSchema, true)
  @ApiOperation({ summary: 'Create or reuse a buyer/listing conversation' })
  async create(
    @CurrentUser() user: SafeUser,
    @Body() input: CreateConversationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.chat.create(user.id, input.listingId);
    response.status(result.created ? 201 : 200);
    return result;
  }

  @Get('conversations')
  @ChatResponse(inboxSchema)
  inbox(@CurrentUser() user: SafeUser, @Query() query: InboxPageDto) {
    return this.chat.inbox(user.id, query);
  }

  @Get('unread-count')
  @ChatResponse(unreadSchema)
  unread(@CurrentUser() user: SafeUser) {
    return this.chat.unread(user.id);
  }

  @Get('conversations/:id')
  @ChatResponse(conversationSchema)
  detail(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) {
    return this.chat.detail(user.id, params.id);
  }

  @Get('conversations/:id/messages')
  @ChatResponse(messagePageSchema)
  messages(
    @CurrentUser() user: SafeUser,
    @Param() params: UuidParamDto,
    @Query() query: MessagePageDto,
  ) {
    return this.chat.messages(user.id, params.id, query);
  }

  @Post('conversations/:id/messages')
  @ChatResponse(sendSchema, true)
  async send(
    @CurrentUser() user: SafeUser,
    @Param() params: UuidParamDto,
    @Body() input: SendMessageDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.chat.send(user.id, params.id, input);
    response.status(result.duplicate ? 200 : 201);
    return result;
  }

  @Put('conversations/:id/delivery')
  @ChatResponse(receiptSchema)
  @HttpCode(200)
  delivery(
    @CurrentUser() user: SafeUser,
    @Param() params: UuidParamDto,
    @Body() input: ReceiptDto,
  ) {
    return this.chat.receipt(user.id, params.id, input.messageId, 'delivery');
  }

  @Put('conversations/:id/read')
  @ChatResponse(receiptSchema)
  @HttpCode(200)
  read(
    @CurrentUser() user: SafeUser,
    @Param() params: UuidParamDto,
    @Body() input: ReceiptDto,
  ) {
    return this.chat.receipt(user.id, params.id, input.messageId, 'read');
  }
}
