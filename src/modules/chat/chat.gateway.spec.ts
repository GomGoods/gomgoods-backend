import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Namespace, Socket } from 'socket.io';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../../common/exceptions/api.exception.js';
import type { ChatAuthService } from './chat-auth.service.js';
import { ChatRateLimit } from './chat-rate-limit.js';
import { ChatEvents } from './chat.events.js';
import { ChatGateway } from './chat.gateway.js';
import type { ChatService } from './chat.service.js';

describe('ChatGateway admission before database authentication', () => {
  let gateway: ChatGateway | undefined;
  afterEach(() => {
    gateway?.onModuleDestroy();
    vi.useRealTimers();
  });

  async function fixture() {
    vi.useFakeTimers();
    const auth = {
      authenticate: vi
        .fn()
        .mockResolvedValue({ userId: randomUUID(), sessionId: randomUUID() }),
    };
    const chat = { detail: vi.fn().mockResolvedValue({}), send: vi.fn() };
    const socket = {
      id: randomUUID(),
      handshake: {
        headers: { origin: 'http://chat.local' },
        auth: { accessToken: 'test-only' },
      },
      once: vi.fn(),
      conn: { once: vi.fn() },
      disconnect: vi.fn(),
    } as unknown as Socket;
    let middleware!: (socket: Socket, next: (error?: Error) => void) => void;
    const namespace = {
      use: (fn: typeof middleware) => {
        middleware = fn;
      },
    } as unknown as Namespace;
    gateway = new ChatGateway(
      auth as unknown as ChatAuthService,
      chat as unknown as ChatService,
      new ChatRateLimit(),
      new ChatEvents(),
      new ConfigService({ CORS_ORIGINS: ['http://chat.local'] }),
    );
    gateway.afterInit(namespace);
    await new Promise<void>((resolve, reject) =>
      middleware(socket, (error) => (error ? reject(error) : resolve())),
    );
    return { gateway, socket, auth, chat };
  }

  it('does not queue more JWT/session or membership queries once a socket user exhausts the command budget', async () => {
    const { gateway, socket, auth, chat } = await fixture();
    const body = { conversationId: randomUUID() };
    for (let i = 0; i < 120; i++)
      expect(await gateway.subscribe(socket, body)).toMatchObject({
        success: true,
      });
    expect(auth.authenticate).toHaveBeenCalledTimes(121); // handshake + admitted events
    expect(chat.detail).toHaveBeenCalledTimes(120);
    for (let i = 0; i < 20; i++)
      expect(await gateway.subscribe(socket, body)).toMatchObject({
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED' },
      });
    expect(auth.authenticate).toHaveBeenCalledTimes(121);
    expect(chat.detail).toHaveBeenCalledTimes(120);
  });

  it('reauthenticates an admitted event and blocks service execution after session revocation', async () => {
    const { gateway, socket, auth, chat } = await fixture();
    auth.authenticate.mockRejectedValueOnce(
      new ApiException(
        'INVALID_ACCESS_TOKEN',
        'The access token is invalid',
        401,
      ),
    );
    expect(
      await gateway.send(socket, {
        conversationId: randomUUID(),
        clientMessageId: randomUUID(),
        content: 'Xin chào',
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'INVALID_ACCESS_TOKEN' },
    });
    expect(chat.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
