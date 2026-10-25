import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertAccountActive } from '../auth/account-access.policy.js';
import { publicListingWhere } from '../listings/public-listing-query.js';
import type {
  InboxPageDto,
  MessagePageDto,
  SendMessageDto,
} from './chat.dto.js';
import { ChatEvents } from './chat.events.js';
import { ChatRateLimit } from './chat-rate-limit.js';
import { isChatMessageText } from './chat-message-text.js';

const messageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  clientMessageId: true,
  sequence: true,
  content: true,
  status: true,
  sentAt: true,
} satisfies Prisma.MessageSelect;
const conversationSelect = {
  id: true,
  buyerId: true,
  sellerUserId: true,
  listingId: true,
  storeId: true,
  contextSnapshot: true,
  lastSequence: true,
  createdAt: true,
  updatedAt: true,
  messages: { orderBy: { sequence: 'desc' }, take: 1, select: messageSelect },
  participants: {
    orderBy: { userId: 'asc' },
    select: {
      userId: true,
      lastDeliveredSequence: true,
      lastReadSequence: true,
    },
  },
} satisfies Prisma.ConversationSelect;
type ChatDatabase = Prisma.TransactionClient;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: ChatRateLimit,
    private readonly events: ChatEvents,
  ) {}

  private async active(tx: ChatDatabase, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user) throw this.notFound();
    assertAccountActive(user.status);
  }

  async detail(userId: string, id: string, tx: ChatDatabase = this.prisma) {
    await this.active(tx, userId);
    const conversation = await tx.conversation.findFirst({
      where: { id, participants: { some: { userId } } },
      select: conversationSelect,
    });
    if (!conversation) throw this.notFound();
    return this.conversationResponse(conversation);
  }

  async create(userId: string, listingId: string) {
    this.limits.consume(userId, 'conversation');
    const existing = await this.prisma.conversation.findUnique({
      where: { buyerId_listingId: { buyerId: userId, listingId } },
      select: { id: true },
    });
    if (existing)
      return {
        conversation: await this.detail(userId, existing.id),
        created: false,
      };
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await this.active(tx, userId);
        const listing = await tx.listing.findFirst({
          where: publicListingWhere({ id: listingId }),
          select: {
            id: true,
            description: true,
            price: true,
            condition: true,
            sellerUserId: true,
            sellerUser: { select: { id: true, username: true, status: true } },
            product: {
              select: {
                name: true,
                store: {
                  select: {
                    id: true,
                    userId: true,
                    name: true,
                    avatarUrl: true,
                    user: { select: { username: true, status: true } },
                  },
                },
              },
            },
          },
        });
        if (!listing) throw this.notFound();
        const store = listing.product?.store;
        const sellerId = listing.sellerUserId ?? store?.userId;
        if (!sellerId || sellerId === userId)
          throw new ApiException(
            'RESOURCE_CONFLICT',
            'Cannot create a chat with yourself',
            HttpStatus.CONFLICT,
          );
        await this.active(tx, sellerId);
        const conversation = await tx.conversation.create({
          data: {
            buyerId: userId,
            sellerUserId: sellerId,
            listingId: listing.id,
            storeId: store?.id,
            contextSnapshot: {
              listingId: listing.id,
              description: listing.description,
              price: listing.price.toFixed(2),
              condition: listing.condition,
              productName: listing.product?.name ?? null,
              sellerUserId: sellerId,
              sellerUsername:
                listing.sellerUser?.username ?? store!.user.username,
              storeId: store?.id ?? null,
              storeName: store?.name ?? null,
              storeAvatarUrl: store?.avatarUrl ?? null,
            },
            participants: { create: [{ userId }, { userId: sellerId }] },
          },
          select: { id: true },
        });
        return conversation.id;
      });
      return { conversation: await this.detail(userId, id), created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.conversation.findUnique({
          where: { buyerId_listingId: { buyerId: userId, listingId } },
          select: { id: true },
        });
        if (winner)
          return {
            conversation: await this.detail(userId, winner.id),
            created: false,
          };
      }
      throw error;
    }
  }

  async inbox(userId: string, query: InboxPageDto) {
    // Keep preview, receipt watermark and unread count on one database snapshot.
    return this.prisma.$transaction(
      async (tx) => {
        await this.active(tx, userId);
        let cursor: { id: string; updatedAt: Date } | undefined;
        if (query.cursor) {
          try {
            const parsed = JSON.parse(
              Buffer.from(query.cursor, 'base64url').toString(),
            );
            const row = await tx.conversation.findFirst({
              where: { id: parsed.id, participants: { some: { userId } } },
              select: { id: true },
            });
            if (!row || !Number.isFinite(Date.parse(parsed.updatedAt)))
              throw new Error();
            cursor = { id: row.id, updatedAt: new Date(parsed.updatedAt) };
          } catch {
            throw this.invalidCursor();
          }
        }
        const rows = await tx.conversation.findMany({
          where: {
            participants: { some: { userId } },
            ...(cursor
              ? {
                  OR: [
                    { updatedAt: { lt: cursor.updatedAt } },
                    { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
          select: conversationSelect,
        });
        const hasMore = rows.length > query.limit;
        const page = rows.slice(0, query.limit);
        const counts = page.length
          ? await tx.message.groupBy({
              by: ['conversationId'],
              where: {
                senderId: { not: userId },
                OR: page.map((row) => ({
                  conversationId: row.id,
                  sequence: {
                    gt: row.participants.find((p) => p.userId === userId)!
                      .lastReadSequence,
                  },
                })),
              },
              _count: true,
            })
          : [];
        const items = page.map((row) => ({
          ...this.conversationResponse(row),
          unreadCount:
            counts.find((count) => count.conversationId === row.id)?._count ??
            0,
        }));
        const last = rows[Math.min(rows.length, query.limit) - 1];
        return {
          items,
          nextCursor:
            hasMore && last
              ? Buffer.from(
                  JSON.stringify({
                    id: last.id,
                    updatedAt: last.updatedAt.toISOString(),
                  }),
                ).toString('base64url')
              : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async messages(userId: string, id: string, query: MessagePageDto) {
    const conversation = await this.detail(userId, id);
    if (query.before && query.after !== undefined) throw this.invalidCursor();
    const cursor = query.before ?? query.after;
    if (cursor && BigInt(cursor) > BigInt(conversation.lastSequence))
      throw this.invalidCursor();
    const ascending = query.after !== undefined;
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        ...(cursor
          ? {
              sequence: ascending
                ? { gt: BigInt(cursor) }
                : { lt: BigInt(cursor) },
            }
          : {}),
      },
      orderBy: { sequence: ascending ? 'asc' : 'desc' },
      take: query.limit + 1,
      select: messageSelect,
    });
    const items = rows
      .slice(0, query.limit)
      .map((row) => this.messageResponse(row));
    return {
      items,
      hasMore: rows.length > query.limit,
      nextCursor: rows.length > query.limit ? items.at(-1)!.sequence : null,
    };
  }

  async unread(userId: string) {
    await this.active(this.prisma, userId);
    const counts = await this.prisma.$queryRaw<
      { messages: bigint; conversations: bigint }[]
    >`
      SELECT count(*) AS messages, count(DISTINCT m.conversation_id) AS conversations
      FROM "MESSAGE" m JOIN "CONVERSATION_PARTICIPANT" p ON p.conversation_id=m.conversation_id
      WHERE p.user_id=${userId}::uuid AND m.sender_id<>p.user_id AND m.sequence>p.last_read_sequence`;
    return {
      unreadMessages: Number(counts[0].messages),
      unreadConversations: Number(counts[0].conversations),
    };
  }

  async send(userId: string, id: string, input: SendMessageDto) {
    if (!isChatMessageText(input.content)) {
      throw new ApiException(
        'VALIDATION_FAILED',
        'Invalid message text: expected 1–2000 Unicode code points',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // Budget includes duplicate attempts, so retry floods cannot bypass throttling.
    this.limits.consume(userId, 'message');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, userId, id);
      const conversation = await tx.conversation.findUniqueOrThrow({
        where: { id },
        select: conversationSelect,
      });
      await this.canSend(tx, conversation);
      const existing = await tx.message.findUnique({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId: id,
            senderId: userId,
            clientMessageId: input.clientMessageId,
          },
        },
        select: messageSelect,
      });
      if (existing) {
        if (existing.content !== input.content)
          throw new ApiException(
            'RESOURCE_CONFLICT',
            'Message identity was reused with different content',
            HttpStatus.CONFLICT,
          );
        return { message: this.messageResponse(existing), duplicate: true };
      }
      const updated = await tx.conversation.update({
        where: { id },
        data: { lastSequence: { increment: 1 } },
        select: { lastSequence: true },
      });
      const message = await tx.message.create({
        data: {
          conversationId: id,
          senderId: userId,
          clientMessageId: input.clientMessageId,
          content: input.content,
          sequence: updated.lastSequence,
        },
        select: messageSelect,
      });
      return { message: this.messageResponse(message), duplicate: false };
    });
    if (!result.duplicate)
      this.events.publish(
        result.message.conversationId,
        'message.created',
        result.message,
      );
    return result;
  }

  async receipt(
    userId: string,
    id: string,
    messageId: string,
    kind: 'delivery' | 'read',
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, userId, id);
      const message = await tx.message.findFirst({
        where: { id: messageId, conversationId: id },
        select: { conversationId: true, senderId: true, sequence: true },
      });
      if (!message) throw this.notFound();
      if (message.senderId === userId)
        throw new ApiException(
          'FORBIDDEN',
          'Only the recipient can acknowledge a message',
          HttpStatus.FORBIDDEN,
        );
      const participant = await tx.conversationParticipant.findUniqueOrThrow({
        where: { conversationId_userId: { conversationId: id, userId } },
      });
      const delivered =
        message.sequence > participant.lastDeliveredSequence
          ? message.sequence
          : participant.lastDeliveredSequence;
      const read =
        kind === 'read' && message.sequence > participant.lastReadSequence
          ? message.sequence
          : participant.lastReadSequence;
      await tx.conversationParticipant.update({
        where: { id: participant.id },
        data: { lastDeliveredSequence: delivered, lastReadSequence: read },
      });
      await tx.message.updateMany({
        where: {
          conversationId: id,
          senderId: { not: userId },
          sequence: { lte: delivered },
          status: 'SENT',
        },
        data: { status: 'DELIVERED' },
      });
      await tx.message.updateMany({
        where: {
          conversationId: id,
          senderId: { not: userId },
          sequence: { lte: read },
          status: { not: 'READ' },
        },
        data: { status: 'READ' },
      });
      return {
        conversationId: message.conversationId,
        userId,
        lastDeliveredSequence: delivered.toString(),
        lastReadSequence: read.toString(),
      };
    });
    this.events.publish(result.conversationId, 'receipt.updated', result);
    return result;
  }

  private async lock(tx: ChatDatabase, userId: string, id: string) {
    await this.detail(userId, id, tx);
    await tx.$queryRaw`SELECT conversation_id FROM "CONVERSATION" WHERE conversation_id=${id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id=${userId}::uuid FOR SHARE`;
    await this.active(tx, userId);
  }

  private async canSend(
    tx: ChatDatabase,
    conversation: Prisma.ConversationGetPayload<{
      select: typeof conversationSelect;
    }>,
  ) {
    await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id IN (${conversation.buyerId}::uuid, ${conversation.sellerUserId}::uuid) ORDER BY user_id FOR SHARE`;
    await this.active(tx, conversation.buyerId);
    await this.active(tx, conversation.sellerUserId);
    if (conversation.storeId) {
      await tx.$queryRaw`SELECT store_id FROM "STORE" WHERE store_id=${conversation.storeId}::uuid FOR SHARE`;
      const store = await tx.store.findUnique({
        where: { id: conversation.storeId },
        select: { status: true, userId: true },
      });
      if (
        !store ||
        store.status !== 'ACTIVE' ||
        store.userId !== conversation.sellerUserId
      )
        throw new ApiException(
          'STORE_NOT_ACTIVE',
          'Store chat is read-only',
          HttpStatus.FORBIDDEN,
        );
    }
  }

  private conversationResponse(
    row: Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>,
  ) {
    const { messages, ...conversation } = row;
    return {
      ...conversation,
      lastMessage: messages[0] ? this.messageResponse(messages[0]) : null,
      lastSequence: row.lastSequence.toString(),
      participants: row.participants.map((p) => ({
        userId: p.userId,
        lastDeliveredSequence: p.lastDeliveredSequence.toString(),
        lastReadSequence: p.lastReadSequence.toString(),
      })),
    };
  }
  private messageResponse(
    row: Prisma.MessageGetPayload<{ select: typeof messageSelect }>,
  ) {
    return { ...row, sequence: row.sequence.toString() };
  }
  private notFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'Chat resource not found',
      HttpStatus.NOT_FOUND,
    );
  }
  private invalidCursor() {
    return new ApiException(
      'VALIDATION_FAILED',
      'Invalid chat cursor',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
