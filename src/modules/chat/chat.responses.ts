import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';

const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const sequence: SchemaObject = {
  type: 'string',
  pattern: '^[0-9]+$',
  example: '1',
};
const date: SchemaObject = { type: 'string', format: 'date-time' };
function object(properties: Record<string, SchemaObject>): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
export const messageSchema = object({
  id: uuid,
  conversationId: uuid,
  senderId: uuid,
  clientMessageId: uuid,
  sequence,
  content: {
    type: 'string',
    minLength: 1,
    maxLength: 2000,
    description:
      'Unmodified Unicode plain text; length counts code points, not UTF-16 code units or grapheme clusters.',
  },
  status: { type: 'string', enum: ['SENT', 'DELIVERED', 'READ'] },
  sentAt: date,
});
const participantSchema = object({
  userId: uuid,
  lastDeliveredSequence: sequence,
  lastReadSequence: sequence,
});
export const conversationSchema = object({
  id: uuid,
  buyerId: uuid,
  sellerUserId: uuid,
  listingId: uuid,
  storeId: { ...uuid, nullable: true },
  contextSnapshot: object({
    listingId: uuid,
    description: { type: 'string', nullable: true },
    price: { type: 'string' },
    condition: { type: 'string' },
    productName: { type: 'string', nullable: true },
    sellerUserId: uuid,
    sellerUsername: { type: 'string' },
    storeId: { ...uuid, nullable: true },
    storeName: { type: 'string', nullable: true },
    storeAvatarUrl: { type: 'string', nullable: true },
  }),
  lastSequence: sequence,
  createdAt: date,
  updatedAt: date,
  lastMessage: { ...messageSchema, nullable: true },
  participants: {
    type: 'array',
    minItems: 2,
    maxItems: 2,
    items: participantSchema,
  },
});
export const receiptSchema = object({
  conversationId: uuid,
  userId: uuid,
  lastDeliveredSequence: sequence,
  lastReadSequence: sequence,
});
export const createSchema = object({
  conversation: conversationSchema,
  created: { type: 'boolean' },
});
export const sendSchema = object({
  message: messageSchema,
  duplicate: { type: 'boolean' },
});
export const messagePageSchema = object({
  items: { type: 'array', items: messageSchema },
  hasMore: { type: 'boolean' },
  nextCursor: { ...sequence, nullable: true },
});
export const inboxSchema = object({
  items: {
    type: 'array',
    items: {
      ...conversationSchema,
      properties: {
        ...conversationSchema.properties,
        unreadCount: { type: 'integer', minimum: 0 },
      },
      required: [...conversationSchema.required!, 'unreadCount'],
    },
  },
  nextCursor: { type: 'string', nullable: true },
});
export const unreadSchema = object({
  unreadMessages: { type: 'integer', minimum: 0 },
  unreadConversations: { type: 'integer', minimum: 0 },
});

export function ChatResponse(data: SchemaObject, created = false) {
  const schema = object({ success: { type: 'boolean', enum: [true] }, data });
  const errors = [401, 403, 404, 409, 422, 429].map((status) =>
    ApiResponse({
      status,
      description: 'Standard API error envelope; see docs/phase7a-chat.md',
    }),
  );
  return applyDecorators(
    ApiResponse({ status: 200, schema }),
    ...(created ? [ApiResponse({ status: 201, schema })] : []),
    ...errors,
  );
}
