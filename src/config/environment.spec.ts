import { describe, expect, it } from 'vitest';

import { validateEnvironment } from './environment.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://gomgoods:gomgoods@localhost:5432/gomgoods',
  TEST_DATABASE_URL:
    'postgresql://gomgoods:gomgoods@localhost:5432/gomgoods_test',
  JWT_ACCESS_SECRET: 'a-development-only-secret-with-32-characters',
  JWT_ACCESS_TTL: '15m',
  JWT_ISSUER: 'gomgoods-api',
  JWT_AUDIENCE: 'gomgoods-frontend',
  CORS_ORIGINS: 'http://localhost:3001',
  SWAGGER_ENABLED: 'true',
};

describe('validateEnvironment', () => {
  it('parses the approved authentication defaults', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3000,
      JWT_ACCESS_TTL: '15m',
      AUTH_REFRESH_TTL_DAYS: 30,
      AUTH_REFRESH_GRACE_SECONDS: 10,
      AUTH_COOKIE_SECURE: false,
      AUTH_COOKIE_SAME_SITE: 'lax',
      CORS_ORIGINS: ['http://localhost:3001'],
      SWAGGER_ENABLED: true,
    });
  });

  it('rejects a test database that matches the application database', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        TEST_DATABASE_URL: validEnvironment.DATABASE_URL,
      }),
    ).toThrow('TEST_DATABASE_URL must not match DATABASE_URL');
  });

  it('rejects equivalent database identities despite URL spelling differences', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        DATABASE_URL:
          'postgresql://gomgoods:gomgoods@localhost:5432/gomgoods_test',
        TEST_DATABASE_URL:
          'postgresql://gomgoods:different@127.0.0.1/gomgoods_test?schema=other',
      }),
    ).toThrow('TEST_DATABASE_URL must not match DATABASE_URL');
  });

  it('rejects short access-token secrets', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'too-short',
      }),
    ).toThrow('JWT_ACCESS_SECRET');
  });

  it('requires secure cookies in production', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        AUTH_COOKIE_SECURE: 'false',
        AUTH_COOKIE_SAME_SITE: 'lax',
      }),
    ).toThrow('AUTH_COOKIE_SECURE must be true in production');
  });

  it('requires an explicit SameSite deployment decision in production', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        AUTH_COOKIE_SECURE: 'true',
      }),
    ).toThrow('AUTH_COOKIE_SAME_SITE is required in production');
  });

  it('requires secure cookies for a cross-site SameSite=None deployment', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        AUTH_COOKIE_SECURE: 'false',
        AUTH_COOKIE_SAME_SITE: 'none',
      }),
    ).toThrow('AUTH_COOKIE_SECURE must be true with SameSite=None');
  });
});
