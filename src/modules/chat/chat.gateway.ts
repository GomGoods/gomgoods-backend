import { HttpException, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Namespace, Socket } from 'socket.io';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { ChatAuthService } from './chat-auth.service.js';
import { ChatRateLimit } from './chat-rate-limit.js';
import {
  ConversationCommandDto,
  SocketMessageDto,
  SocketReceiptDto,
} from './chat.dto.js';
import { ChatEvents } from './chat.events.js';
import { ChatService } from './chat.service.js';

interface Connection {
  socket: Socket;
  token: string;
  userId: string;
  subscriptions: Set<string>;
}

@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayInit, OnModuleDestroy {
  private readonly connections = new Map<string, Connection>();
  private timer?: ReturnType<typeof setInterval>;
  private readonly listener = (change: {
    conversationId: string;
    event: string;
    data: unknown;
  }) => {
    void this.deliver(change);
  };

  constructor(
    private readonly auth: ChatAuthService,
    private readonly chat: ChatService,
    private readonly limits: ChatRateLimit,
    private readonly events: ChatEvents,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Namespace) {
    server.use(async (socket, next) => {
      try {
        if (
          !this.config
            .getOrThrow<string[]>('CORS_ORIGINS')
            .includes(socket.handshake.headers.origin ?? '')
        )
          throw new ApiException('FORBIDDEN', 'Chat origin rejected', 403);
        const token: unknown = socket.handshake.auth?.accessToken;
        const identity = await this.auth.authenticate(token);
        this.limits.consume(identity.userId, 'connect');
        if (
          [...this.connections.values()].filter(
            (c) => c.userId === identity.userId,
          ).length >= 5
        )
          throw new ApiException(
            'RATE_LIMIT_EXCEEDED',
            'Too many chat connections',
            429,
          );
        this.connections.set(socket.id, {
          socket,
          token: token as string,
          userId: identity.userId,
          subscriptions: new Set(),
        });
        const cleanup = () => this.connections.delete(socket.id);
        socket.once('disconnect', cleanup);
        socket.conn.once('close', cleanup);
        next();
      } catch (error) {
        const failure = this.failure(error);
        const rejected = new Error('Chat connection rejected');
        Object.assign(rejected, { data: failure });
        next(rejected);
      }
    });
    this.events.on('change', this.listener);
    this.timer = setInterval(() => {
      void this.revalidate();
    }, 1000);
    this.timer.unref();
  }

  @SubscribeMessage('conversation.subscribe')
  subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(
      socket,
      body,
      ConversationCommandDto,
      async (connection, input) => {
        const id = input.conversationId.toLowerCase();
        await this.chat.detail(connection.userId, id);
        if (
          !connection.subscriptions.has(id) &&
          connection.subscriptions.size >= 50
        )
          throw new ApiException(
            'RATE_LIMIT_EXCEEDED',
            'Too many subscriptions',
            429,
          );
        connection.subscriptions.add(id);
        return { conversationId: id };
      },
    );
  }

  @SubscribeMessage('conversation.unsubscribe')
  unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(
      socket,
      body,
      ConversationCommandDto,
      async (connection, input) => {
        await this.chat.detail(connection.userId, input.conversationId);
        connection.subscriptions.delete(input.conversationId.toLowerCase());
        return { conversationId: input.conversationId.toLowerCase() };
      },
    );
  }

  @SubscribeMessage('message.send')
  send(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(socket, body, SocketMessageDto, (connection, input) =>
      this.chat.send(connection.userId, input.conversationId, input),
    );
  }

  @SubscribeMessage('message.delivered')
  delivered(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(socket, body, SocketReceiptDto, (connection, input) =>
      this.chat.receipt(
        connection.userId,
        input.conversationId,
        input.messageId,
        'delivery',
      ),
    );
  }

  @SubscribeMessage('message.read')
  read(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(socket, body, SocketReceiptDto, (connection, input) =>
      this.chat.receipt(
        connection.userId,
        input.conversationId,
        input.messageId,
        'read',
      ),
    );
  }

  private async command<T extends object>(
    socket: Socket,
    body: unknown,
    type: new () => T,
    run: (connection: Connection, input: T) => Promise<unknown>,
  ) {
    try {
      const connection = this.connections.get(socket.id);
      if (!connection)
        throw new ApiException(
          'INVALID_ACCESS_TOKEN',
          'Invalid connection',
          401,
        );
      // userId is server-owned from the authenticated handshake. Reject floods
      // before JWT/session DB work; every admitted command still reauthenticates.
      this.limits.consume(connection.userId, 'event');
      try {
        await this.auth.authenticate(connection.token);
      } catch (error) {
        // Let the command acknowledgement flush before closing the transport.
        setImmediate(() => socket.disconnect(true));
        throw error;
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new ApiException(
          'VALIDATION_FAILED',
          'Invalid chat payload',
          422,
        );
      const input = plainToInstance(type, body);
      if (
        (await validate(input, { whitelist: true, forbidNonWhitelisted: true }))
          .length
      )
        throw new ApiException(
          'VALIDATION_FAILED',
          'Invalid chat payload',
          422,
        );
      return { success: true, data: await run(connection, input) };
    } catch (error) {
      return this.failure(error);
    }
  }

  private async deliver(change: {
    conversationId: string;
    event: string;
    data: unknown;
  }) {
    // Unicast after fresh per-socket checks. No room broadcast can bypass session
    // revocation, membership or account status. Payloads are explicit service DTOs.
    for (const connection of this.connections.values()) {
      try {
        await this.chat.detail(connection.userId, change.conversationId);
      } catch {
        continue;
      }
      try {
        await this.auth.authenticate(connection.token);
      } catch {
        connection.socket.disconnect(true);
        continue;
      }
      if (!connection.socket.connected) continue;
      if (connection.subscriptions.has(change.conversationId))
        connection.socket.emit(change.event, change.data);
      connection.socket.emit('conversation.updated', {
        conversationId: change.conversationId,
      });
    }
  }

  private async revalidate() {
    for (const connection of this.connections.values()) {
      try {
        await this.auth.authenticate(connection.token);
      } catch {
        connection.socket.emit('auth.expired', { reconnect: true });
        connection.socket.disconnect(true);
      }
    }
  }

  private failure(error: unknown) {
    return {
      success: false,
      error:
        error instanceof ApiException
          ? { code: error.code, message: error.message, details: error.details }
          : {
              code:
                error instanceof HttpException && error.getStatus() === 422
                  ? 'VALIDATION_FAILED'
                  : 'REQUEST_FAILED',
              message: 'Chat request failed',
              details: [],
            },
    };
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.events.off('change', this.listener);
    for (const connection of this.connections.values())
      connection.socket.disconnect(true);
    this.connections.clear();
  }
}
