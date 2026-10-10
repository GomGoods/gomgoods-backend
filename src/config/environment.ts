export type NodeEnvironment = 'development' | 'test' | 'production';

export interface AppEnvironment {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DATABASE_URL: string;
  TEST_DATABASE_URL?: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL: '15m';
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  CORS_ORIGINS: string[];
  SWAGGER_ENABLED: boolean;
}

function requiredString(
  environment: Record<string, unknown>,
  key: string,
): string {
  const value = environment[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function postgresUrl(value: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid PostgreSQL URL`);
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(`${key} must be a PostgreSQL URL`);
  }
  return value;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): AppEnvironment {
  const rawNodeEnvironment = String(environment.NODE_ENV ?? 'development');
  if (!['development', 'test', 'production'].includes(rawNodeEnvironment)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const nodeEnvironment = rawNodeEnvironment as NodeEnvironment;

  const port = Number(environment.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const applicationDatabaseUrl = postgresUrl(
    requiredString(environment, 'DATABASE_URL'),
    'DATABASE_URL',
  );
  const testDatabaseValue = environment.TEST_DATABASE_URL;
  const testDatabaseUrl =
    typeof testDatabaseValue === 'string' && testDatabaseValue.trim() !== ''
      ? postgresUrl(testDatabaseValue.trim(), 'TEST_DATABASE_URL')
      : undefined;

  if (nodeEnvironment === 'test') {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required when NODE_ENV is test');
    }
    if (testDatabaseUrl === applicationDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL must not match DATABASE_URL');
    }
    const testDatabaseName = new URL(testDatabaseUrl).pathname.toLowerCase();
    if (!testDatabaseName.includes('test')) {
      throw new Error('TEST_DATABASE_URL database name must include "test"');
    }
  }

  const jwtAccessSecret = requiredString(environment, 'JWT_ACCESS_SECRET');
  if (jwtAccessSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters');
  }

  const jwtAccessTtl = String(environment.JWT_ACCESS_TTL ?? '15m');
  if (jwtAccessTtl !== '15m') {
    throw new Error('JWT_ACCESS_TTL must be 15m in Phase 1');
  }

  const corsOrigins = requiredString(environment, 'CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin');
  }
  if (nodeEnvironment === 'production' && corsOrigins.includes('*')) {
    throw new Error('CORS_ORIGINS cannot contain * in production');
  }

  const swaggerValue = String(environment.SWAGGER_ENABLED ?? 'false');
  if (!['true', 'false'].includes(swaggerValue)) {
    throw new Error('SWAGGER_ENABLED must be true or false');
  }

  return {
    NODE_ENV: nodeEnvironment,
    PORT: port,
    DATABASE_URL:
      nodeEnvironment === 'test' ? testDatabaseUrl! : applicationDatabaseUrl,
    TEST_DATABASE_URL: testDatabaseUrl,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_ACCESS_TTL: '15m',
    JWT_ISSUER: requiredString(environment, 'JWT_ISSUER'),
    JWT_AUDIENCE: requiredString(environment, 'JWT_AUDIENCE'),
    CORS_ORIGINS: corsOrigins,
    SWAGGER_ENABLED: swaggerValue === 'true',
  };
}
