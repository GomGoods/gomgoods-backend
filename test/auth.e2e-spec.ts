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

describe('Phase 1 API (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  const user = {
    email: 'phase1-auth@e2e.gomgoods.local',
    username: 'phase1_auth',
    password: 'correct-horse-battery',
  };

  beforeAll(async () => {
    app = await createTestApp();
    await cleanE2eUsers(app);
  });

  afterAll(async () => {
    if (app) {
      await cleanE2eUsers(app);
      await app.close();
    }
  });

  it('reports application and database readiness', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { status: 'ok', database: 'available' },
    });
  });

  it('rejects an invalid registration body with the standard envelope', async () => {
    const response = await authPost(app, '/api/auth/register')
      .send({ email: 'not-an-email', username: 'x', password: 'short' })
      .expect(422);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('registers a user and automatically issues a 15-minute access token', async () => {
    const response = await authPost(app, '/api/auth/register')
      .send(user)
      .expect(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        user: {
          email: user.email,
          username: user.username,
          accountType: 'USER',
          status: 'ACTIVE',
        },
        expiresIn: 900,
      },
    });
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    accessToken = response.body.data.accessToken;
  });

  it('returns a conflict for a duplicate email', async () => {
    const response = await authPost(app, '/api/auth/register')
      .send({ ...user, username: 'another_name' })
      .expect(409);
    expect(response.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('returns a conflict for a duplicate username', async () => {
    const response = await authPost(app, '/api/auth/register')
      .send({ ...user, email: 'another@e2e.gomgoods.local' })
      .expect(409);
    expect(response.body.error.code).toBe('USERNAME_ALREADY_EXISTS');
  });

  it('returns a generic error for invalid login credentials', async () => {
    const response = await authPost(app, '/api/auth/login')
      .send({ email: user.email, password: 'incorrect-password' })
      .expect(401);
    expect(response.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('logs in with email and password', async () => {
    const response = await authPost(app, '/api/auth/login')
      .send({ email: user.email.toUpperCase(), password: user.password })
      .expect(200);
    expect(response.body.data.expiresIn).toBe(900);
    accessToken = response.body.data.accessToken;
  });

  it('returns the current user for a valid Bearer token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(response.body.data).toMatchObject({
      email: user.email,
      username: user.username,
    });
    expect(response.body.data).not.toHaveProperty('passwordHash');
  });

  it('rejects a missing access token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects a malformed access token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('rejects a suspended account even with a previously issued token', async () => {
    await app.get(PrismaService).user.update({
      where: { email: user.email },
      data: { status: UserStatus.SUSPENDED },
    });
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(response.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('rejects a deleted account even with a previously issued token', async () => {
    await app.get(PrismaService).user.update({
      where: { email: user.email },
      data: { status: UserStatus.DELETED },
    });
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(response.body.error.code).toBe('ACCOUNT_DELETED');
  });

  it('rate limits repeated login attempts', async () => {
    let response: request.Response | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await authPost(app, '/api/auth/login')
        .send({
          email: 'rate-limit-missing@e2e.gomgoods.local',
          password: 'incorrect-password',
        });
      if (response.status === 429) break;
    }
    expect(response?.status).toBe(429);
    expect(response?.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
