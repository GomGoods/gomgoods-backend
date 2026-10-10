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
  it('parses the approved Phase 1 defaults', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      NODE_ENV: 'test',
      PORT: 3000,
      JWT_ACCESS_TTL: '15m',
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

  it('rejects short access-token secrets', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'too-short',
      }),
    ).toThrow('JWT_ACCESS_SECRET');
  });
});
