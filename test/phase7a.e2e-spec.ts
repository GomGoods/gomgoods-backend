import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { AccessTokenService } from '../src/modules/auth/access-token.service.js';
import { ChatService } from '../src/modules/chat/chat.service.js';
import { ChatEvents } from '../src/modules/chat/chat.events.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './helpers/create-test-app.js';

describe('Phase 7A transactional chat and real Socket.IO (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let chat: ChatService;
  let url: string;
  let origin: string;
  const userIds: string[] = [];
  const listingIds: string[] = [];
  const storeIds: string[] = [];
  const categoryIds: string[] = [];
  const productIds: string[] = [];
  const sockets: Socket[] = [];
  let protectedBefore: unknown;

  async function protectedState() {
    const result = [];
    // Stable full-row snapshots, including demo payment/event/ledger and stock.
    for (const table of [
      'ORDER',
      'PAYMENT',
      'PAYMENT_EVENT',
      'TRANSACTION',
      'CATEGORY',
    ]) {
      result.push(
        await prisma.$queryRawUnsafe(
          `SELECT to_jsonb(t)::text AS data FROM "${table}" t ORDER BY to_jsonb(t)::text`,
        ),
      );
    }
    result.push(
      await prisma.listing.findMany({
        where: { id: { notIn: listingIds } },
        orderBy: { id: 'asc' },
      }),
    );
    return result;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const [encoding] = await prisma.$queryRaw<
      { server: string; client: string }[]
    >`
      SELECT current_setting('server_encoding') AS server, current_setting('client_encoding') AS client`;
    expect(encoding).toEqual({ server: 'UTF8', client: 'UTF8' });
    chat = app.get(ChatService);
    origin = app.get(ConfigService).getOrThrow<string[]>('CORS_ORIGINS')[0];
    protectedBefore = await protectedState();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const socket of sockets.splice(0)) socket.disconnect();
  });
  afterAll(async () => {
    if (!app) return;
    try {
      const scope = { buyerId: { in: userIds } };
      // Delete messages before membership due to the explicit sender membership FK.
      await prisma.message.deleteMany({ where: { conversation: scope } });
      await prisma.conversation.deleteMany({ where: scope });
      await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
      await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      expect(await protectedState()).toEqual(protectedBefore);
    } finally {
      await app.close();
    }
  });

  async function user(admin = false) {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({
      data: {
        id,
        email: `${id}@phase7a.e2e.gomgoods.local`,
        username: `c_${id.slice(0, 24)}`,
        passwordHash: 'unused-test-hash',
        accountType: admin ? 'ADMIN' : 'USER',
      },
    });
    const session = await prisma.authSession.create({
      data: { userId: id, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const { accessToken } = await app.get(AccessTokenService).sign({
      sub: id,
      sid: session.id,
      accountType: admin ? 'ADMIN' : 'USER',
    });
    return { id, token: accessToken, sessionId: session.id };
  }
  async function fixture(storeBacked = false) {
    const buyer = await user();
    const seller = await user();
    let productId: string | undefined;
    let storeId: string | undefined;
    if (storeBacked) {
      storeId = randomUUID();
      storeIds.push(storeId);
      const categoryId = randomUUID();
      categoryIds.push(categoryId);
      productId = randomUUID();
      productIds.push(productId);
      await prisma.category.create({
        data: { id: categoryId, name: `Chat ${categoryId}` },
      });
      await prisma.store.create({
        data: {
          id: storeId,
          userId: seller.id,
          name: 'Original Store',
          status: 'ACTIVE',
        },
      });
      await prisma.product.create({
        data: { id: productId, storeId, categoryId, name: 'Original Product' },
      });
    }
    const listingId = randomUUID();
    listingIds.push(listingId);
    await prisma.listing.create({
      data: {
        id: listingId,
        ...(productId ? { productId } : { sellerUserId: seller.id }),
        price: '125.00',
        quantity: 2,
        condition: 'NEW',
        status: 'ACTIVE',
        description: 'Original listing',
      },
    });
    const result = await chat.create(buyer.id, listingId);
    return {
      buyer,
      seller,
      listingId,
      storeId,
      productId,
      conversation: result.conversation,
    };
  }
  const api = () => request(app.getHttpServer());
  const path = (id: string) => `/api/chat/conversations/${id}`;
  const input = (content = 'Hello from chat') => ({
    clientMessageId: randomUUID(),
    content,
  });
  async function connect(token: string, extra: Record<string, unknown> = {}) {
    const socket = io(`${url}/chat`, {
      transports: ['websocket'],
      auth: { accessToken: token },
      extraHeaders: { Origin: origin },
      reconnection: false,
      forceNew: true,
      ...extra,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }
  function ack(socket: Socket, event: string, body: unknown): Promise<any> {
    return socket.timeout(2500).emitWithAck(event, body);
  }
  function once(socket: Socket, event: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off(event, listener);
        reject(new Error(`No ${event} received`));
      }, 2500);
      const listener = (body: unknown) => {
        clearTimeout(timeout);
        resolve(body);
      };
      socket.once(event, listener);
    });
  }

  it.each([
    'Xin chào! Sản phẩm còn hàng không? Cảm ơn bạn nhé! Đặng Thị Ánh 🌸',
    '👩🏽‍💻 👨‍👩‍👧‍👦 🇻🇳 ❤️ 😀',
    '  Dòng một\nDòng hai\r\n\tDòng ba — giữ nguyên khoảng trắng!  ',
    'Tiếng Việt ắ ộ Đ; Ελληνικά; 中文; 日本語; € © ™ <>&\u2028\u2029',
    'Cảm ơn bạn! Tiếng Việt: ắ ộ Đ'.normalize('NFD'),
    '<script>alert("không được thực thi 😀")</script>\n<b>Văn bản thuần</b>',
  ])(
    'round-trips exact Unicode text through REST, PostgreSQL, sockets and reconnect history: %s',
    async (content) => {
      const f = await fixture();
      const buyer = await connect(f.buyer.token);
      const seller = await connect(f.seller.token);
      await ack(buyer, 'conversation.subscribe', {
        conversationId: f.conversation.id,
      });
      await ack(seller, 'conversation.subscribe', {
        conversationId: f.conversation.id,
      });
      const delivered = once(seller, 'message.created');
      const payload = input(content);
      const response = await api()
        .post(`${path(f.conversation.id)}/messages`)
        .auth(f.buyer.token, { type: 'bearer' })
        .send(payload)
        .expect(201);
      expect(response.body.data.message.content).toBe(content);
      expect(await delivered).toEqual(response.body.data.message);
      const replay = await ack(buyer, 'message.send', {
        conversationId: f.conversation.id,
        ...payload,
      });
      expect(replay).toMatchObject({
        success: true,
        data: {
          duplicate: true,
          message: { id: response.body.data.message.id, content },
        },
      });
      const [row] = await prisma.$queryRaw<
        { content: string; bytes: string; length: number }[]
      >`
      SELECT content, encode(convert_to(content, 'UTF8'), 'hex') AS bytes, char_length(content)::int AS length
      FROM "MESSAGE" WHERE message_id=${response.body.data.message.id}::uuid`;
      expect(row).toEqual({
        content,
        bytes: Buffer.from(content, 'utf8').toString('hex'),
        length: Array.from(content).length,
      });
      const saved = await prisma.message.findUniqueOrThrow({
        where: { id: response.body.data.message.id },
      });
      expect(response.body.data.message.sentAt).toBe(
        saved.sentAt.toISOString(),
      );
      expect(response.body.data.message.sentAt).toMatch(/Z$/);
      const replyEvent = once(buyer, 'message.created');
      const reply = await ack(seller, 'message.send', {
        conversationId: f.conversation.id,
        ...input(content),
      });
      expect(reply).toMatchObject({
        success: true,
        data: { message: { content } },
      });
      expect(await replyEvent).toEqual(reply.data.message);
      seller.disconnect();
      const history = await api()
        .get(`${path(f.conversation.id)}/messages`)
        .query({ after: '0' })
        .auth(f.seller.token, { type: 'bearer' })
        .expect(200);
      expect(
        history.body.data.items.map(
          (message: { content: string }) => message.content,
        ),
      ).toEqual([content, content]);
    },
  );

  it.each([
    '😀'.repeat(2000),
    '❤️'.repeat(1000),
    'a\u0301'.repeat(1000),
    'đ'.repeat(1997) + '\n😀',
  ])(
    'enforces the same near/exact 2000-code-point limit in REST, WS and PostgreSQL',
    async (content) => {
      const f = await fixture();
      const socket = await connect(f.buyer.token);
      const length = Array.from(content).length;
      const accepted = await api()
        .post(`${path(f.conversation.id)}/messages`)
        .auth(f.buyer.token, { type: 'bearer' })
        .send(input(content))
        .expect(201);
      const ws = await ack(socket, 'message.send', {
        conversationId: f.conversation.id,
        ...input(content),
      });
      expect(ws).toMatchObject({
        success: true,
        data: { message: { content } },
      });
      const over = content + 'đ'.repeat(2001 - length);
      expect(Array.from(over)).toHaveLength(2001);
      const rejected = await api()
        .post(`${path(f.conversation.id)}/messages`)
        .auth(f.buyer.token, { type: 'bearer' })
        .send(input(over))
        .expect(422);
      expect(rejected.body.error.code).toBe('VALIDATION_FAILED');
      expect(
        await ack(socket, 'message.send', {
          conversationId: f.conversation.id,
          ...input(over),
        }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(
        (
          await prisma.message.findUniqueOrThrow({
            where: { id: accepted.body.data.message.id },
          })
        ).content,
      ).toBe(content);
      const [row] = await prisma.$queryRaw<
        { length: number }[]
      >`SELECT char_length(content)::int AS length FROM "MESSAGE" WHERE message_id=${ws.data.message.id}::uuid`;
      expect(row.length).toBe(length);
      expect(
        await prisma.message.count({
          where: { conversationId: f.conversation.id },
        }),
      ).toBe(2);
    },
  );

  it('keeps NFC/NFD identity exact and rejects invalid UTF-8 text without silently replacing it', async () => {
    const f = await fixture();
    const socket = await connect(f.buyer.token);
    const payload = input('Cảm ơn bạn!');
    await api()
      .post(`${path(f.conversation.id)}/messages`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send(payload)
      .expect(201);
    const changed = { ...payload, content: payload.content.normalize('NFD') };
    expect(changed.content).not.toBe(payload.content);
    await api()
      .post(`${path(f.conversation.id)}/messages`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send(changed)
      .expect(409);
    expect(
      await ack(socket, 'message.send', {
        conversationId: f.conversation.id,
        ...changed,
      }),
    ).toMatchObject({ success: false, error: { code: 'RESOURCE_CONFLICT' } });
    for (const content of ['Tin\u0000nhắn', '\ud800', '\udc00']) {
      await api()
        .post(`${path(f.conversation.id)}/messages`)
        .auth(f.buyer.token, { type: 'bearer' })
        .send(input(content))
        .expect(422);
      expect(
        await ack(socket, 'message.send', {
          conversationId: f.conversation.id,
          ...input(content),
        }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    }
    expect(
      await prisma.message.count({
        where: { conversationId: f.conversation.id },
      }),
    ).toBe(1);
    expect(
      (await chat.messages(f.buyer.id, f.conversation.id, { limit: 30 }))
        .items[0].content,
    ).toBe(payload.content);
  });

  it('creates/reuses a public buyer/listing thread with exactly two safe participants and stable snapshots', async () => {
    const f = await fixture(true);
    const snapshot = f.conversation.contextSnapshot;
    const response = await api()
      .post('/api/chat/conversations')
      .auth(f.buyer.token, { type: 'bearer' })
      .send({ listingId: f.listingId })
      .expect(200);
    expect(response.body.data.conversation.id).toBe(f.conversation.id);
    expect(response.body.data.conversation.participants).toHaveLength(2);
    await prisma.product.update({
      where: { id: f.productId! },
      data: { name: 'Changed Product' },
    });
    await prisma.store.update({
      where: { id: f.storeId! },
      data: { name: 'Changed Store' },
    });
    await prisma.listing.update({
      where: { id: f.listingId },
      data: {
        description: 'Changed',
        price: '999.00',
        status: 'SOLD',
        quantity: 0,
      },
    });
    await prisma.user.update({
      where: { id: f.seller.id },
      data: { username: `new_${f.seller.id.slice(0, 24)}` },
    });
    const detail = await api()
      .get(path(f.conversation.id))
      .auth(f.seller.token, { type: 'bearer' })
      .expect(200);
    expect(detail.body.data.contextSnapshot).toEqual(snapshot);
    expect(JSON.stringify(detail.body)).not.toMatch(
      /email|password|authSession|token|sessionId/i,
    );
    await api()
      .post(`${path(f.conversation.id)}/messages`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send(input())
      .expect(201);
    await prisma.listing.update({
      where: { id: f.listingId },
      data: { status: 'INACTIVE' },
    });
    await expect(
      chat.send(f.seller.id, f.conversation.id, input()),
    ).resolves.toMatchObject({ duplicate: false });
  });

  it('rejects self-chat, private listings and forged participants; returns 201 for a new public thread', async () => {
    const f = await fixture();
    await api()
      .post('/api/chat/conversations')
      .auth(f.seller.token, { type: 'bearer' })
      .send({ listingId: f.listingId })
      .expect(409);
    const outsider = await user();
    await api()
      .post('/api/chat/conversations')
      .auth(outsider.token, { type: 'bearer' })
      .send({ listingId: f.listingId, sellerId: outsider.id })
      .expect(422);
    const created = await api()
      .post('/api/chat/conversations')
      .auth(outsider.token, { type: 'bearer' })
      .send({ listingId: f.listingId })
      .expect(201);
    expect(created.body.data.conversation.buyerId).toBe(outsider.id);
    await prisma.listing.update({
      where: { id: f.listingId },
      data: { status: 'DRAFT' },
    });
    await api()
      .post('/api/chat/conversations')
      .auth((await user()).token, { type: 'bearer' })
      .send({ listingId: f.listingId })
      .expect(404);
  });

  it('deduplicates concurrent conversation creation at the database boundary', async () => {
    const f = await fixture();
    const buyer = await user();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => chat.create(buyer.id, f.listingId)),
    );
    expect(new Set(results.map((r) => r.conversation.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(
      await prisma.conversationParticipant.count({
        where: { conversationId: results[0].conversation.id },
      }),
    ).toBe(2);
  });

  it('retains historical context after catalogue deletion and never grants a replacement store owner access', async () => {
    const f = await fixture(true);
    const replacement = await user();
    await prisma.store.update({
      where: { id: f.storeId! },
      data: { userId: replacement.id },
    });
    await expect(
      chat.send(f.buyer.id, f.conversation.id, input()),
    ).rejects.toMatchObject({ code: 'STORE_NOT_ACTIVE' });
    await api()
      .get(path(f.conversation.id))
      .auth(replacement.token, { type: 'bearer' })
      .expect(404);
    await prisma.listing.delete({ where: { id: f.listingId } });
    await prisma.product.delete({ where: { id: f.productId! } });
    await prisma.store.delete({ where: { id: f.storeId! } });
    expect(
      (await chat.detail(f.seller.id, f.conversation.id)).contextSnapshot,
    ).toEqual(f.conversation.contextSnapshot);
    await expect(
      chat.send(f.buyer.id, f.conversation.id, input()),
    ).rejects.toMatchObject({ code: 'STORE_NOT_ACTIVE' });
  });

  it.each([false, true])(
    'blocks REST IDOR, including admin bypass (%s)',
    async (admin) => {
      const f = await fixture();
      const outsider = await user(admin);
      const message = await chat.send(f.buyer.id, f.conversation.id, input());
      await api().get(path(f.conversation.id)).expect(401);
      for (const route of [
        path(f.conversation.id),
        `${path(f.conversation.id)}/messages`,
      ])
        await api()
          .get(route)
          .auth(outsider.token, { type: 'bearer' })
          .expect(404);
      await api()
        .post(`${path(f.conversation.id)}/messages`)
        .auth(outsider.token, { type: 'bearer' })
        .send(input())
        .expect(404);
      await api()
        .put(`${path(f.conversation.id)}/read`)
        .auth(outsider.token, { type: 'bearer' })
        .send({ messageId: message.message.id })
        .expect(404);
      const inbox = await api()
        .get('/api/chat/conversations')
        .auth(outsider.token, { type: 'bearer' })
        .expect(200);
      expect(inbox.body.data.items).toEqual([]);
      expect((await chat.unread(outsider.id)).unreadMessages).toBe(0);
    },
  );

  it.each(['SUSPENDED', 'CLOSED'] as const)(
    'keeps store %s history readable but rejects sending on REST and WS',
    async (status) => {
      const f = await fixture(true);
      const socket = await connect(f.buyer.token);
      await prisma.store.update({
        where: { id: f.storeId! },
        data: { status },
      });
      await api()
        .get(path(f.conversation.id))
        .auth(f.buyer.token, { type: 'bearer' })
        .expect(200);
      await api()
        .post(`${path(f.conversation.id)}/messages`)
        .auth(f.buyer.token, { type: 'bearer' })
        .send(input())
        .expect(403);
      expect(
        await ack(socket, 'message.send', {
          conversationId: f.conversation.id,
          ...input(),
        }),
      ).toMatchObject({ success: false, error: { code: 'STORE_NOT_ACTIVE' } });
      expect(
        await prisma.message.count({
          where: { conversationId: f.conversation.id },
        }),
      ).toBe(0);
    },
  );

  it('checks active accounts, revoked sessions, expired JWT and handshake origins', async () => {
    const f = await fixture();
    await expect(connect('invalid-token')).rejects.toThrow();
    await expect(
      connect(f.buyer.token, {
        extraHeaders: { Origin: 'https://untrusted.invalid' },
      }),
    ).rejects.toThrow();
    const config = app.get(ConfigService);
    const expired = await app.get(JwtService).signAsync(
      { sub: f.buyer.id, sid: f.buyer.sessionId, accountType: 'USER' },
      {
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        issuer: config.getOrThrow('JWT_ISSUER'),
        audience: config.getOrThrow('JWT_AUDIENCE'),
        expiresIn: -1,
      },
    );
    await expect(connect(expired)).rejects.toThrow();
    await prisma.authSession.update({
      where: { id: f.buyer.sessionId },
      data: { revokedAt: new Date(), revocationReason: 'LOGOUT' },
    });
    await expect(connect(f.buyer.token)).rejects.toThrow();
    await api()
      .get(path(f.conversation.id))
      .auth(f.buyer.token, { type: 'bearer' })
      .expect(401);
    await prisma.user.update({
      where: { id: f.seller.id },
      data: { status: 'SUSPENDED' },
    });
    await expect(connect(f.seller.token)).rejects.toThrow();
    await api()
      .get(path(f.conversation.id))
      .auth(f.seller.token, { type: 'bearer' })
      .expect(403);
    await prisma.user.update({
      where: { id: f.seller.id },
      data: { status: 'DELETED' },
    });
    await expect(connect(f.seller.token)).rejects.toThrow();
    await api()
      .get(path(f.conversation.id))
      .auth(f.seller.token, { type: 'bearer' })
      .expect(403);
  });

  it('uses a real socket for authorized events and never leaks to an unauthorized subscription', async () => {
    const f = await fixture();
    const buyer = await connect(f.buyer.token);
    const seller = await connect(f.seller.token);
    const outsiderUser = await user(true);
    const outsider = await connect(outsiderUser.token);
    const leak = vi.fn();
    outsider.on('message.created', leak);
    outsider.on('conversation.updated', leak);
    expect(
      await ack(outsider, 'conversation.subscribe', {
        conversationId: f.conversation.id,
      }),
    ).toMatchObject({ success: false, error: { code: 'RESOURCE_NOT_FOUND' } });
    expect(
      await ack(outsider, 'message.send', {
        conversationId: f.conversation.id,
        ...input(),
      }),
    ).toMatchObject({ success: false, error: { code: 'RESOURCE_NOT_FOUND' } });
    expect(
      await ack(seller, 'conversation.subscribe', {
        conversationId: f.conversation.id,
      }),
    ).toEqual({ success: true, data: { conversationId: f.conversation.id } });
    const received = once(seller, 'message.created');
    const result = await ack(buyer, 'message.send', {
      conversationId: f.conversation.id,
      ...input('<script>plain text only</script>'),
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        duplicate: false,
        message: { sequence: '1', senderId: f.buyer.id, status: 'SENT' },
      },
    });
    expect(await received).toEqual(result.data.message);
    expect(
      await ack(outsider, 'message.read', {
        conversationId: f.conversation.id,
        messageId: result.data.message.id,
      }),
    ).toMatchObject({ success: false, error: { code: 'RESOURCE_NOT_FOUND' } });
    expect(JSON.stringify(result)).not.toMatch(
      /password|email|sessionId|accessToken/,
    );
    expect(
      await ack(buyer, 'message.read', {
        conversationId: f.conversation.id,
        messageId: result.data.message.id,
      }),
    ).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
    expect(
      await ack(seller, 'message.delivered', {
        conversationId: f.conversation.id,
        messageId: result.data.message.id,
      }),
    ).toMatchObject({ success: true });
    expect(
      (
        await prisma.message.findUniqueOrThrow({
          where: { id: result.data.message.id },
        })
      ).status,
    ).toBe('DELIVERED');
    expect(
      await ack(seller, 'message.read', {
        conversationId: f.conversation.id,
        messageId: result.data.message.id,
      }),
    ).toMatchObject({ success: true, data: { lastReadSequence: '1' } });
    expect(leak).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent REST/WS retries and refuses identity reuse with changed content', async () => {
    const f = await fixture();
    const socket = await connect(f.buyer.token);
    const payload = input();
    const [rest, ws] = await Promise.all([
      api()
        .post(`${path(f.conversation.id)}/messages`)
        .auth(f.buyer.token, { type: 'bearer' })
        .send(payload),
      ack(socket, 'message.send', {
        conversationId: f.conversation.id,
        ...payload,
      }),
    ]);
    expect([200, 201]).toContain(rest.status);
    expect(ws.success).toBe(true);
    expect(ws.data.message.id).toBe(rest.body.data.message.id);
    expect([ws.data.duplicate, rest.body.data.duplicate].sort()).toEqual([
      false,
      true,
    ]);
    await api()
      .post(`${path(f.conversation.id)}/messages`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send({ ...payload, content: 'changed' })
      .expect(409);
    expect(
      await prisma.message.count({
        where: { conversationId: f.conversation.id },
      }),
    ).toBe(1);
    expect(
      (await chat.detail(f.buyer.id, f.conversation.id)).lastSequence,
    ).toBe('1');
  });

  it('serializes simultaneous sends, paginates stable sequences, and reconnects without losing or duplicating history', async () => {
    const f = await fixture();
    const first = await connect(f.seller.token);
    await ack(first, 'conversation.subscribe', {
      conversationId: f.conversation.id,
    });
    first.disconnect();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        chat.send(f.buyer.id, f.conversation.id, input()),
      ),
    );
    expect(results.map((r) => Number(r.message.sequence)).sort()).toEqual([
      1, 2, 3, 4, 5,
    ]);
    const reconnected = await connect(f.seller.token);
    await ack(reconnected, 'conversation.subscribe', {
      conversationId: f.conversation.id,
    });
    const page1 = await api()
      .get(`${path(f.conversation.id)}/messages`)
      .query({ after: '0', limit: 2 })
      .auth(f.seller.token, { type: 'bearer' })
      .expect(200);
    const page2 = await chat.messages(f.seller.id, f.conversation.id, {
      after: page1.body.data.nextCursor,
      limit: 2,
    });
    const page3 = await chat.messages(f.seller.id, f.conversation.id, {
      after: page2.nextCursor!,
      limit: 2,
    });
    const messages = [...page1.body.data.items, ...page2.items, ...page3.items];
    expect(messages.map((m) => m.sequence)).toEqual(['1', '2', '3', '4', '5']);
    expect(new Set(messages.map((m) => m.id)).size).toBe(5);
    expect(
      (
        await chat.messages(f.seller.id, f.conversation.id, {
          before: '4',
          limit: 2,
        })
      ).items.map((m) => m.sequence),
    ).toEqual(['3', '2']);
    expect(await chat.unread(f.seller.id)).toEqual({
      unreadMessages: 5,
      unreadConversations: 1,
    });
    expect(await chat.unread(f.buyer.id)).toEqual({
      unreadMessages: 0,
      unreadConversations: 0,
    });
  });

  it('advances receipts monotonically across concurrent devices and never acknowledges sender or future/cross-chat messages', async () => {
    const f = await fixture();
    const other = await fixture();
    const messages = [];
    for (let i = 0; i < 3; i++)
      messages.push(
        (await chat.send(f.buyer.id, f.conversation.id, input())).message,
      );
    await Promise.all([
      chat.receipt(f.seller.id, f.conversation.id, messages[2].id, 'read'),
      chat.receipt(f.seller.id, f.conversation.id, messages[0].id, 'delivery'),
      chat.receipt(f.seller.id, f.conversation.id, messages[1].id, 'read'),
    ]);
    const participant = await prisma.conversationParticipant.findUniqueOrThrow({
      where: {
        conversationId_userId: {
          conversationId: f.conversation.id,
          userId: f.seller.id,
        },
      },
    });
    expect(participant.lastReadSequence).toBe(3n);
    expect(participant.lastDeliveredSequence).toBe(3n);
    const foreign = await chat.send(
      other.buyer.id,
      other.conversation.id,
      input(),
    );
    await expect(
      chat.receipt(f.seller.id, f.conversation.id, foreign.message.id, 'read'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      chat.receipt(f.seller.id, f.conversation.id, randomUUID(), 'read'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await api()
      .put(`${path(f.conversation.id)}/read`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send({ messageId: messages[0].id })
      .expect(403);
    await api()
      .put(`${path(f.conversation.id)}/read`)
      .auth(f.seller.token, { type: 'bearer' })
      .send({ messageId: messages[0].id, sequence: '999' })
      .expect(422);
    await Promise.all([
      chat.receipt(f.seller.id, f.conversation.id, messages[2].id, 'read'),
      chat.send(f.buyer.id, f.conversation.id, input()),
    ]);
    expect(await chat.unread(f.seller.id)).toEqual({
      unreadMessages: 1,
      unreadConversations: 1,
    });
    expect(
      (
        await chat.messages(f.buyer.id, f.conversation.id, { limit: 10 })
      ).items.map((m) => m.status),
    ).toEqual(['SENT', 'READ', 'READ', 'READ']);
  });

  it('rejects invalid text, forged sender/status and malformed cursors equally over REST/WS', async () => {
    const f = await fixture();
    const socket = await connect(f.buyer.token);
    for (const content of ['', '   ', 'x'.repeat(2001)]) {
      await api()
        .post(`${path(f.conversation.id)}/messages`)
        .auth(f.buyer.token, { type: 'bearer' })
        .send(input(content))
        .expect(422);
      expect(
        await ack(socket, 'message.send', {
          conversationId: f.conversation.id,
          ...input(content),
        }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    }
    expect(
      await ack(socket, 'message.send', {
        conversationId: f.conversation.id,
        ...input(),
        senderId: f.seller.id,
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    await api()
      .post(`${path(f.conversation.id)}/messages`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send({ ...input(), status: 'READ' })
      .expect(422);
    for (const query of [
      { after: '99' },
      { before: '1', after: '0' },
      { limit: 101 },
      { after: '-1' },
    ])
      await api()
        .get(`${path(f.conversation.id)}/messages`)
        .query(query)
        .auth(f.buyer.token, { type: 'bearer' })
        .expect(422);
  });

  it('enforces the shared REST/WS burst budget even across multiple sessions', async () => {
    const f = await fixture();
    const socket = await connect(f.buyer.token);
    for (let i = 0; i < 5; i++)
      await chat.send(f.buyer.id, f.conversation.id, input());
    const ws = await ack(socket, 'message.send', {
      conversationId: f.conversation.id,
      ...input(),
    });
    expect(ws).toMatchObject({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED' },
    });
    await api()
      .post(`${path(f.conversation.id)}/messages`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send(input())
      .expect(429);
    expect(
      await prisma.message.count({
        where: { conversationId: f.conversation.id },
      }),
    ).toBe(5);
  });

  it('bounds concurrent connections and conversation creation attempts', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) await connect(f.buyer.token);
    await expect(connect(f.buyer.token)).rejects.toThrow();
    for (let i = 0; i < 9; i++) await chat.create(f.buyer.id, f.listingId);
    await expect(chat.create(f.buyer.id, f.listingId)).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('checks revocation before outbound delivery and on the next event, not only at handshake', async () => {
    const f = await fixture();
    const seller = await connect(f.seller.token);
    await ack(seller, 'conversation.subscribe', {
      conversationId: f.conversation.id,
    });
    const received = vi.fn();
    seller.on('message.created', received);
    const disconnected = once(seller, 'disconnect');
    await api()
      .post('/api/auth/logout-all')
      .auth(f.seller.token, { type: 'bearer' })
      .set('Origin', origin)
      .set('X-GomGoods-CSRF', '1')
      .expect(204);
    await chat.send(f.buyer.id, f.conversation.id, input());
    await disconnected;
    expect(received).not.toHaveBeenCalled();
    const buyer = await connect(f.buyer.token);
    await prisma.user.update({
      where: { id: f.buyer.id },
      data: { status: 'SUSPENDED' },
    });
    const gone = once(buyer, 'disconnect');
    buyer.emit('message.send', {
      conversationId: f.conversation.id,
      ...input(),
    });
    await gone;
    expect(
      await prisma.message.count({
        where: { conversationId: f.conversation.id },
      }),
    ).toBe(1);
  });

  it('limits the rolling minute budget across REST/WS and keeps unread counts correct for interleaved senders', async () => {
    const f = await fixture();
    const socket = await connect(f.buyer.token);
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let group = 0; group < 6; group++) {
      for (let i = 0; i < 5; i++) {
        if (group === 0 && i === 0) {
          await api()
            .post(`${path(f.conversation.id)}/messages`)
            .auth(f.buyer.token, { type: 'bearer' })
            .send(input())
            .expect(201);
        } else {
          expect(
            await ack(socket, 'message.send', {
              conversationId: f.conversation.id,
              ...input(),
            }),
          ).toMatchObject({ success: true });
        }
      }
      now += 1001;
    }
    expect(
      await ack(socket, 'message.send', {
        conversationId: f.conversation.id,
        ...input(),
      }),
    ).toMatchObject({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } });
    const reply = await chat.send(
      f.seller.id,
      f.conversation.id,
      input('seller reply'),
    );
    expect(reply.message.sequence).toBe('31');
    expect(await chat.unread(f.seller.id)).toEqual({
      unreadMessages: 30,
      unreadConversations: 1,
    });
    expect(await chat.unread(f.buyer.id)).toEqual({
      unreadMessages: 1,
      unreadConversations: 1,
    });
    await chat.receipt(f.buyer.id, f.conversation.id, reply.message.id, 'read');
    expect(await chat.unread(f.buyer.id)).toEqual({
      unreadMessages: 0,
      unreadConversations: 0,
    });
    const inbox = await chat.inbox(f.seller.id, { limit: 30 });
    expect(inbox.items[0].unreadCount).toBe(30);
  });

  it('bounds subscriptions to 50, checks unsubscription and rejects oversized transport payloads', async () => {
    const f = await fixture();
    const socket = await connect(f.seller.token);
    const threads = [f.conversation.id];
    for (let i = 0; i < 50; i++) {
      const buyer = await user();
      threads.push((await chat.create(buyer.id, f.listingId)).conversation.id);
    }
    for (const conversationId of threads.slice(0, 50))
      expect(
        await ack(socket, 'conversation.subscribe', { conversationId }),
      ).toMatchObject({ success: true });
    expect(
      await ack(socket, 'conversation.subscribe', {
        conversationId: threads[50],
      }),
    ).toMatchObject({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } });
    expect(
      await ack(socket, 'conversation.unsubscribe', {
        conversationId: threads[0],
      }),
    ).toMatchObject({ success: true });
    expect(
      await ack(socket, 'conversation.subscribe', {
        conversationId: threads[50],
      }),
    ).toMatchObject({ success: true });
    const disconnected = once(socket, 'disconnect');
    socket.emit('message.send', {
      conversationId: f.conversation.id,
      ...input('x'.repeat(20_000)),
    });
    await disconnected;
    expect(
      await prisma.message.count({
        where: { conversationId: f.conversation.id },
      }),
    ).toBe(0);
  }, 20_000);

  it('paginates the member-scoped inbox and does not let a foreign cursor reveal another thread', async () => {
    const f = await fixture();
    const other = await fixture();
    await chat.create(other.buyer.id, f.listingId);
    const page = await chat.inbox(other.buyer.id, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await chat.inbox(other.buyer.id, {
      limit: 1,
      cursor: page.nextCursor!,
    });
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(page.items[0].id);
    const forged = Buffer.from(
      JSON.stringify({
        id: f.conversation.id,
        updatedAt: f.conversation.updatedAt.toISOString(),
      }),
    ).toString('base64url');
    await api()
      .get('/api/chat/conversations')
      .query({ cursor: forged })
      .auth(other.buyer.token, { type: 'bearer' })
      .expect(422);
  });

  it('rolls back sequence/activity/message on a persistence error and emits nothing before commit', async () => {
    const f = await fixture();
    const before = await chat.detail(f.buyer.id, f.conversation.id);
    const events = vi.spyOn(app.get(ChatEvents), 'publish');
    const payload = input();
    // A rolled-back interactive transaction exercises the real DB writes and
    // lock path, then simulates failure before COMMIT without altering production.
    const original = prisma.$transaction.bind(prisma);
    const forced = vi.spyOn(prisma, '$transaction').mockImplementationOnce(((
      run: any,
    ) =>
      original(async (tx) => {
        await run(tx);
        throw new Error('Injected commit failure');
      })) as any);
    await expect(
      chat.send(f.buyer.id, f.conversation.id, payload),
    ).rejects.toThrow('Injected commit failure');
    forced.mockRestore();
    expect(await chat.detail(f.buyer.id, f.conversation.id)).toEqual(before);
    expect(events).not.toHaveBeenCalled();
    const retry = await chat.send(f.buyer.id, f.conversation.id, payload);
    expect(retry.message.sequence).toBe('1');
    expect(events).toHaveBeenCalledTimes(1);
  });

  it('keeps inbox preview and unread counts on the same snapshot during a concurrent send', async () => {
    const f = await fixture();
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(((
      run: any,
      options: any,
    ) =>
      original(async (tx) => {
        const find = tx.conversation.findMany.bind(tx.conversation);
        vi.spyOn(tx.conversation, 'findMany').mockImplementationOnce((async (
          args: any,
        ) => {
          const rows = await find(args);
          await chat.send(f.buyer.id, f.conversation.id, input());
          return rows;
        }) as any);
        return run(tx);
      }, options)) as any);
    const during = await chat.inbox(f.seller.id, { limit: 30 });
    expect(during.items[0]).toMatchObject({
      lastSequence: '0',
      lastMessage: null,
      unreadCount: 0,
    });
    const after = await chat.inbox(f.seller.id, { limit: 30 });
    expect(after.items[0]).toMatchObject({ lastSequence: '1', unreadCount: 1 });
  });

  it('routes REST/WS messages and receipts by canonical UUID even when input UUIDs are uppercase', async () => {
    const f = await fixture();
    const buyer = await connect(f.buyer.token);
    const seller = await connect(f.seller.token);
    for (const socket of [buyer, seller])
      await ack(socket, 'conversation.subscribe', {
        conversationId: f.conversation.id,
      });
    const upper = f.conversation.id.toUpperCase();
    const firstEvent = once(seller, 'message.created');
    const first = await api()
      .post(`${path(upper)}/messages`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send(input('Xin chào 😀'))
      .expect(201);
    expect(await firstEvent).toEqual(first.body.data.message);
    const receiptEvent = once(buyer, 'receipt.updated');
    const read = await ack(seller, 'message.read', {
      conversationId: upper,
      messageId: first.body.data.message.id.toUpperCase(),
    });
    expect(read).toMatchObject({
      success: true,
      data: { conversationId: f.conversation.id, lastReadSequence: '1' },
    });
    expect(await receiptEvent).toEqual(read.data);
    const secondEvent = once(buyer, 'message.created');
    const reply = await ack(seller, 'message.send', {
      conversationId: upper,
      ...input('Đã nhận!'),
    });
    expect(reply.success).toBe(true);
    expect(await secondEvent).toEqual(reply.data.message);
    const restReceiptEvent = once(seller, 'receipt.updated');
    const restReceipt = await api()
      .put(`${path(upper)}/read`)
      .auth(f.buyer.token, { type: 'bearer' })
      .send({ messageId: reply.data.message.id.toUpperCase() })
      .expect(200);
    expect(await restReceiptEvent).toEqual(restReceipt.body.data);
    const otherBuyer = await user();
    const thread = await chat.create(otherBuyer.id, f.listingId.toUpperCase());
    expect(thread.conversation.listingId).toBe(f.listingId);
    expect(thread.conversation.contextSnapshot).toMatchObject({
      listingId: f.listingId,
    });
  });

  it('prevents participant moves from leaving the source conversation empty and preserves immutable context', async () => {
    const f = await fixture();
    const listingId = randomUUID();
    listingIds.push(listingId);
    await prisma.listing.create({
      data: {
        id: listingId,
        sellerUserId: f.seller.id,
        price: '10.00',
        quantity: 1,
        condition: 'NEW',
        status: 'ACTIVE',
      },
    });
    const other = (await chat.create(f.buyer.id, listingId)).conversation;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.conversationParticipant.deleteMany({
          where: { conversationId: other.id },
        });
        await tx.conversationParticipant.updateMany({
          where: { conversationId: f.conversation.id },
          data: { conversationId: other.id },
        });
      }),
    ).rejects.toThrow();
    for (const id of [f.conversation.id, other.id])
      expect(
        await prisma.conversationParticipant.count({
          where: { conversationId: id },
        }),
      ).toBe(2);
    await expect(
      prisma.conversation.update({
        where: { id: f.conversation.id },
        data: { contextSnapshot: { sellerUsername: 'Overwritten history' } },
      }),
    ).rejects.toThrow();
    expect(
      (await chat.detail(f.buyer.id, f.conversation.id)).contextSnapshot,
    ).toEqual(f.conversation.contextSnapshot);
  });

  it('enforces monotonic persisted receipts/sequence and the full Unicode length including surrounding spaces', async () => {
    const f = await fixture();
    await expect(
      prisma.message.create({
        data: {
          conversationId: f.conversation.id,
          senderId: f.buyer.id,
          clientMessageId: randomUUID(),
          sequence: 1,
          content: ' ' + 'đ'.repeat(2000),
        },
      }),
    ).rejects.toThrow();
    const message = await chat.send(f.buyer.id, f.conversation.id, input());
    await chat.receipt(
      f.seller.id,
      f.conversation.id,
      message.message.id,
      'read',
    );
    await expect(
      prisma.conversationParticipant.update({
        where: {
          conversationId_userId: {
            conversationId: f.conversation.id,
            userId: f.seller.id,
          },
        },
        data: { lastReadSequence: 0, lastDeliveredSequence: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.conversation.update({
        where: { id: f.conversation.id },
        data: { lastSequence: 0 },
      }),
    ).rejects.toThrow();
    expect(await chat.unread(f.seller.id)).toEqual({
      unreadMessages: 0,
      unreadConversations: 0,
    });
    expect(
      (await chat.messages(f.buyer.id, f.conversation.id, { limit: 10 })).items,
    ).toMatchObject([{ status: 'READ', sequence: '1' }]);
  });

  it('enforces database membership, exact participant count, receipt bounds and transaction isolation', async () => {
    const f = await fixture();
    const other = await user();
    await expect(
      prisma.message.create({
        data: {
          conversationId: f.conversation.id,
          senderId: other.id,
          clientMessageId: randomUUID(),
          content: 'intrusion',
          sequence: 1,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.conversationParticipant.create({
        data: { conversationId: f.conversation.id, userId: other.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.conversationParticipant.update({
        where: {
          conversationId_userId: {
            conversationId: f.conversation.id,
            userId: f.seller.id,
          },
        },
        data: { lastDeliveredSequence: 999 },
      }),
    ).rejects.toThrow();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT conversation_id FROM "CONVERSATION" WHERE conversation_id=${f.conversation.id}::uuid FOR UPDATE`;
        ready();
        await gate;
      },
      { timeout: 10_000 },
    );
    await locked;
    const send = chat.send(f.buyer.id, f.conversation.id, input());
    try {
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`;
        expect(row.count).toBeGreaterThanOrEqual(1);
      });
      expect(
        (await chat.messages(f.seller.id, f.conversation.id, { limit: 10 }))
          .items,
      ).toEqual([]);
      expect(
        (await chat.detail(f.seller.id, f.conversation.id)).lastSequence,
      ).toBe('0');
    } finally {
      release();
      await holder;
      await send;
    }
    expect(
      (await chat.messages(f.seller.id, f.conversation.id, { limit: 10 }))
        .items,
    ).toHaveLength(1);
  });
});
