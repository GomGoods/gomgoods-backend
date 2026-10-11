import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { UserStatus } from '../src/generated/prisma/enums.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { cleanE2eUsers, createTestApp } from './helpers/create-test-app.js';

const testOrigin = 'http://localhost:3001';

function authPost(app: INestApplication, path: string) {
  return request(app.getHttpServer())
    .post(path)
    .set('Origin', testOrigin)
    .set('X-GomGoods-CSRF', '1');
}

function cookieFrom(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('Expected a Set-Cookie header');
  return value.split(';')[0];
}

function rawToken(cookie: string): string {
  return decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
}

function tokenIdentity(cookie: string) {
  const [sessionId, generation] = rawToken(cookie).split('.');
  return { sessionId, generation: Number(generation) };
}

describe('Phase 2 authentication sessions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let refreshCookie: string;
  const user = {
    email: 'phase2-session@e2e.gomgoods.local',
    username: 'phase2_session',
    password: 'correct-horse-battery',
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanE2eUsers(app);
  });

  afterAll(async () => {
    if (app) {
      await cleanE2eUsers(app);
      await app.close();
    }
  });

  it('registers with a session-bound access token and protected refresh cookie', async () => {
    const response = await authPost(app, '/api/auth/register')
      .send(user)
      .expect(201);

    accessToken = response.body.data.accessToken;
    refreshCookie = cookieFrom(response);
    const setCookie = response.headers['set-cookie'][0] as string;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/api/auth');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('Secure');
    expect(response.body.data).not.toHaveProperty('refreshToken');
  });

  it('enforces exact-origin CSRF protection', async () => {
    const missingHeader = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', testOrigin)
      .set('Cookie', refreshCookie)
      .expect(403);
    expect(missingHeader.body.error.code).toBe('CSRF_VALIDATION_FAILED');

    const untrustedOrigin = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', 'https://attacker.example')
      .set('X-GomGoods-CSRF', '1')
      .set('Cookie', refreshCookie)
      .expect(403);
    expect(untrustedOrigin.body.error.code).toBe('CSRF_VALIDATION_FAILED');
  });

  it('rotates once and treats an immediate duplicate as concurrency without clearing cookies', async () => {
    const originalCookie = refreshCookie;
    const rotated = await authPost(app, '/api/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(200);
    refreshCookie = cookieFrom(rotated);
    accessToken = rotated.body.data.accessToken;

    const duplicate = await authPost(app, '/api/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(409);
    expect(duplicate.body.error.code).toBe('REFRESH_ALREADY_ROTATED');
    expect(duplicate.headers['set-cookie']).toBeUndefined();
  });

  it('allows exactly one concurrent rotation and makes response ordering cookie-safe', async () => {
    const sharedCookie = refreshCookie;
    const responses = await Promise.all([
      authPost(app, '/api/auth/refresh').set('Cookie', sharedCookie),
      authPost(app, '/api/auth/refresh').set('Cookie', sharedCookie),
    ]);
    const success = responses.find((response) => response.status === 200);
    const duplicate = responses.find((response) => response.status === 409);

    expect(success).toBeDefined();
    expect(duplicate?.body.error.code).toBe('REFRESH_ALREADY_ROTATED');
    expect(duplicate?.headers['set-cookie']).toBeUndefined();

    refreshCookie = cookieFrom(success!);
    accessToken = success!.body.data.accessToken;
  });

  it('classifies a delayed duplicate inside grace as concurrency, then persists revocation for confirmed replay', async () => {
    const replayCookie = refreshCookie;
    const rotated = await authPost(app, '/api/auth/refresh')
      .set('Cookie', replayCookie)
      .expect(200);
    refreshCookie = cookieFrom(rotated);
    accessToken = rotated.body.data.accessToken;
    const identity = tokenIdentity(replayCookie);

    await prisma.refreshCredential.update({
      where: { sessionId_generation: identity },
      data: { usedAt: new Date(Date.now() - 9_000) },
    });
    await authPost(app, '/api/auth/refresh')
      .set('Cookie', replayCookie)
      .expect(409);

    await prisma.refreshCredential.update({
      where: { sessionId_generation: identity },
      data: { usedAt: new Date(Date.now() - 11_000) },
    });
    const replay = await authPost(app, '/api/auth/refresh')
      .set('Cookie', replayCookie)
      .expect(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    const persisted = await prisma.authSession.findUniqueOrThrow({
      where: { id: identity.sessionId },
    });
    expect(persisted.revokedAt).toBeInstanceOf(Date);
    expect(persisted.revocationReason).toBe('REPLAY_DETECTED');

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('revokes current logout idempotently and clears the cookie', async () => {
    const login = await authPost(app, '/api/auth/login').send({
      email: user.email,
      password: user.password,
    });
    const cookie = cookieFrom(login);
    const token = login.body.data.accessToken as string;
    const { sessionId } = tokenIdentity(cookie);

    const logout = await authPost(app, '/api/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    expect(logout.headers['set-cookie'][0]).toContain('gomgoods_refresh=;');
    await authPost(app, '/api/auth/logout').set('Cookie', cookie).expect(204);

    await expect(
      prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).resolves.toMatchObject({ revocationReason: 'LOGOUT' });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('logout-all revokes only the authenticated user sessions', async () => {
    const first = await authPost(app, '/api/auth/login').send({
      email: user.email,
      password: user.password,
    });
    const second = await authPost(app, '/api/auth/login').send({
      email: user.email,
      password: user.password,
    });
    const other = await authPost(app, '/api/auth/register').send({
      email: 'phase2-other@e2e.gomgoods.local',
      username: 'phase2_other',
      password: user.password,
    });
    const otherSessionId = tokenIdentity(cookieFrom(other)).sessionId;

    await authPost(app, '/api/auth/logout-all')
      .set('Authorization', `Bearer ${first.body.data.accessToken}`)
      .set('Cookie', cookieFrom(first))
      .expect(204);

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    const activeOwnerSessions = await prisma.authSession.count({
      where: { userId: owner.id, revokedAt: null },
    });
    expect(activeOwnerSessions).toBe(0);
    await expect(
      prisma.authSession.findUniqueOrThrow({ where: { id: otherSessionId } }),
    ).resolves.toMatchObject({ revokedAt: null });

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${second.body.data.accessToken}`)
      .expect(401);
  });

  it('commits account-status revocation before returning the refresh error', async () => {
    const account = await authPost(app, '/api/auth/register').send({
      email: 'phase2-suspended@e2e.gomgoods.local',
      username: 'phase2_suspended',
      password: user.password,
    });
    const cookie = cookieFrom(account);
    const { sessionId } = tokenIdentity(cookie);
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    await prisma.user.update({
      where: { id: session.userId },
      data: { status: UserStatus.SUSPENDED },
    });

    const response = await authPost(app, '/api/auth/refresh')
      .set('Cookie', cookie)
      .expect(403);
    expect(response.body.error.code).toBe('ACCOUNT_SUSPENDED');

    await expect(
      prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).resolves.toMatchObject({ revocationReason: 'ACCOUNT_SUSPENDED' });
  });

  it('revokes deleted-account sessions before returning the refresh error', async () => {
    const account = await authPost(app, '/api/auth/register').send({
      email: 'phase2-deleted@e2e.gomgoods.local',
      username: 'phase2_deleted',
      password: user.password,
    });
    const cookie = cookieFrom(account);
    const { sessionId } = tokenIdentity(cookie);
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    await prisma.user.update({
      where: { id: session.userId },
      data: { status: UserStatus.DELETED },
    });

    const response = await authPost(app, '/api/auth/refresh')
      .set('Cookie', cookie)
      .expect(403);
    expect(response.body.error.code).toBe('ACCOUNT_DELETED');
    await expect(
      prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).resolves.toMatchObject({ revocationReason: 'ACCOUNT_DELETED' });
  });

  it('returns a generic error for malformed refresh credentials', async () => {
    const response = await authPost(app, '/api/auth/refresh')
      .set('Cookie', 'gomgoods_refresh=malformed')
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    expect(JSON.stringify(response.body)).not.toContain('malformed');
  });

  it('rolls back credential consumption when successor creation fails', async () => {
    const account = await authPost(app, '/api/auth/register').send({
      email: 'phase2-rollback@e2e.gomgoods.local',
      username: 'phase2_rollback',
      password: user.password,
    });
    const cookie = cookieFrom(account);
    const identity = tokenIdentity(cookie);
    await prisma.refreshCredential.create({
      data: {
        sessionId: identity.sessionId,
        generation: 1,
        tokenHash: 'ab'.repeat(32),
      },
    });

    await authPost(app, '/api/auth/refresh')
      .set('Cookie', cookie)
      .expect(409);

    await expect(
      prisma.authSession.findUniqueOrThrow({
        where: { id: identity.sessionId },
      }),
    ).resolves.toMatchObject({ currentGeneration: 0, revokedAt: null });
    await expect(
      prisma.refreshCredential.findUniqueOrThrow({
        where: { sessionId_generation: identity },
      }),
    ).resolves.toMatchObject({ usedAt: null });
  });
});
