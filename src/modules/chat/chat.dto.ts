import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsChatMessageText,
  MAX_MESSAGE_CODE_POINTS,
} from './chat-message-text.js';

export class CreateConversationDto {
  @ApiProperty() @IsUUID() listingId!: string;
}
export class SendMessageDto {
  @ApiProperty() @IsUUID() clientMessageId!: string;
  @ApiProperty({
    minLength: 1,
    maxLength: MAX_MESSAGE_CODE_POINTS,
    description:
      'Exact plain text, 1–2000 Unicode code points; no trimming, normalization or truncation. Newlines and emoji are supported.',
  })
  @IsString()
  @IsChatMessageText()
  content!: string;
}
export class ConversationCommandDto {
  @ApiProperty() @IsUUID() conversationId!: string;
}
export class SocketMessageDto extends SendMessageDto {
  @ApiProperty() @IsUUID() conversationId!: string;
}
export class ReceiptDto {
  @ApiProperty() @IsUUID() messageId!: string;
}
export class SocketReceiptDto extends ReceiptDto {
  @ApiProperty() @IsUUID() conversationId!: string;
}
export class ChatPageDto {
  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}
export class MessagePageDto extends ChatPageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  before?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^(0|[1-9]\d{0,18})$/)
  after?: string;
}
export class InboxPageDto extends ChatPageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
