import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ListingStatus, StoreStatus } from '../src/generated/prisma/enums.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './helpers/create-test-app.js';

const testOrigin = 'http://localhost:3001';
const password = 'correct-horse-battery';
const phase4Domain = '@phase4.e2e.gomgoods.local';
const categoryId = '00000000-0000-4000-8000-000000004040';
const storeId = '00000000-0000-4000-8000-000000004050';
const productId = '00000000-0000-4000-8000-000000004060';
const secondProductId = '00000000-0000-4000-8000-000000004061';
const thirdProductId = '00000000-0000-4000-8000-000000004062';
const storeListingId = '00000000-0000-4000-8000-000000004073';
const personalListingId = '00000000-0000-4000-8000-000000004072';
const secondStoreListingId = '00000000-0000-4000-8000-000000004071';
const thirdStoreListingId = '00000000-0000-4000-8000-000000004070';
const sharedCreatedAt = new Date('2026-04-01T00:00:00.000Z');

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
      email: `${username}${phase4Domain}`,
      username,
      password,
    })
    .expect(201);
  return response.body.data.accessToken as string;
}

async function cleanPhase4Data(prisma: PrismaService) {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: phase4Domain } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await prisma.userFollow.deleteMany({
    where: {
      OR: [
        { followerId: { in: userIds } },
        { followingId: { in: userIds } },
      ],
    },
  });
  await prisma.follow.deleteMany({
    where: {
      OR: [{ userId: { in: userIds } }, { storeId }],
    },
  });
  await prisma.listing.deleteMany({
    where: {
      OR: [
        { id: { in: [storeListingId, personalListingId, secondStoreListingId] } },
        { id: thirdStoreListingId },
        { sellerUserId: { in: userIds } },
      ],
    },
  });
  await prisma.product.deleteMany({
    where: { id: { in: [productId, secondProductId, thirdProductId] } },
  });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.user.deleteMany({
    where: { email: { endsWith: phase4Domain } },
  });
}

describe('Phase 4 search, discovery, and store following (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let followerToken: string;
  let inactiveUserId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanPhase4Data(prisma);

    ownerToken = await register(app, 'phase4_owner');
    followerToken = await register(app, 'phase4_follower');
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: `phase4_owner${phase4Domain}` },
    });
    const follower = await prisma.user.findUniqueOrThrow({
      where: { email: `phase4_follower${phase4Domain}` },
    });
    await prisma.user.createMany({
      data: [
        {
          email: `phase4_followed${phase4Domain}`,
          username: 'phase4_followed',
          passwordHash: 'phase4-e2e-unused-password-hash',
        },
        {
          email: `phase4_followed_second${phase4Domain}`,
          username: 'phase4_followed_second',
          passwordHash: 'phase4-e2e-unused-password-hash',
        },
        {
          email: `phase4_followed_concurrent${phase4Domain}`,
          username: 'phase4_followed_concurrent',
          passwordHash: 'phase4-e2e-unused-password-hash',
        },
        {
          email: `phase4_inactive${phase4Domain}`,
          username: 'phase4_inactive',
          passwordHash: 'phase4-e2e-unused-password-hash',
          status: 'SUSPENDED',
        },
      ],
    });
    const inactive = await prisma.user.findUniqueOrThrow({
      where: { email: `phase4_inactive${phase4Domain}` },
      select: { id: true },
    });
    inactiveUserId = inactive.id;

    await prisma.category.create({
      data: { id: categoryId, name: 'Phase 4 Search Category' },
    });
    await prisma.store.create({
      data: {
        id: storeId,
        userId: owner.id,
        name: 'Phase 4 Store Name Only Keyword',
        status: StoreStatus.ACTIVE,
      },
    });
    await prisma.product.createMany({
      data: [
        {
          id: productId,
          storeId,
          categoryId,
          name: 'Gundam Phase 4 Model',
          description: 'Mechanical kit searchable by product description',
        },
        {
          id: secondProductId,
          storeId,
          categoryId,
          name: 'Figure Phase 4 Model',
        },
        {
          id: thirdProductId,
          storeId,
          categoryId,
          name: 'Plush Phase 4 Model',
        },
      ],
    });
    await prisma.listing.createMany({
      data: [
        {
          id: storeListingId,
          productId,
          price: '300.00',
          quantity: 1,
          condition: 'NEW',
          description: 'Store-backed searchable listing',
          status: ListingStatus.ACTIVE,
          createdAt: sharedCreatedAt,
        },
        {
          id: personalListingId,
          sellerUserId: follower.id,
          price: '200.00',
          quantity: 1,
          condition: 'GOOD',
          description: 'Personal charm listing searchable by description',
          status: ListingStatus.ACTIVE,
          createdAt: sharedCreatedAt,
        },
        {
          id: secondStoreListingId,
          productId: secondProductId,
          price: '100.00',
          quantity: 1,
          condition: 'LIKE_NEW',
          description: 'Second store-backed listing',
          status: ListingStatus.ACTIVE,
          createdAt: sharedCreatedAt,
        },
        {
          id: thirdStoreListingId,
          productId: thirdProductId,
          price: '400.00',
          quantity: 1,
          condition: 'FAIR',
          description: 'Third store-backed listing',
          status: ListingStatus.ACTIVE,
          createdAt: sharedCreatedAt,
        },
      ],
    });
  });

  afterAll(async () => {
    if (app) {
      await cleanPhase4Data(prisma);
      await app.close();
    }
  });

  it('searches and filters listings without inventing personal title/category data', async () => {
    const byProductName = await request(app.getHttpServer())
      .get('/api/listings')
      .query({ q: 'Gundam' })
      .expect(200);
    expect(byProductName.body.data.items.map((item: { id: string }) => item.id))
      .toContain(storeListingId);

    const byPersonalDescription = await request(app.getHttpServer())
      .get('/api/listings')
      .query({ q: 'Personal charm' })
      .expect(200);
    expect(
      byPersonalDescription.body.data.items.map((item: { id: string }) => item.id),
    ).toEqual([personalListingId]);

    const byStoreNameOnly = await request(app.getHttpServer())
      .get('/api/listings')
      .query({ q: 'Store Name Only Keyword' })
      .expect(200);
    expect(byStoreNameOnly.body.data.items).toHaveLength(0);

    const categoryFiltered = await request(app.getHttpServer())
      .get('/api/listings')
      .query({ categoryId })
      .expect(200);
    expect(
      categoryFiltered.body.data.items.map((item: { id: string }) => item.id),
    ).toEqual([storeListingId, secondStoreListingId, thirdStoreListingId]);

    const priceSorted = await request(app.getHttpServer())
      .get('/api/listings')
      .query({ q: 'listing', sort: 'price_asc' })
      .expect(200);
    expect(priceSorted.body.data.items.map((item: { id: string }) => item.id))
      .toEqual([
        secondStoreListingId,
        personalListingId,
        storeListingId,
        thirdStoreListingId,
      ]);
  });

  it('uses stable cursor discovery without duplicates for stable data', async () => {
    const firstPage = await request(app.getHttpServer())
      .get('/api/discovery/listings')
      .query({ categoryId, limit: 2 })
      .expect(200);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.pageInfo.hasNextPage).toBe(true);
    expect(firstPage.body.data.pageInfo.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app.getHttpServer())
      .get('/api/discovery/listings')
      .query({
        categoryId,
        limit: 2,
        cursor: firstPage.body.data.pageInfo.nextCursor,
      })
      .expect(200);
    const ids = [
      ...firstPage.body.data.items.map((item: { id: string }) => item.id),
      ...secondPage.body.data.items.map((item: { id: string }) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([storeListingId, secondStoreListingId, thirdStoreListingId]);

    await request(app.getHttpServer())
      .get('/api/discovery/listings')
      .query({
        limit: 2,
        sellerType: 'store',
        cursor: firstPage.body.data.pageInfo.nextCursor,
      })
      .expect(422);
  });

  it('follows active users idempotently with public-safe pagination', async () => {
    const follower = await prisma.user.findUniqueOrThrow({
      where: { email: `phase4_follower${phase4Domain}` },
    });
    const followed = await prisma.user.findUniqueOrThrow({
      where: { email: `phase4_followed${phase4Domain}` },
    });
    const secondFollowed = await prisma.user.findUniqueOrThrow({
      where: { email: `phase4_followed_second${phase4Domain}` },
    });
    const concurrentFollowed = await prisma.user.findUniqueOrThrow({
      where: { email: `phase4_followed_concurrent${phase4Domain}` },
    });

    await request(app.getHttpServer())
      .post(`/api/users/${followed.id}/follow`)
      .expect(401);

    const selfFollow = await request(app.getHttpServer())
      .post(`/api/users/${follower.id}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(409);
    expect(selfFollow.body.error.code).toBe('RESOURCE_CONFLICT');

    await request(app.getHttpServer())
      .post('/api/users/00000000-0000-4000-8000-000000009999/follow')
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/users/${inactiveUserId}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/users/${followed.id}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.data).toEqual({ following: true }));

    await request(app.getHttpServer())
      .post(`/api/users/${followed.id}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual({ following: true }));

    const concurrentResponses = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/users/${concurrentFollowed.id}/follow`)
        .set('Authorization', `Bearer ${followerToken}`),
      request(app.getHttpServer())
        .post(`/api/users/${concurrentFollowed.id}/follow`)
        .set('Authorization', `Bearer ${followerToken}`),
    ]);
    expect(concurrentResponses.map((response) => response.status).sort()).toEqual([
      200,
      201,
    ]);
    expect(
      concurrentResponses.every(
        (response) => response.body.data.following === true,
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/users/${secondFollowed.id}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(201);

    const firstPage = await request(app.getHttpServer())
      .get('/api/users/me/following/users')
      .set('Authorization', `Bearer ${followerToken}`)
      .query({ page: 1, limit: 2 })
      .expect(200);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.meta).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(firstPage.body.data.items[0]).not.toHaveProperty('email');
    expect(firstPage.body.data.items[0]).not.toHaveProperty('status');
    expect(firstPage.body.data.items[0]).not.toHaveProperty('passwordHash');

    const secondPage = await request(app.getHttpServer())
      .get('/api/users/me/following/users')
      .set('Authorization', `Bearer ${followerToken}`)
      .query({ page: 2, limit: 2 })
      .expect(200);
    expect(secondPage.body.data.items).toHaveLength(1);

    await prisma.user.update({
      where: { id: followed.id },
      data: { status: 'SUSPENDED' },
    });
    const afterSuspension = await request(app.getHttpServer())
      .get('/api/users/me/following/users')
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(200);
    expect(
      afterSuspension.body.data.items.some(
        (item: { id: string }) => item.id === followed.id,
      ),
    ).toBe(false);

    await request(app.getHttpServer())
      .delete(`/api/users/${followed.id}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual({ following: false }));

    await request(app.getHttpServer())
      .delete(`/api/users/${followed.id}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual({ following: false }));

    await expect(
      prisma.userFollow.findUnique({
        where: {
          followerId_followingId: {
            followerId: follower.id,
            followingId: followed.id,
          },
        },
      }),
    ).resolves.toBeNull();
  });

  it('follows active stores idempotently and hides inactive followed stores', async () => {
    const selfFollow = await request(app.getHttpServer())
      .post(`/api/stores/${storeId}/follow`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409);
    expect(selfFollow.body.error.code).toBe('RESOURCE_CONFLICT');

    await request(app.getHttpServer())
      .post(`/api/stores/${storeId}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.data).toEqual({ following: true }));

    await request(app.getHttpServer())
      .post(`/api/stores/${storeId}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual({ following: true }));

    const activeFollowing = await request(app.getHttpServer())
      .get('/api/users/me/following/stores')
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(200);
    expect(activeFollowing.body.data.map((store: { id: string }) => store.id))
      .toEqual([storeId]);
    expect(activeFollowing.body.data[0].user).not.toHaveProperty('email');

    await prisma.store.update({
      where: { id: storeId },
      data: { status: StoreStatus.SUSPENDED },
    });

    const inactiveFollowing = await request(app.getHttpServer())
      .get('/api/users/me/following/stores')
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(200);
    expect(inactiveFollowing.body.data).toEqual([]);

    await request(app.getHttpServer())
      .delete(`/api/stores/${storeId}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual({ following: false }));

    await request(app.getHttpServer())
      .delete(`/api/stores/${storeId}/follow`)
      .set('Authorization', `Bearer ${followerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual({ following: false }));
  });
});
