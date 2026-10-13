import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AccountType } from '../src/generated/prisma/enums.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './helpers/create-test-app.js';

const testOrigin = 'http://localhost:3001';
const password = 'correct-horse-battery';
const phase3Domain = '@phase3.e2e.gomgoods.local';
const categoryId = '00000000-0000-4000-8000-000000003030';
const childCategoryId = '00000000-0000-4000-8000-000000003031';
const inactiveCategoryId = '00000000-0000-4000-8000-000000003032';

function authPost(app: INestApplication, path: string) {
  return request(app.getHttpServer())
    .post(path)
    .set('Origin', testOrigin)
    .set('X-GomGoods-CSRF', '1');
}

async function register(
  app: INestApplication,
  username: string,
): Promise<string> {
  const response = await authPost(app, '/api/auth/register')
    .send({
      email: `${username}${phase3Domain}`,
      username,
      password,
    })
    .expect(201);
  return response.body.data.accessToken as string;
}

async function cleanPhase3Data(prisma: PrismaService) {
  const users = await prisma.user.findMany({
    where: {
      email: {
        in: [
          `phase3_owner${phase3Domain}`,
          `phase3_other${phase3Domain}`,
          `phase3_admin${phase3Domain}`,
        ],
      },
    },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const stores = await prisma.store.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const storeIds = stores.map((store) => store.id);
  const products = await prisma.product.findMany({
    where: { storeId: { in: storeIds } },
    select: { id: true },
  });
  const productIds = products.map((product) => product.id);
  const listings = await prisma.listing.findMany({
    where: {
      OR: [
        { sellerUserId: { in: userIds } },
        { productId: { in: productIds } },
      ],
    },
    select: { id: true },
  });
  const listingIds = listings.map((listing) => listing.id);

  await prisma.listing.deleteMany({
    where: { id: { in: listingIds } },
  });
  await prisma.product.deleteMany({
    where: { id: { in: productIds } },
  });
  await prisma.store.deleteMany({
    where: { id: { in: storeIds } },
  });
  await prisma.category.deleteMany({ where: { id: childCategoryId } });
  await prisma.category.deleteMany({
    where: { id: { in: [inactiveCategoryId, categoryId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: phase3Domain } },
  });
}

describe('Phase 3 users, stores, products, and listings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let otherToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanPhase3Data(prisma);
    await prisma.category.createMany({
      data: [
        { id: categoryId, name: 'Phase 3 E2E Category' },
        {
          id: childCategoryId,
          parentId: categoryId,
          name: 'Hidden Phase 3 Child',
          status: 'INACTIVE',
        },
        {
          id: inactiveCategoryId,
          name: 'Hidden Phase 3 Root',
          status: 'INACTIVE',
        },
      ],
    });
    ownerToken = await register(app, 'phase3_owner');
    otherToken = await register(app, 'phase3_other');
    adminToken = await register(app, 'phase3_admin');
    await prisma.user.update({
      where: { email: `phase3_admin${phase3Domain}` },
      data: { accountType: AccountType.ADMIN },
    });
  });

  afterAll(async () => {
    if (app) {
      await cleanPhase3Data(prisma);
      await app.close();
    }
  });

  it('returns and updates the current user without exposing private fields', async () => {
    const current = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(current.body.data).toMatchObject({
      email: `phase3_owner${phase3Domain}`,
      username: 'phase3_owner',
    });
    expect(current.body.data).not.toHaveProperty('passwordHash');
    expect(current.body.data).not.toHaveProperty('authSessions');

    const updated = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ username: 'phase3_owner_renamed', accountType: 'ADMIN' })
      .expect(422);
    expect(updated.body.error.code).toBe('VALIDATION_FAILED');

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ username: 'phase3_owner_new' })
      .expect(200);

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: `phase3_owner${phase3Domain}` },
    });
    const publicProfile = await request(app.getHttpServer())
      .get(`/api/users/${owner.id}`)
      .expect(200);
    expect(publicProfile.body.data).toMatchObject({
      id: owner.id,
      username: 'phase3_owner_new',
    });
    expect(publicProfile.body.data).not.toHaveProperty('email');
    expect(publicProfile.body.data).not.toHaveProperty('status');
  });

  it('returns only active categories and active category children', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/categories')
      .expect(200);
    expect(
      list.body.data.some(
        (category: { id: string }) => category.id === inactiveCategoryId,
      ),
    ).toBe(false);
    const root = list.body.data.find(
      (category: { id: string }) => category.id === categoryId,
    );
    expect(root.children).toEqual([]);

    await request(app.getHttpServer())
      .get(`/api/categories/${inactiveCategoryId}`)
      .expect(404);
  });

  it('keeps stores pending until admin approval and blocks owner product creation', async () => {
    const storeResponse = await request(app.getHttpServer())
      .post('/api/stores')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Phase 3 Store', description: 'Pending store' })
      .expect(201);
    const storeId = storeResponse.body.data.id as string;
    expect(storeResponse.body.data.status).toBe('PENDING');

    await request(app.getHttpServer())
      .get(`/api/stores/${storeId}`)
      .expect(404);

    const blockedProduct = await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, name: 'Blocked Product' })
      .expect(403);
    expect(blockedProduct.body.error.code).toBe('STORE_NOT_ACTIVE');

    await request(app.getHttpServer())
      .patch(`/api/stores/${storeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Spoofed Store', userId: storeId, status: 'ACTIVE' })
      .expect(422);

    await request(app.getHttpServer())
      .patch(`/api/admin/stores/${storeId}/status`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ status: 'ACTIVE' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/admin/stores/${storeId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PENDING' })
      .expect(422);

    await request(app.getHttpServer())
      .patch(`/api/admin/stores/${storeId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const publicStore = await request(app.getHttpServer())
      .get(`/api/stores/${storeId}`)
      .expect(200);
    expect(publicStore.body.data.status).toBe('ACTIVE');
  });

  it('creates active-store products and enforces product ownership', async () => {
    const product = await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        categoryId,
        name: 'Phase 3 Product',
        description: 'Product owned by active store',
      })
      .expect(201);
    const productId = product.body.data.id as string;

    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        categoryId,
        name: 'Spoofed Product',
        storeId: productId,
        userId: productId,
        status: 'ARCHIVED',
      })
      .expect(422);

    await request(app.getHttpServer())
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Wrong owner' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Spoofed Product Update', storeId: productId })
      .expect(422);

    const list = await request(app.getHttpServer())
      .get('/api/products')
      .query({ search: 'Phase 3 Product' })
      .expect(200);
    expect(list.body.data.items).toHaveLength(1);

    const detail = await request(app.getHttpServer())
      .get(`/api/products/${productId}`)
      .expect(200);
    expect(detail.body.data.name).toBe('Phase 3 Product');
  });

  it('supports personal and store-backed listings with approved transitions only', async () => {
    const product = await prisma.product.findFirstOrThrow({
      where: { name: 'Phase 3 Product' },
    });
    const personal = await request(app.getHttpServer())
      .post('/api/listings/personal')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        price: '450000',
        quantity: 1,
        condition: 'GOOD',
        description: 'Personal listing without title or category',
      })
      .expect(201);
    const personalId = personal.body.data.id as string;
    expect(personal.body.data.sellerUserId).toBeTruthy();
    expect(personal.body.data.productId).toBeNull();
    expect(personal.body.data).not.toHaveProperty('title');

    await request(app.getHttpServer())
      .post('/api/listings/personal')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        price: '450000',
        quantity: 1,
        condition: 'GOOD',
        sellerUserId: product.id,
        productId: product.id,
        status: 'ACTIVE',
      })
      .expect(422);

    await request(app.getHttpServer())
      .patch(`/api/listings/${personalId}/status`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ status: 'SOLD' })
      .expect(422);

    await request(app.getHttpServer())
      .patch(`/api/listings/${personalId}/status`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const storeListing = await request(app.getHttpServer())
      .post(`/api/products/${product.id}/listings`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ price: '1250000', quantity: 2, condition: 'NEW' })
      .expect(201);
    const storeListingId = storeListing.body.data.id as string;

    await request(app.getHttpServer())
      .patch(`/api/listings/${storeListingId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ price: '1' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/listings/${storeListingId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ price: '1', sellerUserId: product.id, productId: product.id })
      .expect(422);

    await request(app.getHttpServer())
      .patch(`/api/listings/${storeListingId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const publicListings = await request(app.getHttpServer())
      .get('/api/listings')
      .query({ sellerType: 'store' })
      .expect(200);
    expect(
      publicListings.body.data.items.some(
        (item: { id: string }) => item.id === storeListingId,
      ),
    ).toBe(true);

    const invalidPriceRange = await request(app.getHttpServer())
      .get('/api/listings')
      .query({ minPrice: '200.00', maxPrice: '100.00' })
      .expect(422);
    expect(invalidPriceRange.body.error.code).toBe('VALIDATION_FAILED');

    const store = await prisma.store.findFirstOrThrow({
      where: { name: 'Phase 3 Store' },
    });
    await request(app.getHttpServer())
      .patch(`/api/admin/stores/${store.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    await request(app.getHttpServer()).get(`/api/stores/${store.id}`).expect(404);
    await request(app.getHttpServer())
      .get(`/api/products/${product.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/listings/${storeListingId}`)
      .expect(404);
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: `phase3_owner${phase3Domain}` },
    });
    const publicProfile = await request(app.getHttpServer())
      .get(`/api/users/${owner.id}`)
      .expect(200);
    expect(publicProfile.body.data.store).toBeNull();

    await request(app.getHttpServer())
      .patch(`/api/admin/stores/${store.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/listings/${storeListingId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/listings/${storeListingId}`)
      .expect(404);
  });

  it('soft archives products and treats closed stores as terminal', async () => {
    const product = await prisma.product.findFirstOrThrow({
      where: { name: 'Phase 3 Product' },
    });
    const activeListing = await request(app.getHttpServer())
      .post(`/api/products/${product.id}/listings`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ price: '300000', quantity: 1, condition: 'LIKE_NEW' })
      .expect(201);
    const activeListingId = activeListing.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/listings/${activeListingId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/products/${product.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/products/${product.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Archived Update' })
      .expect(409);
    await request(app.getHttpServer())
      .get(`/api/listings/${activeListingId}`)
      .expect(404);
    await expect(
      prisma.listing.findUniqueOrThrow({
        where: { id: activeListingId },
        select: { status: true },
      }),
    ).resolves.toMatchObject({ status: 'REMOVED' });
    await request(app.getHttpServer())
      .patch(`/api/listings/${activeListingId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ price: '1' })
      .expect(403);

    const store = await prisma.store.findFirstOrThrow({
      where: { name: 'Phase 3 Store' },
    });
    await request(app.getHttpServer())
      .patch(`/api/admin/stores/${store.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CLOSED' })
      .expect(200);
    await request(app.getHttpServer()).get(`/api/stores/${store.id}`).expect(404);
    const reopen = await request(app.getHttpServer())
      .patch(`/api/admin/stores/${store.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(409);
    expect(reopen.body.error.code).toBe('INVALID_STORE_STATUS_TRANSITION');
  });
});
