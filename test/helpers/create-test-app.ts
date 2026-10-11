import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { databaseTargetsMatch } from '../../src/config/environment.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export async function createTestApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication();
  configureApp(app);
  await app.init();

  const config = app.get(ConfigService);
  const databaseUrl = config.getOrThrow<string>('DATABASE_URL');
  const testDatabaseUrl = config.getOrThrow<string>('TEST_DATABASE_URL');
  if (databaseUrl !== testDatabaseUrl) {
    await app.close();
    throw new Error('E2E application did not select TEST_DATABASE_URL');
  }
  if (!new URL(testDatabaseUrl).pathname.toLowerCase().includes('test')) {
    await app.close();
    throw new Error('E2E database name must contain "test"');
  }
  if (
    databaseTargetsMatch(
      config.getOrThrow<string>('APPLICATION_DATABASE_URL'),
      testDatabaseUrl,
    )
  ) {
    await app.close();
    throw new Error('TEST_DATABASE_URL must target a separate database');
  }
  return app;
}

export async function cleanE2eUsers(app: INestApplication): Promise<void> {
  const config = app.get(ConfigService);
  if (
    config.getOrThrow<string>('DATABASE_URL') !==
    config.getOrThrow<string>('TEST_DATABASE_URL')
  ) {
    throw new Error('Refusing e2e cleanup outside TEST_DATABASE_URL');
  }
  if (
    databaseTargetsMatch(
      config.getOrThrow<string>('APPLICATION_DATABASE_URL'),
      config.getOrThrow<string>('TEST_DATABASE_URL'),
    )
  ) {
    throw new Error('Refusing cleanup against the application database');
  }
  await app.get(PrismaService).user.deleteMany({
    where: { email: { endsWith: '@e2e.gomgoods.local' } },
  });
}
