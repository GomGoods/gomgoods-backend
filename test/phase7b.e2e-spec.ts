import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AccessTokenService } from '../src/modules/auth/access-token.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './helpers/create-test-app.js';

describe('Phase 7B forum HTTP/PostgreSQL contracts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const topicIds: string[] = [];
  let before: string;
  const topicId = '00000000-0000-4000-8000-000000007001';
  const api = () => request(app.getHttpServer());
  async function protectedState() {
    const rows = [];
    for (const table of ['CATEGORY','LISTING','PRODUCT','STORE','ORDER','ORDER_ITEM','CHECKOUT_GROUP','PAYMENT','PAYMENT_EVENT','TRANSACTION','SHIPMENT','SHIPMENT_ITEM','CONVERSATION','CONVERSATION_PARTICIPANT','MESSAGE']) rows.push(await prisma.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS data FROM "${table}" t ORDER BY to_jsonb(t)::text`));
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  beforeAll(async () => {
    app = await createTestApp(); prisma = app.get(PrismaService);
    const target = new URL(app.get(ConfigService).getOrThrow<string>('DATABASE_URL'));
    expect(['127.0.0.1','localhost']).toContain(target.hostname); expect(target.port).toBe('55432'); expect(target.pathname).toBe('/gomgoods_test');
    expect(await prisma.$queryRaw`SELECT current_database() AS db,current_schema() AS schema`).toEqual([{ db: 'gomgoods_test', schema: 'public' }]);
    expect(await prisma.category.count()).toBe(40); before = await protectedState();
  });
  afterAll(async () => {
    if (!app) return;
    try {
      await prisma.forumModerationAction.deleteMany({ where: { post: { userId: { in: userIds } } } });
      await prisma.report.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.post.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.forumTopic.deleteMany({ where: { id: { in: topicIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      expect(await protectedState()).toBe(before);
      expect(await prisma.user.count({ where: { id: { in: userIds } } })).toBe(0);
    } finally { await app.close(); }
  });
  async function actor(admin = false) {
    const id = randomUUID(); userIds.push(id);
    await prisma.user.create({ data: { id, email: `${id}@forum.e2e.gomgoods.local`, username: `f_${id.slice(0, 24)}`, passwordHash: 'unused-forum-fixture', accountType: admin ? 'ADMIN' : 'USER' } });
    const session = await prisma.authSession.create({ data: { userId: id, expiresAt: new Date(Date.now() + 3600000) } });
    const signed = await app.get(AccessTokenService).sign({ sub: id, sid: session.id, accountType: admin ? 'ADMIN' : 'USER' });
    return { id, token: signed.accessToken, sessionId: session.id };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const bearer = (user: Actor) => ['Authorization', 'Bearer ' + user.token] as const;
  async function post(user: Actor, extra: Record<string, unknown> = {}) {
    return (await api().post('/api/forum/posts').set(...bearer(user)).send({ title: 'Fixture ' + randomUUID(), content: 'Nội dung diễn đàn 😀', topicId, ...extra }).expect(201)).body.data;
  }
  it('keeps popular pagination stable when likes change between pages', async () => {
    const author = await actor(), liker = await actor(), later = await actor();
    const create = async (title: string) => (await api().post('/api/forum/posts').auth(author.token, { type: 'bearer' }).send({ title, content: title, topicId }).expect(201)).body.data.id as string;
    const first = await create('rank ' + randomUUID()), second = await create('rank ' + randomUUID());
    await api().put(`/api/forum/posts/${first}/like`).auth(liker.token, { type: 'bearer' }).expect(200);
    const query = `/api/forum/posts?sort=popular&limit=1&q=rank`;
    const page = await api().get(query).expect(200);
    expect(page.body.data.items[0].id).toBe(first);
    await api().put(`/api/forum/posts/${second}/like`).auth(liker.token, { type: 'bearer' }).expect(200);
    await api().put(`/api/forum/posts/${second}/like`).auth(later.token, { type: 'bearer' }).expect(200);
    const next = await api().get(query + '&cursor=' + page.body.data.nextCursor).expect(200);
    expect(next.body.data.items[0].id).toBe(second);
  });
  it('creates a plain-text post and returns it through the public feed without private user fields', async () => {
    const user = await actor();
    const content = '  Tiếng Việt 👩🏽‍💻 🇻🇳\r\ne\u0301 <script>alert(1)</script>  ';
    const created = await api().post('/api/forum/posts').auth(user.token, { type: 'bearer' }).send({ title: 'Bộ sưu tập', content, topicId }).expect(201);
    expect(created.body.data.content).toBe(content);
    const feed = await api().get('/api/forum/posts').expect(200);
    expect(feed.body.data.items.some((post: { id: string }) => post.id === created.body.data.id)).toBe(true);
    expect(JSON.stringify(feed.body)).not.toMatch(/email|password|refresh|phone|sessionId/);
  });

  it('keeps edits private to the author and does not publish a draft through a partial update', async () => {
    const owner = await actor(), other = await actor(), admin = await actor(true);
    const row = await post(owner, { status: 'DRAFT' });
    await api().get(`/api/forum/posts/${row.id}`).expect(404);
    const edited = await api().patch(`/api/forum/posts/${row.id}`).set(...bearer(owner)).send({ title: 'Tên đã sửa' }).expect(200);
    expect(edited.body.data.status).toBe('DRAFT');
    for (const user of [other, admin]) {
      await api().patch(`/api/forum/posts/${row.id}`).set(...bearer(user)).send({ content: 'IDOR' }).expect(404);
      await api().delete(`/api/forum/posts/${row.id}`).set(...bearer(user)).expect(404);
    }
    await api().patch(`/api/forum/posts/${row.id}`).set(...bearer(owner)).send({ status: 'PUBLISHED' }).expect(200);
    await api().get(`/api/forum/posts/${row.id}`).expect(200);
    await api().delete(`/api/forum/posts/${row.id}`).set(...bearer(owner)).expect(200);
    await api().delete(`/api/forum/posts/${row.id}`).set(...bearer(owner)).expect(200);
    await api().patch(`/api/forum/posts/${row.id}`).set(...bearer(owner)).send({ status: 'PUBLISHED' }).expect(409);
    const mine = await api().get('/api/forum/me/posts').set(...bearer(owner)).expect(200);
    expect(mine.body.data.items[0]).toMatchObject({ id: row.id, status: 'REMOVED' });
    expect(mine.body.data.items[0].deletedAt).toMatch(/Z$/);
    expect((await api().get('/api/forum/me/posts').set(...bearer(other)).expect(200)).body.data.items).toEqual([]);
  });

  it('validates Unicode limits, rejects unknown/null fields, and never interprets HTML', async () => {
    const user = await actor();
    for (const input of [
      { title: '' }, { title: ' \n' }, { title: '😀'.repeat(251) }, { content: 'x'.repeat(10001) },
      { content: '\u0000' }, { content: '\ud800' }, { content: null }, { topicId: null },
      { topicId: 'not-uuid' }, { status: 'HIDDEN' }, { status: null }, { userId: user.id },
    ]) await api().post('/api/forum/posts').set(...bearer(user)).send({ title: 'Bài viết', content: 'Nội dung', topicId, ...input }).expect(422);
    const row = await post(user, { title: '😀'.repeat(250), content: '<script>plain text</script>\r\nTiếng Việt' });
    expect(row.title).toBe('😀'.repeat(250));
    for (const input of [{ title: null }, { status: null }, { deletedAt: new Date().toISOString() }]) await api().patch(`/api/forum/posts/${row.id}`).set(...bearer(user)).send(input).expect(422);
    await api().get('/api/forum/posts?limit=51').expect(422);
    await api().get('/api/forum/posts?limit=0').expect(422);
    await api().get('/api/forum/posts?sort=unknown').expect(422);
    await api().get('/api/forum/posts?cursor=not-json').expect(422);
  });

  it('paginates exact topic/search matches with deterministic ties and query-bound cursors', async () => {
    const owner = await actor(); const q = 'literal%_' + randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    for (const id of ids) await prisma.post.create({ data: { id, userId: owner.id, title: q, content: q, topicId, status: 'PUBLISHED', createdAt: new Date('2026-01-01T00:00:00.000Z') } });
    const first = await api().get('/api/forum/posts').query({ q, topic: 'general', limit: 2 }).expect(200);
    expect(first.body.data.items.map((item: { id: string }) => item.id)).toEqual(ids.toReversed().slice(0, 2));
    const next = await api().get('/api/forum/posts').query({ q, topic: 'general', limit: 2, cursor: first.body.data.nextCursor }).expect(200);
    expect(next.body.data.items.map((item: { id: string }) => item.id)).toEqual([ids[0]]);
    expect(next.body.data.nextCursor).toBeNull();
    await api().get('/api/forum/posts').query({ q: 'different', topic: 'general', cursor: first.body.data.nextCursor }).expect(422);
    expect((await api().get('/api/forum/posts').query({ q, topic: 'game' }).expect(200)).body.data.items).toEqual([]);
    const topic = await api().get('/api/forum/topics').expect(200);
    expect(topic.body.data).toHaveLength(6);
    expect(JSON.stringify(topic.body)).not.toMatch(/categoryId/);
  });

  it('supports one reply level, rejects cross-post/grandchild replies and hides children of deleted roots', async () => {
    const owner = await actor(), other = await actor(); const row = await post(owner), second = await post(owner);
    const root = (await api().post(`/api/forum/posts/${row.id}/comments`).set(...bearer(owner)).send({ content: 'Gốc 👨‍👩‍👧‍👦\r\n  ' }).expect(201)).body.data;
    const reply = (await api().post(`/api/forum/posts/${row.id}/comments`).set(...bearer(other)).send({ content: 'Trả lời', parentId: root.id }).expect(201)).body.data;
    await api().post(`/api/forum/posts/${row.id}/comments`).set(...bearer(other)).send({ content: 'Không cấp ba', parentId: reply.id }).expect(404);
    await api().post(`/api/forum/posts/${second.id}/comments`).set(...bearer(other)).send({ content: 'Khác bài', parentId: root.id }).expect(404);
    await api().post(`/api/forum/posts/${row.id}/comments`).set(...bearer(other)).send({ content: '😀'.repeat(2001) }).expect(422);
    await api().post(`/api/forum/posts/${row.id}/comments`).set(...bearer(other)).send({ content: 'x', parentId: null }).expect(422);
    await api().patch(`/api/forum/comments/${root.id}`).set(...bearer(other)).send({ content: 'IDOR' }).expect(404);
    await api().patch(`/api/forum/comments/${reply.id}`).set(...bearer(other)).send({ content: 'Đã sửa' }).expect(200);
    const page = await api().get(`/api/forum/posts/${row.id}/comments?limit=1`).expect(200);
    expect(page.body.data.items[0].id).toBe(root.id);
    const next = await api().get(`/api/forum/posts/${row.id}/comments`).query({ limit: 1, cursor: page.body.data.nextCursor }).expect(200);
    expect(next.body.data.items[0]).toMatchObject({ id: reply.id, parentId: root.id, content: 'Đã sửa' });
    await api().get(`/api/forum/posts/${second.id}/comments`).query({ cursor: page.body.data.nextCursor }).expect(422);
    await api().delete(`/api/forum/comments/${root.id}`).set(...bearer(other)).expect(404);
    await api().delete(`/api/forum/comments/${root.id}`).set(...bearer(owner)).expect(200);
    expect((await api().get(`/api/forum/posts/${row.id}/comments`).expect(200)).body.data.items).toEqual([]);
    await api().post(`/api/forum/posts/${row.id}/comments`).set(...bearer(other)).send({ content: 'Không reply đã xóa', parentId: root.id }).expect(404);
    await api().delete(`/api/forum/comments/${reply.id}`).set(...bearer(other)).expect(200);
  });

  it('serializes concurrent likes/unlikes without duplicate rows, drift or duplicate history', async () => {
    const owner = await actor(), user = await actor(); const row = await post(owner);
    const results = await Promise.all(Array.from({ length: 12 }, () => api().put(`/api/forum/posts/${row.id}/like`).set(...bearer(user))));
    expect(results.every(result => result.status === 200 && result.body.data.likeCount === 1)).toBe(true);
    expect(await prisma.reaction.count({ where: { postId: row.id } })).toBe(1);
    expect(await prisma.forumLikeEvent.count({ where: { postId: row.id } })).toBe(1);
    const unlikes = await Promise.all(Array.from({ length: 12 }, () => api().delete(`/api/forum/posts/${row.id}/like`).set(...bearer(user))));
    expect(unlikes.every(result => result.status === 200 && result.body.data.likeCount === 0)).toBe(true);
    expect(await prisma.reaction.count({ where: { postId: row.id } })).toBe(0);
    expect(await prisma.forumLikeEvent.count({ where: { postId: row.id } })).toBe(2);
    expect((await api().get(`/api/forum/posts/${row.id}`).expect(200)).body.data.likeCount).toBe(0);
  });

  it('deduplicates reports and atomically moderates only forum targets with retained audit', async () => {
    const owner = await actor(), reporter = await actor(), admin = await actor(true); const row = await post(owner);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => api().post(`/api/forum/posts/${row.id}/reports`).set(...bearer(reporter)).send({ reason: 'SPAM', content: 'Nội dung spam' })));
    expect(attempts.every(result => result.status === 200)).toBe(true);
    expect(new Set(attempts.map(result => result.body.data.id)).size).toBe(1);
    const id = attempts[0].body.data.id;
    await api().get('/api/forum/admin/reports').set(...bearer(reporter)).expect(403);
    await api().patch(`/api/forum/admin/reports/${id}`).set(...bearer(reporter)).send({ status: 'RESOLVED', action: 'HIDE', note: 'Không quyền' }).expect(403);
    const foreign = await prisma.report.create({ data: { userId: reporter.id, targetType: 'MESSAGE', targetId: randomUUID(), reason: 'non-forum fixture' } });
    const list = await api().get('/api/forum/admin/reports').set(...bearer(admin)).expect(200);
    expect(list.body.data.items.some((item: { id: string }) => item.id === foreign.id)).toBe(false);
    expect(JSON.stringify(list.body)).not.toMatch(/email|password|phone|refresh|token|session/);
    await api().patch(`/api/forum/admin/reports/${foreign.id}`).set(...bearer(admin)).send({ status: 'RESOLVED', note: 'Ngoài forum' }).expect(404);
    await api().patch(`/api/forum/admin/reports/${id}`).set(...bearer(admin)).send({ status: 'IN_REVIEW', note: 'Đang kiểm tra' }).expect(200);
    await api().patch(`/api/forum/admin/reports/${id}`).set(...bearer(admin)).send({ status: 'REJECTED', action: 'HIDE', note: 'Sai transition' }).expect(409);
    const reviews = await Promise.all([1, 2].map(() => api().patch(`/api/forum/admin/reports/${id}`).set(...bearer(admin)).send({ status: 'RESOLVED', action: 'HIDE', note: 'Vi phạm spam' })));
    expect(reviews.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await prisma.forumModerationAction.count({ where: { reportId: id } })).toBe(2);
    expect(await prisma.forumModerationAction.count({ where: { postId: row.id, action: 'HIDE_POST' } })).toBe(1);
    await api().get(`/api/forum/admin/posts/${row.id}/moderation-actions`).set(...bearer(owner)).expect(403);
    const history = await api().get(`/api/forum/admin/posts/${row.id}/moderation-actions?limit=1`).set(...bearer(admin)).expect(200);
    expect(history.body.data.items).toHaveLength(1); expect(history.body.data.nextCursor).toBeTruthy();
    expect(JSON.stringify(history.body)).not.toMatch(/email|password|phone|token/);
    await api().get(`/api/forum/posts/${row.id}`).expect(404);
    await api().put(`/api/forum/posts/${row.id}/like`).set(...bearer(reporter)).expect(404);
    await api().post(`/api/forum/posts/${row.id}/comments`).set(...bearer(reporter)).send({ content: 'Không cho comment' }).expect(404);
    await api().patch(`/api/forum/posts/${row.id}`).set(...bearer(owner)).send({ status: 'PUBLISHED' }).expect(409);
    const mine = await api().get('/api/forum/me/posts').set(...bearer(owner)).expect(200);
    expect(mine.body.data.items[0]).toMatchObject({ id: row.id, status: 'HIDDEN', deletedAt: null });
    await api().delete(`/api/forum/posts/${row.id}`).set(...bearer(owner)).expect(200);
    expect(await prisma.post.findUnique({ where: { id: row.id }, select: { status: true } })).toEqual({ status: 'REMOVED' });
  });

  it('hides reported comments without deleting content and rejects reply/report on hidden roots', async () => {
    const owner = await actor(), reporter = await actor(), admin = await actor(true); const row = await post(owner);
    const root = (await api().post(`/api/forum/posts/${row.id}/comments`).set(...bearer(owner)).send({ content: 'Bình luận vi phạm' }).expect(201)).body.data;
    const report = (await api().post(`/api/forum/comments/${root.id}/reports`).set(...bearer(reporter)).send({ reason: 'HARASSMENT' }).expect(200)).body.data;
    await api().patch(`/api/forum/admin/reports/${report.id}`).set(...bearer(admin)).send({ status: 'RESOLVED', action: 'HIDE', note: 'Vi phạm quy tắc' }).expect(200);
    expect((await api().get(`/api/forum/posts/${row.id}/comments`).expect(200)).body.data.items).toEqual([]);
    expect((await api().get(`/api/forum/posts/${row.id}`).expect(200)).body.data.commentCount).toBe(0);
    await api().post(`/api/forum/posts/${row.id}/comments`).set(...bearer(reporter)).send({ content: 'Không reply', parentId: root.id }).expect(404);
    await api().post(`/api/forum/comments/${root.id}/reports`).set(...bearer(reporter)).send({ reason: 'SPAM' }).expect(404);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: root.id } })).content).toBe('Bình luận vi phạm');
  });

  it('protects anonymous/session/account access and excludes disabled authors from public queries', async () => {
    await api().post('/api/forum/posts').send({ title: 'x', content: 'x', topicId }).expect(401);
    await api().get('/api/forum/me/posts').expect(401);
    const owner = await actor(), admin = await actor(true); const row = await post(owner);
    await prisma.user.update({ where: { id: owner.id }, data: { status: 'SUSPENDED' } });
    await api().patch(`/api/forum/posts/${row.id}`).set(...bearer(owner)).send({ title: 'Không quyền' }).expect(403);
    await api().get(`/api/forum/posts/${row.id}`).expect(404);
    await api().put(`/api/forum/posts/${row.id}/like`).set(...bearer(admin)).expect(404);
    await prisma.user.update({ where: { id: owner.id }, data: { status: 'DELETED' } });
    await api().put(`/api/forum/posts/${row.id}/like`).set(...bearer(owner)).expect(403);
    await prisma.authSession.update({ where: { id: admin.sessionId }, data: { revokedAt: new Date(), revocationReason: 'LOGOUT' } });
    await api().get('/api/forum/admin/reports').set(...bearer(admin)).expect(401);
  });

  it('enforces database reply depth, immutable identity, report uniqueness and real target foreign keys', async () => {
    const owner = await actor(), reporter = await actor(); const row = await post(owner);
    const root = await prisma.comment.create({ data: { postId: row.id, userId: owner.id, content: 'root' } });
    const reply = await prisma.comment.create({ data: { postId: row.id, userId: owner.id, content: 'reply', parentId: root.id } });
    await expect(prisma.comment.create({ data: { postId: row.id, userId: owner.id, content: 'grandchild', parentId: reply.id } })).rejects.toThrow();
    await expect(prisma.post.update({ where: { id: row.id }, data: { userId: reporter.id } })).rejects.toThrow();
    const report = { userId: reporter.id, targetType: 'POST' as const, targetId: row.id, postId: row.id, reason: 'SPAM' };
    await prisma.report.create({ data: report });
    await expect(prisma.report.create({ data: report })).rejects.toMatchObject({ code: 'P2002' });
    const absent = randomUUID();
    await expect(prisma.report.create({ data: { ...report, targetId: absent, postId: absent } })).rejects.toThrow();
    await expect(prisma.post.create({ data: { userId: owner.id, topicId, title: 'x', content: '  ' } })).rejects.toThrow();
  });

  it('serializes edit/delete and like/delete races without reopening or orphaning content', async () => {
    const owner = await actor(), other = await actor(); const row = await post(owner);
    const responses = await Promise.all([
      api().patch(`/api/forum/posts/${row.id}`).set(...bearer(owner)).send({ content: 'Edit đua' }),
      api().delete(`/api/forum/posts/${row.id}`).set(...bearer(owner)),
      api().put(`/api/forum/posts/${row.id}/like`).set(...bearer(other)),
    ]);
    expect([200, 409]).toContain(responses[0].status); expect(responses[1].status).toBe(200); expect([200, 404]).toContain(responses[2].status);
    await api().get(`/api/forum/posts/${row.id}`).expect(404);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('REMOVED');
  });

  it('rejects inactive/missing topics and rate-limits authenticated post spam', async () => {
    const owner = await actor(); const inactive = randomUUID(); topicIds.push(inactive);
    await prisma.forumTopic.create({ data: { id: inactive, slug: 'inactive-' + inactive, name: 'Inactive fixture', active: false } });
    for (const topic of [inactive, randomUUID()]) await api().post('/api/forum/posts').set(...bearer(owner)).send({ title: 'x', content: 'x', topicId: topic }).expect(404);
    for (let i = 0; i < 3; i++) await post(owner);
    await api().post('/api/forum/posts').set(...bearer(owner)).send({ title: 'spam', content: 'spam', topicId }).expect(429);
  });

  it('rechecks related visibility after a concurrent author-status transaction commits', async () => {
    const owner = await actor(), liker = await actor(); const row = await post(owner);
    let pending!: Promise<request.Response>;
    await prisma.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.user.update({ where: { id: owner.id }, data: { status: 'SUSPENDED' } });
      pending = api().put(`/api/forum/posts/${row.id}/like`).set(...bearer(liker)).then(response => response);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity a WHERE a.datname=current_database() AND ${pid}::int=ANY(pg_blocking_pids(a.pid))`;
        if (count > 0) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    });
    expect((await pending).status).toBe(404);
    expect(await prisma.reaction.count({ where: { postId: row.id } })).toBe(0);
  });

  it('applies the existing IP guard to anonymous public reads', async () => {
    const codes = [];
    for (let i = 0; i < 101; i++) codes.push((await api().get('/api/forum/topics')).status);
    expect(codes).toContain(429);
  });
});
