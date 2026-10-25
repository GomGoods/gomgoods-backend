import {
  validatePaymentEnvironment,
  type PaymentEnvironment,
} from './payments.environment.js';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type CookieSameSite = 'strict' | 'lax' | 'none';

export interface AppEnvironment extends PaymentEnvironment {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DATABASE_URL: string;
  APPLICATION_DATABASE_URL: string;
  TEST_DATABASE_URL?: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL: '15m';
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  AUTH_REFRESH_TTL_DAYS: 30;
  AUTH_REFRESH_GRACE_SECONDS: 10;
  AUTH_COOKIE_SECURE: boolean;
  AUTH_COOKIE_SAME_SITE: CookieSameSite;
  AUTH_COOKIE_DOMAIN?: string;
  CORS_ORIGINS: string[];
  SWAGGER_ENABLED: boolean;
}

function databaseIdentity(value: string): string {
  const url = new URL(value);
  const hostname = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    url.hostname.toLowerCase(),
  )
    ? 'loopback'
    : url.hostname.toLowerCase();
  const port = url.port || '5432';
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  return `${hostname}:${port}/${database}`;
}

export function databaseTargetsMatch(left: string, right: string): boolean {
  return databaseIdentity(left) === databaseIdentity(right);
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

function booleanValue(
  environment: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = String(environment[key] ?? String(fallback));
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${key} must be true or false`);
  }
  return value === 'true';
}

function exactOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`CORS_ORIGINS contains an invalid origin: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
    throw new Error(`CORS_ORIGINS must contain exact HTTP(S) origins: ${value}`);
  }
  return url.origin;
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
    if (databaseTargetsMatch(testDatabaseUrl, applicationDatabaseUrl)) {
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

  const refreshTtlDays = Number(environment.AUTH_REFRESH_TTL_DAYS ?? 30);
  if (refreshTtlDays !== 30) {
    throw new Error('AUTH_REFRESH_TTL_DAYS must be 30');
  }

  const refreshGraceSeconds = Number(
    environment.AUTH_REFRESH_GRACE_SECONDS ?? 10,
  );
  if (refreshGraceSeconds !== 10) {
    throw new Error('AUTH_REFRESH_GRACE_SECONDS must be 10');
  }

  if (
    nodeEnvironment === 'production' &&
    environment.AUTH_COOKIE_SECURE === undefined
  ) {
    throw new Error('AUTH_COOKIE_SECURE is required in production');
  }
  if (
    nodeEnvironment === 'production' &&
    environment.AUTH_COOKIE_SAME_SITE === undefined
  ) {
    throw new Error('AUTH_COOKIE_SAME_SITE is required in production');
  }
  const cookieSecure = booleanValue(
    environment,
    'AUTH_COOKIE_SECURE',
    false,
  );
  const cookieSameSite = String(
    environment.AUTH_COOKIE_SAME_SITE ?? 'lax',
  ).toLowerCase();
  if (!['strict', 'lax', 'none'].includes(cookieSameSite)) {
    throw new Error('AUTH_COOKIE_SAME_SITE must be strict, lax, or none');
  }
  if (nodeEnvironment === 'production' && !cookieSecure) {
    throw new Error('AUTH_COOKIE_SECURE must be true in production');
  }
  if (cookieSameSite === 'none' && !cookieSecure) {
    throw new Error('AUTH_COOKIE_SECURE must be true with SameSite=None');
  }
  const cookieDomainValue = environment.AUTH_COOKIE_DOMAIN;
  const cookieDomain =
    typeof cookieDomainValue === 'string' && cookieDomainValue.trim() !== ''
      ? cookieDomainValue.trim()
      : undefined;
  if (cookieDomain && !/^\.?[A-Za-z0-9.-]+$/.test(cookieDomain)) {
    throw new Error('AUTH_COOKIE_DOMAIN must be a hostname');
  }

  const corsOrigins = requiredString(environment, 'CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(exactOrigin);
  if (corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin');
  }
  if (corsOrigins.includes('*')) {
    throw new Error('CORS_ORIGINS cannot contain * with credentials');
  }

  const swaggerValue = String(environment.SWAGGER_ENABLED ?? 'false');
  if (!['true', 'false'].includes(swaggerValue)) {
    throw new Error('SWAGGER_ENABLED must be true or false');
  }

  return {
    ...validatePaymentEnvironment(
      environment,
      nodeEnvironment,
      nodeEnvironment === 'test' ? testDatabaseUrl! : applicationDatabaseUrl,
    ),
    NODE_ENV: nodeEnvironment,
    PORT: port,
    DATABASE_URL:
      nodeEnvironment === 'test' ? testDatabaseUrl! : applicationDatabaseUrl,
    APPLICATION_DATABASE_URL: applicationDatabaseUrl,
    TEST_DATABASE_URL: testDatabaseUrl,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_ACCESS_TTL: '15m',
    JWT_ISSUER: requiredString(environment, 'JWT_ISSUER'),
    JWT_AUDIENCE: requiredString(environment, 'JWT_AUDIENCE'),
    AUTH_REFRESH_TTL_DAYS: 30,
    AUTH_REFRESH_GRACE_SECONDS: 10,
    AUTH_COOKIE_SECURE: cookieSecure,
    AUTH_COOKIE_SAME_SITE: cookieSameSite as CookieSameSite,
    AUTH_COOKIE_DOMAIN: cookieDomain,
    CORS_ORIGINS: corsOrigins,
    SWAGGER_ENABLED: swaggerValue === 'true',
  };
}
