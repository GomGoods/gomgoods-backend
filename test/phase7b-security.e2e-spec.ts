import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AccessTokenService } from '../src/modules/auth/access-token.service.js';
import { ForumRateLimit } from '../src/modules/forum/forum-rate-limit.js';
import { createTestApp } from './helpers/create-test-app.js';

describe('Phase 7B adversarial HTTP/PostgreSQL security', () => {
  let app: INestApplication, peer: INestApplication, db: PrismaService;
  const users: string[] = [];
  const topicId = '00000000-0000-4000-8000-000000007001';
  const api = (server = app) => request(server.getHttpServer());
  beforeAll(async () => {
    app = await createTestApp(); db = app.get(PrismaService);
    const url = new URL(app.get(ConfigService).getOrThrow<string>('DATABASE_URL'));
    expect(['localhost', '127.0.0.1']).toContain(url.hostname); expect(url.port).toBe('55432'); expect(url.pathname).toBe('/gomgoods_test');
    expect(await db.$queryRaw`SELECT current_database() AS db,current_schema() AS schema`).toEqual([{ db: 'gomgoods_test', schema: 'public' }]);
    peer = await createTestApp();
  });
  afterAll(async () => {
    if (peer) await peer.close();
    if (!db) { if (app) await app.close(); return; }
    try {
      await db.forumModerationAction.deleteMany({ where: { post: { userId: { in: users } } } });
      await db.report.deleteMany({ where: { userId: { in: users } } });
      await db.post.deleteMany({ where: { userId: { in: users } } });
      const [{ table }] = await db.$queryRaw<{ table: string | null }[]>`SELECT to_regclass('public."FORUM_RATE_LIMIT"')::text AS "table"`;
      if (table && users.length) await db.$executeRaw(Prisma.sql`DELETE FROM "FORUM_RATE_LIMIT" WHERE user_id IN (${Prisma.join(users.map(id => Prisma.sql`${id}::uuid`))})`);
      await db.user.deleteMany({ where: { id: { in: users } } });
    } finally { await app.close(); }
  });
  async function actor(admin = false) {
    const id = randomUUID(); users.push(id);
    if (process.env.GOMGOODS_SECURITY_FIXTURE_LOG) appendFileSync(process.env.GOMGOODS_SECURITY_FIXTURE_LOG, id + '\n');
    await db.user.create({ data: { id, username: 'sec_' + id.slice(0, 24), email: id + '@forum-security.e2e.gomgoods.local', passwordHash: 'unused-security-fixture', accountType: admin ? 'ADMIN' : 'USER' } });
    const session = await db.authSession.create({ data: { userId: id, expiresAt: new Date(Date.now() + 3600000) } });
    const token = (await app.get(AccessTokenService).sign({ sub: id, sid: session.id, accountType: admin ? 'ADMIN' : 'USER' })).accessToken;
    return { id, sessionId: session.id, token };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const auth = (user: Actor) => ['Authorization', 'Bearer ' + user.token] as const;
  const input = (content = 'Tiếng Việt 😀 ' + randomUUID()) => ({ title: 'Bài bảo mật ' + randomUUID(), content, topicId });
  async function post(user: Actor, status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') {
    return db.post.create({ data: { userId: user.id, title: 'Fixture ' + randomUUID(), content: 'Bài fixture 😀 ' + randomUUID(), topicId, status } });
  }
  async function forumState() {
    const rows = [];
    for (const table of ['POST', 'COMMENT', 'REACTION', 'REPORT', 'FORUM_MODERATION_ACTION', 'FORUM_LIKE_EVENT']) rows.push(await db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM public."${table}" t ORDER BY to_jsonb(t)::text`));
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  async function denied(test: request.Test, status: number, code?: string) {
    const before = await forumState();
    const result = await test.expect(status);
    expect(result.body.success).toBe(false);
    const expected: Record<number, string> = { 401: 'INVALID_ACCESS_TOKEN', 403: 'FORBIDDEN', 404: 'RESOURCE_NOT_FOUND', 409: 'RESOURCE_CONFLICT', 422: 'VALIDATION_FAILED', 429: 'RATE_LIMIT_EXCEEDED' };
    expect(result.body.error.code).toBe(code ?? expected[status]);
    expect(await forumState()).toBe(before);
    return result;
  }
  it('rejects duplicate post creation across independent app instances without inserting a second row', async () => {
    const user = await actor(), body = input();
    const results = await Promise.all([api().post('/api/forum/posts').set(...auth(user)).send(body), api(peer).post('/api/forum/posts').set(...auth(user)).send(body)]);
    expect(results.map(row => row.status).sort()).toEqual([201, 409]);
    expect(await db.post.count({ where: { userId: user.id } })).toBe(1);
  });
  it('marks private Forum responses no-store and rejects trailing authorization fields', async () => {
    const user = await actor();
    const result = await api().get('/api/forum/me/posts').set(...auth(user)).expect(200);
    expect(result.headers['cache-control']).toContain('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    await denied(api().post('/api/forum/posts').set('Authorization', 'Bearer ' + user.token + ' ignored-extra').send(input()), 401, 'INVALID_ACCESS_TOKEN');
  });
  async function targets() {
    const owner = await actor(), row = await post(owner);
    const comment = await db.comment.create({ data: { postId: row.id, userId: owner.id, content: 'Fixture gốc ' + randomUUID() } });
    const report = await db.report.create({ data: { userId: owner.id, targetType: 'POST', targetId: row.id, postId: row.id, reason: 'SPAM' } });
    return { owner, row, comment, report };
  }
  type Target = Awaited<ReturnType<typeof targets>>;
  function protectedRoutes({ row, comment, report }: Target) {
    return [
      ['get', '/forum/me/posts'], ['post', '/forum/posts', input()],
      ['patch', `/forum/posts/${row.id}`, { content: 'forged edit' }], ['delete', `/forum/posts/${row.id}`],
      ['post', `/forum/posts/${row.id}/comments`, { content: 'forged comment' }],
      ['patch', `/forum/comments/${comment.id}`, { content: 'forged comment edit' }], ['delete', `/forum/comments/${comment.id}`],
      ['put', `/forum/posts/${row.id}/like`], ['delete', `/forum/posts/${row.id}/like`],
      ['post', `/forum/posts/${row.id}/reports`, { reason: 'SPAM' }], ['post', `/forum/comments/${comment.id}/reports`, { reason: 'SPAM' }],
      ['get', '/forum/admin/reports'], ['patch', `/forum/admin/reports/${report.id}`, { status: 'RESOLVED', action: 'HIDE', note: 'forged moderation' }],
      ['post', `/forum/admin/posts/${row.id}/hide`, { note: 'forged hide' }], ['post', `/forum/admin/comments/${comment.id}/hide`, { note: 'forged hide' }],
      ['get', `/forum/admin/posts/${row.id}/moderation-actions`],
    ] as const;
  }
  it('rejects anonymous, invalid and expired credentials on every protected endpoint with no domain mutation', async () => {
    const target = await targets(), config = app.get(ConfigService);
    const expired = await new JwtService().signAsync({ sub: target.owner.id, sid: target.owner.sessionId, accountType: 'ADMIN' }, { secret: config.getOrThrow('JWT_ACCESS_SECRET'), issuer: config.getOrThrow('JWT_ISSUER'), audience: config.getOrThrow('JWT_AUDIENCE'), expiresIn: -60 });
    for (const [header, code] of [[undefined, 'AUTHENTICATION_REQUIRED'], ['Bearer invalid.signature.token', 'INVALID_ACCESS_TOKEN'], ['Bearer ' + expired, 'ACCESS_TOKEN_EXPIRED']] as const) {
      for (const [method, path, body] of protectedRoutes(target)) {
        let call = api()[method]('/api' + path);
        if (header) call = call.set('Authorization', header);
        if (body) call = call.send(body);
        await denied(call, 401, code);
      }
    }
  });
  it('enforces current DB role for every ADMIN route, stale claims, demotion and promotion without refresh', async () => {
    const target = await targets(), user = await actor(), admin = await actor(true);
    const staleClaim = (await app.get(AccessTokenService).sign({ sub: user.id, sid: user.sessionId, accountType: 'ADMIN' })).accessToken;
    for (const token of [user.token, staleClaim]) for (const [method, path, body] of protectedRoutes(target).slice(11)) {
      let call = api()[method]('/api' + path).set('Authorization', 'Bearer ' + token); if (body) call = call.send(body);
      await denied(call, 403);
    }
    await db.user.update({ where: { id: admin.id }, data: { accountType: 'USER' } });
    for (const [method, path, body] of protectedRoutes(target).slice(11)) {
      let call = api()[method]('/api' + path).set(...auth(admin)); if (body) call = call.send(body);
      await denied(call, 403);
    }
    await db.user.update({ where: { id: user.id }, data: { accountType: 'ADMIN' } });
    const list = await api().get('/api/forum/admin/reports').set(...auth(user)).expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/password|email|refresh|sessionId|accessToken/);
  });
  it('invalidates revoked, expired and nonexistent sessions even with a valid access token', async () => {
    for (const mode of ['revoked', 'expired', 'nonexistent']) {
      const user = await actor();
      if (mode === 'revoked') await db.authSession.update({ where: { id: user.sessionId }, data: { revokedAt: new Date(), revocationReason: 'LOGOUT' } });
      if (mode === 'expired') await db.authSession.update({ where: { id: user.sessionId }, data: { createdAt: new Date(Date.now() - 7200000), expiresAt: new Date(Date.now() - 3600000) } });
      if (mode === 'nonexistent') user.token = (await app.get(AccessTokenService).sign({ sub: user.id, sid: randomUUID(), accountType: 'ADMIN' })).accessToken;
      await denied(api().post('/api/forum/posts').set(...auth(user)).send(input()), 401);
      await denied(api().get('/api/forum/me/posts').set(...auth(user)), 401);
    }
  });
  it('rejects malformed authorization and cookie-only Forum writes; CSRF and CORS remain separate controls', async () => {
    const user = await actor();
    for (const header of ['Basic ' + user.token, 'bearer ' + user.token, 'Bearer', 'Bearer  ' + user.token]) await denied(api().post('/api/forum/posts').set('Authorization', header).send(input()), 401, 'AUTHENTICATION_REQUIRED');
    await denied(api().post('/api/forum/posts').set({ Authorization: ['Bearer ' + user.token, 'Bearer invalid'] }).send(input()), 401, 'INVALID_ACCESS_TOKEN');
    await denied(api().post('/api/forum/posts').set('Cookie', 'gomgoods_refresh=not-a-bearer-token').send(input()), 401, 'AUTHENTICATION_REQUIRED');
    await denied(api().post('/api/auth/refresh').set('Origin', 'https://evil.invalid').set('X-GomGoods-CSRF', '1'), 403, 'CSRF_VALIDATION_FAILED');
    const before = await forumState();
    const cors = await api().options('/api/forum/posts').set('Origin', 'https://evil.invalid').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type').expect(204);
    expect(cors.headers['access-control-allow-origin']).toBeUndefined(); expect(await forumState()).toBe(before);
    expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(false);
  });
  it('prevents all cross-owner post/comment writes and leaks no private reports/history', async () => {
    const target = await targets(), other = await actor();
    for (const index of [2, 3, 5, 6]) {
      const [method, path, body] = protectedRoutes(target)[index];
      let call = api()[method]('/api' + path).set(...auth(other)); if (body) call = call.send(body);
      await denied(call, 404);
    }
    await denied(api().get(`/api/forum/admin/posts/${target.row.id}/moderation-actions`).set(...auth(other)), 403);
    await denied(api().get(`/api/forum/reports/${target.report.id}`).set(...auth(other)), 404);
    const mine = await api().get('/api/forum/me/posts').set(...auth(other)).expect(200); expect(mine.body.data.items).toEqual([]);
  });
  it('rejects mass assignment, timestamp/counter forgery and invalid payloads without creating content', async () => {
    const user = await actor();
    const fields = { userId: randomUUID(), authorId: randomUUID(), sellerUserId: randomUUID(), role: 'ADMIN', isAdmin: true, moderationStatus: 'PUBLISHED', approvedBy: user.id, deletedBy: user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), likeCount: 999 };
    for (const [key, value] of Object.entries(fields)) await denied(api().post('/api/forum/posts').set(...auth(user)).send({ ...input(), [key]: value }), 422);
    for (const content of [' \r\n\t', '\u0000', '\ud800', '😀'.repeat(10001)]) await denied(api().post('/api/forum/posts').set(...auth(user)).send(input(content)), 422);
    const tooLarge = await api().post('/api/forum/posts').set(...auth(user)).send(input('x'.repeat(110000))).expect(413);
    expect(tooLarge.body.success).toBe(false); expect(await db.post.count({ where: { userId: user.id } })).toBe(0);
  });
  it('validates forged cursor integer bounds rather than passing oversized scores to PostgreSQL', async () => {
    const scope = createHash('sha256').update(JSON.stringify(['feed', 'popular', '', ''])).digest('hex');
    const cursor = Buffer.from(JSON.stringify({ v: 1, scope, id: randomUUID(), score: Number.MAX_SAFE_INTEGER, watermark: '0', createdAt: '2026-01-01T00:00:00.000Z', asOf: '2026-01-02T00:00:00.000Z' })).toString('base64url');
    await denied(api().get('/api/forum/posts').query({ sort: 'popular', cursor }), 422);
  });
  it('rejects injection/invalid filter and cursor shapes and never returns draft/hidden/removed rows', async () => {
    const owner = await actor(), admin = await actor(true), row = await post(owner), draft = await post(owner, 'DRAFT');
    const removed = await post(owner); await db.post.update({ where: { id: removed.id }, data: { status: 'REMOVED', deletedAt: new Date() } });
    for (const query of [{ sort: 'popular; DROP TABLE "POST"' }, { limit: 1000000 }, { q: 'x'.repeat(101) }, { q: ['x', 'y'] }, { topic: '../private' }, { cursor: 'x'.repeat(1025) }, { cursor: '{}' }]) await denied(api().get('/api/forum/posts').query(query), 422);
    const hidden = await api().post(`/api/forum/admin/posts/${row.id}/hide`).set(...auth(admin)).send({ note: 'Fixture visibility check' }).expect(200); expect(hidden.body.data.status).toBe('HIDDEN');
    for (const id of [row.id, draft.id, removed.id]) {
      await denied(api().get(`/api/forum/posts/${id}`), 404);
      await denied(api().get(`/api/forum/posts/${id}/comments`), 404);
      await denied(api().put(`/api/forum/posts/${id}/like`).set(...auth(owner)), 404);
    }
    for (const sort of ['newest', 'popular']) {
      const feed = await api().get('/api/forum/posts').query({ sort, q: 'Fixture' }).expect(200);
      expect(feed.body.data.items.map((item: { id: string }) => item.id)).not.toEqual(expect.arrayContaining([row.id]));
      expect(feed.body.data.items.some((item: { id: string }) => [row.id, draft.id, removed.id].includes(item.id))).toBe(false);
    }
    await denied(api().patch(`/api/forum/posts/${row.id}`).set(...auth(owner)).send({ status: 'PUBLISHED' }), 409);
    const literal = await api().get('/api/forum/posts').query({ q: "' OR 1=1 -- %_" }).expect(200); expect(literal.body.data.items).toEqual([]);
    await denied(api().get('/api/forum/posts/not-a-uuid'), 422);
  });
  it('admits exactly one shared per-user post budget across sessions, instances, forwarded headers and restart', async () => {
    const user = await actor();
    const session = await db.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600000) } });
    const token = (await app.get(AccessTokenService).sign({ sub: user.id, sid: session.id, accountType: 'USER' })).accessToken;
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) => api(index % 2 ? app : peer).post('/api/forum/posts').set('Authorization', 'Bearer ' + (index % 2 ? token : user.token)).set('X-Forwarded-For', '198.51.100.' + index).send(input())));
    expect(results.map(result => result.status).sort()).toEqual([201, 201, 201, 429]);
    const throttled = results.find(result => result.status === 429)!;
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0); expect(throttled.body.error.details[0].retryAfterSeconds).toBeGreaterThan(0);
    expect(await db.post.count({ where: { userId: user.id } })).toBe(3);
    await peer.close(); peer = await createTestApp();
    await denied(api(peer).post('/api/forum/posts').set(...auth(user)).send(input()), 429);
    expect((await db.forumRateLimit.findUniqueOrThrow({ where: { userId_operation: { userId: user.id, operation: 'post' } } })).requestCount).toBe(3);
  });
  it('rate-limits comments/replies and serializes duplicate comment admission without corrupting reply depth', async () => {
    const owner = await actor(), commenter = await actor(), duplicateActor = await actor(), row = await post(owner);
    const root = await db.comment.create({ data: { userId: owner.id, postId: row.id, content: 'Parent fixture' } });
    const duplicate = await Promise.all([app, peer].map(server => api(server).post(`/api/forum/posts/${row.id}/comments`).set(...auth(duplicateActor)).send({ content: 'Bình luận trùng 😀', parentId: root.id })));
    expect(duplicate.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await db.comment.count({ where: { userId: duplicateActor.id } })).toBe(1);
    const results = await Promise.all(Array.from({ length: 11 }, (_, index) => api(index % 2 ? app : peer).post(`/api/forum/posts/${row.id}/comments`).set(...auth(commenter)).send({ content: 'Bình luận ' + index, ...(index % 2 ? { parentId: root.id } : {}) })));
    expect(results.filter(result => result.status === 201)).toHaveLength(10); expect(results.filter(result => result.status === 429)).toHaveLength(1);
    expect(await db.comment.count({ where: { userId: commenter.id } })).toBe(10);
    const reply = await db.comment.findFirstOrThrow({ where: { userId: duplicateActor.id } });
    await denied(api().post(`/api/forum/posts/${row.id}/comments`).set(...auth(duplicateActor)).send({ content: 'Grandchild', parentId: reply.id }), 404);
  });
  it('bounds report flooding across instances and never hides content due to reports alone', async () => {
    const owner = await actor(), reporter = await actor(), row = await post(owner);
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => api(index % 2 ? app : peer).post(`/api/forum/posts/${row.id}/reports`).set(...auth(reporter)).send({ reason: 'SPAM' })));
    expect(results.filter(result => result.status === 200)).toHaveLength(3); expect(results.filter(result => result.status === 429)).toHaveLength(7);
    expect(await db.report.count({ where: { userId: reporter.id } })).toBe(1);
    expect((await db.post.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PUBLISHED');
    expect(await db.forumModerationAction.count({ where: { postId: row.id } })).toBe(0);
    const counter = await db.forumRateLimit.findUniqueOrThrow({ where: { userId_operation: { userId: reporter.id, operation: 'report' } } });
    expect(counter.expiresAt.getTime() - counter.windowStartedAt.getTime()).toBe(600000);
    await denied(api().post(`/api/forum/posts/${randomUUID()}/reports`).set(...auth(owner)).send({ reason: 'SCAM' }), 404);
  });
  it('shares like/unlike budget atomically and never removes another actor reaction using a forged body', async () => {
    const owner = await actor(), liker = await actor(), other = await actor(), row = await post(owner);
    const results = await Promise.all(Array.from({ length: 31 }, (_, index) => api(index % 2 ? app : peer).put(`/api/forum/posts/${row.id}/like`).set(...auth(liker))));
    expect(results.filter(result => result.status === 200)).toHaveLength(30); expect(results.filter(result => result.status === 429)).toHaveLength(1);
    expect(await db.reaction.count({ where: { postId: row.id } })).toBe(1); expect(await db.forumLikeEvent.count({ where: { postId: row.id } })).toBe(1);
    const before = await forumState();
    await api().delete(`/api/forum/posts/${row.id}/like`).set(...auth(other)).send({ userId: liker.id }).expect(200);
    expect(await forumState()).toBe(before);
    await denied(api().delete(`/api/forum/posts/${row.id}/like`).set(...auth(liker)), 429);
  });
  it('expires and prunes only operational limiter rows without touching domain records', async () => {
    const user = await actor();
    await app.get(ForumRateLimit).consume(user.id, 'post'); await app.get(ForumRateLimit).consume(user.id, 'like');
    await db.forumRateLimit.update({ where: { userId_operation: { userId: user.id, operation: 'post' } }, data: { windowStartedAt: new Date(Date.now() - 180000), expiresAt: new Date(Date.now() - 120000) } });
    const before = await forumState();
    expect(await app.get(ForumRateLimit).pruneExpired()).toBeGreaterThanOrEqual(1);
    expect(await db.forumRateLimit.findUnique({ where: { userId_operation: { userId: user.id, operation: 'post' } } })).toBeNull();
    expect(await db.forumRateLimit.findUnique({ where: { userId_operation: { userId: user.id, operation: 'like' } } })).not.toBeNull();
    expect(await forumState()).toBe(before);
    await api().post('/api/forum/posts').set(...auth(user)).send(input()).expect(201);
    expect((await db.forumRateLimit.findUniqueOrThrow({ where: { userId_operation: { userId: user.id, operation: 'post' } } })).requestCount).toBe(1);
  });
  it('fails closed on a blocked limiter table while public reads and authentication remain available', async () => {
    const user = await actor();
    await db.$transaction(async tx => {
      await tx.$executeRaw`LOCK TABLE "FORUM_RATE_LIMIT" IN ACCESS EXCLUSIVE MODE`;
      const deniedWrite = await denied(api().post('/api/forum/posts').set(...auth(user)).send(input()), 503, 'SERVICE_UNAVAILABLE');
      expect(JSON.stringify(deniedWrite.body)).not.toMatch(/INSERT|SELECT|postgres|password|connectionString|stack/i);
      await expect(app.get(ForumRateLimit).pruneExpired()).rejects.toBeDefined();
      await api().get('/api/forum/topics').expect(200);
      await api().get('/api/auth/me').set(...auth(user)).expect(200);
    }, { timeout: 7000 });
    await api().post('/api/forum/posts').set(...auth(user)).send(input()).expect(201);
  }, 10000);
  it('keeps concurrent moderation terminal states and audit actors coherent; history has no mutation API', async () => {
    const target = await targets(), first = await actor(true), second = await actor(true);
    const results = await Promise.all([
      api().patch(`/api/forum/admin/reports/${target.report.id}`).set(...auth(first)).send({ status: 'RESOLVED', action: 'HIDE', note: 'Resolve fixture' }),
      api(peer).patch(`/api/forum/admin/reports/${target.report.id}`).set(...auth(second)).send({ status: 'REJECTED', action: 'NONE', note: 'Reject fixture' }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const report = await db.report.findUniqueOrThrow({ where: { id: target.report.id } });
    const row = await db.post.findUniqueOrThrow({ where: { id: target.row.id } });
    expect(row.status).toBe(report.status === 'RESOLVED' ? 'HIDDEN' : 'PUBLISHED');
    const actions = await db.forumModerationAction.findMany({ where: { reportId: report.id } });
    expect(actions).toHaveLength(1); expect(actions[0].actorId).toBe(report.status === 'RESOLVED' ? first.id : second.id);
    await denied(api().patch(`/api/forum/admin/reports/${report.id}`).set(...auth(first)).send({ status: 'IN_REVIEW', note: 'Reopen forbidden' }), 409);
    await denied(api().delete(`/api/forum/admin/posts/${target.row.id}/moderation-actions`).set(...auth(first)), 404);
  });
  it.each([
    ['post edit', 10], ['post delete', 5], ['comment edit', 10], ['comment delete', 10],
  ] as const)('enforces independent %s write budget with no mutation after the limit', async (operation, limit) => {
    const user = await actor(), row = await post(user);
    const comment = await db.comment.create({ data: { userId: user.id, postId: row.id, content: 'Budget fixture ' + randomUUID() } });
    const call = (index: number) => operation === 'post edit' ? api().patch(`/api/forum/posts/${row.id}`).set(...auth(user)).send({ title: 'Edited title ' + index })
      : operation === 'post delete' ? api().delete(`/api/forum/posts/${row.id}`).set(...auth(user))
      : operation === 'comment edit' ? api().patch(`/api/forum/comments/${comment.id}`).set(...auth(user)).send({ content: 'Edited comment ' + index })
      : api().delete(`/api/forum/comments/${comment.id}`).set(...auth(user));
    for (let index = 0; index < limit; index++) await call(index).expect(200);
    const result = await denied(call(limit), 429); expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('limits ADMIN mutations and records an idempotent direct hide only once', async () => {
    const owner = await actor(), admin = await actor(true), row = await post(owner);
    const call = () => api().post(`/api/forum/admin/posts/${row.id}/hide`).set(...auth(admin)).send({ note: 'Same moderation fixture' });
    for (let index = 0; index < 30; index++) await call().expect(200);
    await denied(call(), 429);
    expect(await db.forumModerationAction.count({ where: { postId: row.id } })).toBe(1);
  });
  it('bounds moderation workload across distinct report targets, not just duplicate reports', async () => {
    const owner = await actor(), reporter = await actor();
    const targets = await Promise.all(Array.from({ length: 4 }, () => post(owner)));
    for (const target of targets.slice(0, 3)) await api().post(`/api/forum/posts/${target.id}/reports`).set(...auth(reporter)).send({ reason: 'SPAM' }).expect(200);
    await denied(api().post(`/api/forum/posts/${targets[3].id}/reports`).set(...auth(reporter)).send({ reason: 'SPAM' }), 429);
    expect(await db.report.count({ where: { userId: reporter.id } })).toBe(3);
    expect(await db.forumModerationAction.count({ where: { postId: { in: targets.map(target => target.id) } } })).toBe(0);
  });
  it('rechecks ADMIN role after an already-started write waits for a concurrent demotion', async () => {
    const owner = await actor(), admin = await actor(true), row = await post(owner);
    const before = await forumState();
    let pending!: Promise<request.Response>;
    await db.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.user.update({ where: { id: admin.id }, data: { accountType: 'USER' } });
      pending = api().post(`/api/forum/admin/posts/${row.id}/hide`).set(...auth(admin)).send({ note: 'Cannot retain revoked privilege' }).then(result => result);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [{ count }] = await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity a WHERE a.datname=current_database() AND ${pid}::int=ANY(pg_blocking_pids(a.pid))`;
        if (count) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    });
    const result = await pending; expect(result.status).toBe(403); expect(result.body.error.code).toBe('FORBIDDEN');
    expect(await forumState()).toBe(before);
  });
  it('charges authenticated write attempts before missing comment/report target lookups', async () => {
    const user = await actor();
    for (let index = 0; index < 10; index++) await api().delete(`/api/forum/comments/${randomUUID()}`).set(...auth(user)).expect(404);
    await denied(api(peer).delete(`/api/forum/comments/${randomUUID()}`).set(...auth(user)), 429);
    for (let index = 0; index < 3; index++) await api().post(`/api/forum/comments/${randomUUID()}/reports`).set(...auth(user)).send({ reason: 'SPAM' }).expect(404);
    await denied(api(peer).post(`/api/forum/comments/${randomUUID()}/reports`).set(...auth(user)).send({ reason: 'SPAM' }), 429);
  });
  it('rejects forged ownership, report state and audit actors on every body-bearing mutation family', async () => {
    const target = await targets(), admin = await actor(true), forged = randomUUID();
    await denied(api().patch(`/api/forum/posts/${target.row.id}`).set(...auth(target.owner)).send({ content: 'x', userId: forged, createdAt: new Date().toISOString() }), 422);
    await denied(api().post(`/api/forum/posts/${target.row.id}/comments`).set(...auth(target.owner)).send({ content: 'x', authorId: forged }), 422);
    await denied(api().patch(`/api/forum/comments/${target.comment.id}`).set(...auth(target.owner)).send({ content: 'x', userId: forged }), 422);
    for (const path of [`/api/forum/posts/${target.row.id}/reports`, `/api/forum/comments/${target.comment.id}/reports`]) await denied(api().post(path).set(...auth(target.owner)).send({ reason: 'SPAM', userId: forged, targetType: 'MESSAGE', targetId: forged, status: 'RESOLVED' }), 422);
    await denied(api().patch(`/api/forum/admin/reports/${target.report.id}`).set(...auth(admin)).send({ status: 'RESOLVED', note: 'fixture', actorId: forged }), 422);
    for (const path of [`/api/forum/admin/posts/${target.row.id}/hide`, `/api/forum/admin/comments/${target.comment.id}/hide`]) await denied(api().post(path).set(...auth(admin)).send({ note: 'fixture', approvedBy: forged, deletedBy: forged }), 422);
  });
  it('resolves comment targets on the held transaction connection instead of starving a bounded pool', async () => {
    const connectionString = app.get(ConfigService).getOrThrow<string>('DATABASE_URL');
    const constrainedDb = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }) });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(constrainedDb).compile();
    const constrained = module.createNestApplication({ rawBody: true });
    try {
      configureApp(constrained); await constrained.init();
      expect(constrained.get(ConfigService).getOrThrow('DATABASE_URL')).toBe(connectionString);
      expect(await constrainedDb.$queryRaw`SELECT current_database() AS db,current_schema() AS schema`).toEqual([{ db: 'gomgoods_test', schema: 'public' }]);
      const targets = await Promise.all([targetsForPool(), targetsForPool()]);
      const results = await Promise.all(targets.map(target => api(constrained).delete(`/api/forum/comments/${target.comment.id}`).set(...auth(target.owner))));
      expect(results.map(result => result.status)).toEqual([200, 200]);
      for (const target of targets) expect((await db.comment.findUniqueOrThrow({ where: { id: target.comment.id } })).status).toBe('REMOVED');
    } finally { await constrained.close(); await constrainedDb.$disconnect(); }
    async function targetsForPool() {
      const owner = await actor(), row = await post(owner);
      const comment = await db.comment.create({ data: { userId: owner.id, postId: row.id, content: 'Pool fixture ' + randomUUID() } });
      return { owner, comment };
    }
  }, 10000);
});
