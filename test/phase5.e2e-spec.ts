import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import {
  ListingStatus,
  PaymentMethod,
  StoreStatus,
} from '../src/generated/prisma/enums.js';
import { AccessTokenService } from '../src/modules/auth/access-token.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './helpers/create-test-app.js';

const phase5Domain = '@phase5.e2e.gomgoods.local';
const buyerId = '00000000-0000-4000-8000-000000005001';
const secondBuyerId = '00000000-0000-4000-8000-000000005002';
const personalSellerId = '00000000-0000-4000-8000-000000005003';
const storeOwnerId = '00000000-0000-4000-8000-000000005004';
const adminId = '00000000-0000-4000-8000-000000005005';
const categoryId = '00000000-0000-4000-8000-000000005010';
const storeId = '00000000-0000-4000-8000-000000005011';
const productId = '00000000-0000-4000-8000-000000005012';
const storeListingId = '00000000-0000-4000-8000-000000005020';
const personalListingId = '00000000-0000-4000-8000-000000005021';
const scarceListingId = '00000000-0000-4000-8000-000000005022';
const prepaidListingId = '00000000-0000-4000-8000-000000005023';
const buyerAddressId = '00000000-0000-4000-8000-000000005030';
const secondBuyerAddressId = '00000000-0000-4000-8000-000000005031';

async function tokenFor(app: INestApplication, userId: string) {
  const tokens = app.get(AccessTokenService);
  const sessionId = `10000000-0000-4000-8000-${userId.slice(-12)}`;
  return tokens.sign({ sub: userId, sid: sessionId, accountType: 'USER' });
}

async function adminTokenFor(app: INestApplication) {
  const tokens = app.get(AccessTokenService);
  const sessionId = `10000000-0000-4000-8000-${adminId.slice(-12)}`;
  return tokens.sign({ sub: adminId, sid: sessionId, accountType: 'ADMIN' });
}

function api(app: INestApplication, token: string) {
  const server = request(app.getHttpServer());
  const auth = (test: request.Test) =>
    test.set('Authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(server.get(path)),
    post: (path: string) => auth(server.post(path)),
    patch: (path: string) => auth(server.patch(path)),
    delete: (path: string) => auth(server.delete(path)),
  };
}

async function cleanPhase5Data(prisma: PrismaService) {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: phase5Domain } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const orders = await prisma.order.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  const payments = await prisma.payment.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true },
  });
  await prisma.transaction.deleteMany({
    where: { paymentId: { in: payments.map((payment) => payment.id) } },
  });
  await prisma.shipmentItem.deleteMany({
    where: { shipment: { orderId: { in: orderIds } } },
  });
  await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.checkoutGroup.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: { in: userIds } } },
  });
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.listing.deleteMany({
    where: {
      id: {
        in: [
          storeListingId,
          personalListingId,
          scarceListingId,
          prepaidListingId,
        ],
      },
    },
  });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function seedPhase5Data(prisma: PrismaService) {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.user.createMany({
    data: [
      {
        id: buyerId,
        email: `phase5_buyer${phase5Domain}`,
        username: 'phase5_buyer',
        passwordHash: 'phase5-e2e-unused',
      },
      {
        id: secondBuyerId,
        email: `phase5_second_buyer${phase5Domain}`,
        username: 'phase5_second_buyer',
        passwordHash: 'phase5-e2e-unused',
      },
      {
        id: personalSellerId,
        email: `phase5_personal_seller${phase5Domain}`,
        username: 'phase5_personal_seller',
        passwordHash: 'phase5-e2e-unused',
      },
      {
        id: storeOwnerId,
        email: `phase5_store_owner${phase5Domain}`,
        username: 'phase5_store_owner',
        passwordHash: 'phase5-e2e-unused',
      },
      {
        id: adminId,
        email: `phase5_admin${phase5Domain}`,
        username: 'phase5_admin',
        passwordHash: 'phase5-e2e-unused',
        accountType: 'ADMIN',
      },
    ],
  });
  await prisma.authSession.createMany({
    data: [buyerId, secondBuyerId, personalSellerId, storeOwnerId, adminId].map(
      (userId) => ({
        id: `10000000-0000-4000-8000-${userId.slice(-12)}`,
        userId,
        expiresAt,
      }),
    ),
  });
  await prisma.address.createMany({
    data: [
      {
        id: buyerAddressId,
        userId: buyerId,
        recipient: 'Phase 5 Buyer',
        phone: '0900000000',
        addressLine: '1 Phase Street',
        city: 'HCM',
        district: 'District 1',
        ward: 'Ben Nghe',
      },
      {
        id: secondBuyerAddressId,
        userId: secondBuyerId,
        recipient: 'Phase 5 Second Buyer',
        phone: '0900000001',
        addressLine: '2 Phase Street',
        city: 'HCM',
        district: 'District 2',
        ward: 'Thao Dien',
      },
    ],
  });
  await prisma.category.create({
    data: { id: categoryId, name: 'Phase 5 Category' },
  });
  await prisma.store.create({
    data: {
      id: storeId,
      userId: storeOwnerId,
      name: 'Phase 5 Store',
      status: StoreStatus.ACTIVE,
    },
  });
  await prisma.product.create({
    data: {
      id: productId,
      storeId,
      categoryId,
      name: 'Phase 5 Product',
      description: 'Checkout product',
    },
  });
  await prisma.listing.createMany({
    data: [
      {
        id: storeListingId,
        productId,
        price: '100.00',
        quantity: 2,
        condition: 'NEW',
        description: 'Phase 5 store listing',
        status: ListingStatus.ACTIVE,
      },
      {
        id: personalListingId,
        sellerUserId: personalSellerId,
        price: '50.00',
        quantity: 1,
        condition: 'GOOD',
        description: 'Phase 5 personal listing',
        status: ListingStatus.ACTIVE,
      },
      {
        id: scarceListingId,
        sellerUserId: personalSellerId,
        price: '75.00',
        quantity: 1,
        condition: 'LIKE_NEW',
        description: 'Phase 5 scarce listing',
        status: ListingStatus.ACTIVE,
      },
      {
        id: prepaidListingId,
        sellerUserId: personalSellerId,
        price: '25.00',
        quantity: 1,
        condition: 'FAIR',
        description: 'Phase 5 prepaid listing',
        status: ListingStatus.ACTIVE,
      },
    ],
  });
}

describe('Phase 5 cart, checkout, orders, shipments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let secondBuyerToken: string;
  let personalSellerToken: string;
  let storeOwnerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanPhase5Data(prisma);
    await seedPhase5Data(prisma);
    buyerToken = (await tokenFor(app, buyerId)).accessToken;
    secondBuyerToken = (await tokenFor(app, secondBuyerId)).accessToken;
    personalSellerToken = (await tokenFor(app, personalSellerId)).accessToken;
    storeOwnerToken = (await tokenFor(app, storeOwnerId)).accessToken;
    adminToken = (await adminTokenFor(app)).accessToken;
  });

  afterAll(async () => {
    if (app) {
      await cleanPhase5Data(prisma);
      await app.close();
    }
  });

  it('manages cart items without reserving inventory or allowing self-purchase', async () => {
    await api(app, buyerToken)
      .post('/api/cart/items')
      .send({ listingId: storeListingId, quantity: 1 })
      .expect(201);
    await api(app, buyerToken)
      .post('/api/cart/items')
      .send({ listingId: storeListingId, quantity: 1 })
      .expect(201);
    const cart = await api(app, buyerToken).get('/api/cart').expect(200);
    expect(cart.body.data.items).toEqual([
      expect.objectContaining({ listingId: storeListingId, quantity: 2 }),
    ]);
    await expect(
      prisma.listing.findUniqueOrThrow({
        where: { id: storeListingId },
        select: { quantity: true },
      }),
    ).resolves.toEqual({ quantity: 2 });
    await api(app, storeOwnerToken)
      .post('/api/cart/items')
      .send({ listingId: storeListingId, quantity: 1 })
      .expect(409);
  });

  it('creates a multi-seller COD checkout group with seller-specific orders and pending payments', async () => {
    await api(app, buyerToken)
      .post('/api/cart/items')
      .send({ listingId: personalListingId, quantity: 1 })
      .expect(201);
    const response = await api(app, buyerToken)
      .post('/api/checkout')
      .send({
        idempotencyKey: 'phase5-cod-multi-seller',
        addressId: buyerAddressId,
        paymentMethod: PaymentMethod.COD,
      })
      .expect(201);
    expect(response.body.data.orders).toHaveLength(2);
    expect(response.body.data.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storeId,
          status: 'CONFIRMED',
          payments: [expect.objectContaining({ status: 'PENDING' })],
        }),
        expect.objectContaining({
          sellerUserId: personalSellerId,
          status: 'CONFIRMED',
          payments: [expect.objectContaining({ status: 'PENDING' })],
        }),
      ]),
    );
    await expect(
      prisma.listing.findUniqueOrThrow({
        where: { id: personalListingId },
        select: { quantity: true },
      }),
    ).resolves.toEqual({ quantity: 0 });
    await request(app.getHttpServer())
      .get(`/api/listings/${personalListingId}`)
      .expect(404);
  });

  it('returns existing checkout for same idempotency key and rejects changed payload', async () => {
    await api(app, buyerToken)
      .post('/api/checkout')
      .send({
        idempotencyKey: 'phase5-cod-multi-seller',
        addressId: buyerAddressId,
        paymentMethod: PaymentMethod.COD,
      })
      .expect(201);
    await api(app, buyerToken)
      .post('/api/checkout')
      .send({
        idempotencyKey: 'phase5-cod-multi-seller',
        addressId: buyerAddressId,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
      })
      .expect(409);
  });

  it('prevents overselling when stock reaches zero', async () => {
    await api(app, buyerToken)
      .post('/api/cart/items')
      .send({ listingId: scarceListingId, quantity: 1 })
      .expect(201);
    await api(app, secondBuyerToken)
      .post('/api/cart/items')
      .send({ listingId: scarceListingId, quantity: 1 })
      .expect(201);
    await api(app, buyerToken)
      .post('/api/checkout')
      .send({
        idempotencyKey: 'phase5-scarce-first',
        addressId: buyerAddressId,
        paymentMethod: PaymentMethod.COD,
      })
      .expect(201);
    await api(app, secondBuyerToken)
      .post('/api/checkout')
      .send({
        idempotencyKey: 'phase5-scarce-second',
        addressId: secondBuyerAddressId,
        paymentMethod: PaymentMethod.COD,
      })
      .expect(404);
  });

  it('cancels pending prepaid orders and releases inventory exactly once', async () => {
    await api(app, buyerToken)
      .post('/api/cart/items')
      .send({ listingId: prepaidListingId, quantity: 1 })
      .expect(201);
    const checkout = await api(app, buyerToken)
      .post('/api/checkout')
      .send({
        idempotencyKey: 'phase5-prepaid-cancel',
        addressId: buyerAddressId,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
      })
      .expect(201);
    const orderId = checkout.body.data.orders[0].id as string;
    expect(checkout.body.data.orders[0]).toMatchObject({
      status: 'PENDING',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      payments: [expect.objectContaining({ status: 'PENDING' })],
    });
    await api(app, personalSellerToken)
      .post(`/api/orders/${orderId}/shipments`)
      .send({
        carrier: 'Manual',
        items: [
          {
            orderItemId: checkout.body.data.orders[0].items[0].id,
            quantity: 1,
          },
        ],
      })
      .expect(409);
    await api(app, buyerToken)
      .post(`/api/orders/${orderId}/cancel`)
      .send({ reason: 'changed mind' })
      .expect(201);
    await expect(
      prisma.listing.findUniqueOrThrow({
        where: { id: prepaidListingId },
        select: { quantity: true },
      }),
    ).resolves.toEqual({ quantity: 1 });
    await api(app, buyerToken)
      .post(`/api/orders/${orderId}/cancel`)
      .send({ reason: 'again' })
      .expect(409);
    await expect(
      prisma.listing.findUniqueOrThrow({
        where: { id: prepaidListingId },
        select: { quantity: true },
      }),
    ).resolves.toEqual({ quantity: 1 });
  });

  it('allows seller shipment transitions for COD orders and buyer delivery confirmation', async () => {
    const order = await prisma.order.findFirstOrThrow({
      where: { userId: buyerId, storeId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    const shipment = await api(app, storeOwnerToken)
      .post(`/api/orders/${order.id}/shipments`)
      .send({
        carrier: 'Manual',
        trackingNo: 'PHASE5-TRACKING',
        items: [{ orderItemId: order.items[0].id, quantity: 2 }],
      })
      .expect(201);
    const shipmentId = shipment.body.data.id as string;
    await api(app, storeOwnerToken)
      .patch(`/api/shipments/${shipmentId}/ready`)
      .expect(200);
    await api(app, storeOwnerToken)
      .patch(`/api/shipments/${shipmentId}/ship`)
      .expect(200);
    await api(app, storeOwnerToken)
      .patch(`/api/shipments/${shipmentId}/confirm-delivery`)
      .expect(404);
    await api(app, buyerToken)
      .patch(`/api/shipments/${shipmentId}/confirm-delivery`)
      .expect(200);
  });

  it('protects pending expiration behind admin access', async () => {
    await api(app, buyerToken).post('/api/orders/expire-pending').expect(403);
    await api(app, adminToken).post('/api/orders/expire-pending').expect(201);
  });
});
