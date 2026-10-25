import { createHmac, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';

import {
  OrderStatus,
  PaymentEventStatus,
  PaymentMethod,
  PaymentStatus,
} from '../src/generated/prisma/enums.js';
import { AccessTokenService } from '../src/modules/auth/access-token.service.js';
import { CartService } from '../src/modules/cart/cart.service.js';
import { CheckoutService } from '../src/modules/checkout/checkout.service.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { paymentReference } from '../src/modules/payments/payment-event.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { ShipmentsService } from '../src/modules/shipments/shipments.service.js';
import {
  safeUserSelect,
  type SafeUser,
} from '../src/modules/users/user.select.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './helpers/create-test-app.js';
import { fixtureOrders } from './helpers/fixture-orders.js';

const secret = 'phase6-integration-test-webhook-secret-not-a-live-credential';
const sandboxAccount = '0000000000';
const sandboxBankId = '00000000-0000-4000-8000-000000006000';
const sandboxVa = 'SBSEPAYX9KA2B7MN4QR';

describe('Phase 6 test payments, webhook verification and reconciliation (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let payments: PaymentsService;
  let orders: OrdersService;
  let buyer: SafeUser;
  let other: SafeUser;
  let seller: SafeUser;
  let admin: SafeUser;
  let buyerToken: string;
  let otherToken: string;
  let sellerToken: string;
  let adminToken: string;
  const userIds = Array.from({ length: 4 }, () => randomUUID());
  const addressId = randomUUID();
  const eventIds = new Set<string>();
  let sequence = Math.floor(Date.now() / 1000) * 1000;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    payments = app.get(PaymentsService);
    orders = app.get(OrdersService);
    await prisma.user.createMany({
      data: userIds.map((id, index) => ({
        id,
        email: `${id}@phase6.e2e.gomgoods.local`,
        username: `p6_${id.slice(0, 24)}`,
        passwordHash: 'unused-test-hash',
        accountType: index === 3 ? 'ADMIN' : 'USER',
      })),
    });
    await prisma.address.create({
      data: {
        id: addressId,
        userId: userIds[0],
        recipient: 'Test Buyer',
        phone: '0900000000',
        addressLine: 'Test only',
        city: 'Test',
        district: 'Test',
        ward: 'Test',
      },
    });
    [buyer, other, seller, admin] = await Promise.all(
      userIds.map((id) =>
        prisma.user.findUniqueOrThrow({
          where: { id },
          select: safeUserSelect,
        }),
      ),
    );
    [buyerToken, otherToken, sellerToken, adminToken] = await Promise.all(
      [buyer, other, seller, admin].map(async (user) => {
        const session = await prisma.authSession.create({
          data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
        });
        return (
          await app.get(AccessTokenService).sign({
            sub: user.id,
            sid: session.id,
            accountType: user.accountType,
          })
        ).accessToken;
      }),
    );
  });

  beforeEach(() => {
    config.set('PAYMENT_MODE', 'sepay_test');
    config.set('SEPAY_WEBHOOK_AUTH', 'hmac');
    config.set('SEPAY_TEST_WEBHOOK_SECRET', secret);
    config.set('SEPAY_TEST_ACCOUNT_NUMBER', sandboxAccount);
    config.set('SEPAY_TEST_BANK_NAME', 'Vietcombank');
    config.set('VIETQR_TEST_BANK_BIN', '970436');
    config.set('VIETQR_TEST_ACCOUNT_NAME', 'GOMGOODS TEST ONLY');
    config.set('SEPAY_TEST_API_TOKEN', 'phase6-sandbox-test-token');
    config.set('SEPAY_TEST_BANK_ACCOUNT_ID', sandboxBankId);
    // Explicitly clear cached/process-env fallback from the preceding VA case.
    config.set('SEPAY_TEST_VA', '');
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    if (!app) return;
    try {
      const scope = { order: { userId: { in: userIds } } };
      await prisma.shipmentItem.deleteMany({ where: { shipment: scope } });
      await prisma.shipment.deleteMany({ where: scope });
      await prisma.paymentEvent.deleteMany({
        where: {
          OR: [{ payment: scope }, { providerEventId: { in: [...eventIds] } }],
        },
      });
      await prisma.transaction.deleteMany({ where: { payment: scope } });
      await prisma.payment.deleteMany({ where: scope });
      await prisma.orderItem.deleteMany({ where: scope });
      await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.checkoutGroup.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.cartItem.deleteMany({
        where: { cart: { userId: { in: userIds } } },
      });
      await prisma.listing.deleteMany({
        where: { sellerUserId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await app.close();
    }
  });

  async function fixture(
    method: PaymentMethod = PaymentMethod.BANK_TRANSFER,
    price = '100000.00',
  ) {
    const listing = await prisma.listing.create({
      data: {
        sellerUserId: seller.id,
        price,
        quantity: 1,
        condition: 'NEW',
        status: 'ACTIVE',
      },
    });
    const item = await app
      .get(CartService)
      .addItem(buyer, { listingId: listing.id, quantity: 1 });
    const group = await app.get(CheckoutService).checkout(buyer, {
      idempotencyKey: randomUUID(),
      addressId,
      cartItemIds: [item.id],
      paymentMethod: method,
    });
    return {
      listing,
      order: group.orders[0],
      payment: group.orders[0].payments[0],
    };
  }

  function event(paymentId: string) {
    const id = String(++sequence);
    eventIds.add(id);
    const reference = paymentReference(paymentId);
    return {
      id,
      gateway: 'Vietcombank',
      accountNumber: sandboxAccount,
      transactionDate: new Date(Date.now() + 7 * 3600_000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' '),
      code: reference,
      content: `${reference} thanh toan test`,
      subAccount: '',
      transferType: 'in' as const,
      transferAmount: 100000,
      accumulated: 0,
      referenceCode: `TEST${id}`,
      description: 'Simulated transaction only',
    };
  }

  function webhook(
    payload: ReturnType<typeof event>,
    timestamp = String(Math.floor(Date.now() / 1000)),
    signedBody?: string,
  ) {
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(signedBody ?? body)
      .digest('hex');
    return request(app.getHttpServer())
      .post('/api/payments/webhooks/sepay')
      .set('Content-Type', 'application/json')
      .set('X-SePay-Timestamp', timestamp)
      .set('X-SePay-Signature', `sha256=${signature}`)
      .send(body);
  }

  async function state(id: string) {
    return prisma.payment.findUniqueOrThrow({
      where: { id },
      include: { order: true, transactions: true },
    });
  }

  async function stock(id: string) {
    return (await prisma.listing.findUniqueOrThrow({ where: { id } })).quantity;
  }

  async function outsideState(current: Awaited<ReturnType<typeof fixture>>) {
    return {
      orders: await prisma.order.findMany({
        where: { id: { not: current.order.id } },
        orderBy: { id: 'asc' },
        include: { payments: { orderBy: { id: 'asc' } } },
      }),
      listings: await prisma.listing.findMany({
        where: { id: { not: current.listing.id } },
        orderBy: { id: 'asc' },
      }),
      categories: await prisma.category.findMany({ orderBy: { id: 'asc' } }),
    };
  }

  async function expiredSentinel() {
    const sentinel = await fixture();
    await prisma.order.update({
      where: { id: sentinel.order.id },
      data: { expiresAt: new Date(0) },
    });
    return sentinel;
  }

  async function behindLock<T>(
    resourceId: string,
    jobs: (() => Promise<T>)[],
    table: 'ORDER' | 'PAYMENT' = 'ORDER',
  ) {
    let unlock!: () => void;
    let ready!: () => void;
    const released = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        if (table === 'PAYMENT')
          await tx.$queryRaw`SELECT "payment_id" FROM "PAYMENT" WHERE "payment_id" = ${resourceId}::uuid FOR UPDATE`;
        else
          await tx.$queryRaw`SELECT "order_id" FROM "ORDER" WHERE "order_id" = ${resourceId}::uuid FOR UPDATE`;
        ready();
        await released;
      },
      { timeout: 10_000 },
    );
    await Promise.race([
      acquired,
      holder.then(() => {
        throw new Error('Lock holder exited early');
      }),
    ]);
    const results = Promise.allSettled(jobs.map((job) => job()));
    try {
      await vi.waitFor(
        async () => {
          const [row] = await prisma.$queryRaw<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
          expect(row.count).toBeGreaterThanOrEqual(jobs.length);
        },
        { timeout: 2000, interval: 10 },
      );
    } finally {
      unlock();
      await holder;
      await results;
    }
    return results;
  }

  it('fails closed when disabled and never accepts a user JWT as webhook authentication', async () => {
    const current = await fixture();
    const payload = event(current.payment.id);
    config.set('PAYMENT_MODE', 'disabled');
    await webhook(payload).expect(503);
    config.set('PAYMENT_MODE', 'sepay_test');
    await request(app.getHttpServer())
      .post('/api/payments/webhooks/sepay')
      .auth(buyerToken, { type: 'bearer' })
      .send(payload)
      .expect(401);
    expect((await state(current.payment.id)).status).toBe(
      PaymentStatus.PENDING,
    );
    expect(
      await prisma.paymentEvent.count({
        where: { providerEventId: payload.id },
      }),
    ).toBe(0);
  });

  it('rejects tampered raw JSON, stale/future timestamps and invalid payloads', async () => {
    const current = await fixture();
    const payload = event(current.payment.id);
    await webhook(
      { ...payload, transferAmount: 1 },
      undefined,
      JSON.stringify(payload),
    ).expect(401);
    await webhook(payload, String(Math.floor(Date.now() / 1000) - 301)).expect(
      401,
    );
    await webhook(payload, String(Math.floor(Date.now() / 1000) + 301)).expect(
      401,
    );
    await webhook({ ...payload, transferAmount: 100000.5 }).expect(422);
    await webhook({
      ...payload,
      transactionDate: '2026-02-30 12:00:00',
    }).expect(422);
    expect((await state(current.payment.id)).status).toBe(
      PaymentStatus.PENDING,
    );
  });

  it('accepts configured API Key auth and returns the exact provider acknowledgement', async () => {
    const current = await fixture();
    config.set('SEPAY_WEBHOOK_AUTH', 'api_key');
    const payload = event(current.payment.id);
    await request(app.getHttpServer())
      .post('/api/payments/webhooks/sepay')
      .set('Authorization', 'Apikey wrong')
      .send(payload)
      .expect(401);
    const response = await request(app.getHttpServer())
      .post('/api/payments/webhooks/sepay')
      .set('Authorization', `Apikey ${secret}`)
      .send(payload)
      .expect(200);
    expect(response.body).toEqual({ success: true });
    const paid = await state(current.payment.id);
    expect(paid.status).toBe(PaymentStatus.PAID);
    expect(paid.order.status).toBe(OrderStatus.CONFIRMED);
    expect(paid.transactions).toHaveLength(1);
    expect(await stock(current.listing.id)).toBe(0);
    await expect(
      orders.cancelSellerOrder(seller, current.order.id, {}),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_CANCELLABLE' });
    await expect(
      app.get(ShipmentsService).createShipment(seller, current.order.id, {
        carrier: 'Test carrier',
        items: [{ orderItemId: current.order.items[0].id, quantity: 1 }],
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('deduplicates concurrent webhook deliveries at the database boundary', async () => {
    const current = await fixture();
    const payload = event(current.payment.id);
    const results = await behindLock(current.order.id, [
      () => payments.receiveSepay(payload),
      () => payments.receiveSepay(payload),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      results
        .flatMap((result) =>
          result.status === 'fulfilled' ? [result.value.duplicate] : [],
        )
        .sort(),
    ).toEqual([false, true]);
    expect((await state(current.payment.id)).transactions).toHaveLength(1);
    expect(
      await prisma.paymentEvent.count({
        where: { providerEventId: payload.id },
      }),
    ).toBe(1);
    const duplicate = await webhook(payload).expect(200);
    expect(duplicate.body).toEqual({ success: true });
    await webhook({ ...payload, transferAmount: 99999 }).expect(409);
  });

  it('does not credit two payments using the same provider event identity', async () => {
    const first = await fixture();
    const second = await fixture();
    const payload = event(first.payment.id);
    const otherPayload = {
      ...payload,
      code: paymentReference(second.payment.id),
      content: `${paymentReference(second.payment.id)} thanh toan test`,
    };
    const results = await Promise.allSettled([
      payments.receiveSepay(payload),
      payments.receiveSepay(otherPayload),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'RESOURCE_CONFLICT' } });
    expect(
      [await state(first.payment.id), await state(second.payment.id)].filter(
        (payment) => payment.status === PaymentStatus.PAID,
      ),
    ).toHaveLength(1);
  });

  it('retains concurrent transport aliases without duplicating credit or losing ID uniqueness', async () => {
    const current = await fixture();
    const payload = event(current.payment.id);
    await webhook(payload).expect(200);
    const aliasId = randomUUID();
    eventIds.add(aliasId);
    const alias = { ...payload, id: aliasId };
    const results = await behindLock(
      current.payment.id,
      [() => payments.receiveSepay(alias), () => payments.receiveSepay(alias)],
      'PAYMENT',
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value.status] : [],
      ),
    ).toEqual([PaymentEventStatus.APPLIED, PaymentEventStatus.APPLIED]);
    expect(
      await prisma.paymentEvent.count({
        where: { provider: 'SEPAY_TEST', providerEventId: aliasId },
      }),
    ).toBe(1);
    expect((await state(current.payment.id)).transactions).toHaveLength(1);
  });

  it('does not confirm twice when different genuine events target one payment', async () => {
    const current = await fixture();
    const first = event(current.payment.id);
    const second = event(current.payment.id);
    const results = await behindLock(current.order.id, [
      () => payments.receiveSepay(first),
      () => payments.receiveSepay(second),
    ]);
    const statuses = results
      .flatMap((result) =>
        result.status === 'fulfilled' ? [result.value.status] : [],
      )
      .sort();
    expect(statuses).toEqual(
      [PaymentEventStatus.APPLIED, PaymentEventStatus.REJECTED].sort(),
    );
    expect((await state(current.payment.id)).transactions).toHaveLength(1);
  });

  it.each([
    'amount',
    'account',
    'direction',
    'unknown',
    'ambiguous',
    'subaccount',
  ] as const)(
    'audits unsafe/unmatched transfers without confirming payment: %s',
    async (kind) => {
      const current = await fixture();
      const payload = event(current.payment.id);
      const changed = { ...payload };
      if (kind === 'amount') changed.transferAmount = 99999;
      if (kind === 'account') changed.accountNumber = '1111111111';
      if (kind === 'direction') Object.assign(changed, { transferType: 'out' });
      if (kind === 'unknown')
        Object.assign(changed, { content: 'no payment reference', code: null });
      if (kind === 'ambiguous')
        changed.content += ` ${paymentReference(randomUUID())}`;
      if (kind === 'subaccount') changed.subAccount = 'UNKNOWNVA';
      await webhook(changed).expect(200);
      const recorded = await prisma.paymentEvent.findFirstOrThrow({
        where: { providerEventId: payload.id },
      });
      expect([
        PaymentEventStatus.REJECTED,
        PaymentEventStatus.IGNORED,
      ]).toContain(recorded.status);
      expect(recorded.reason).not.toBeNull();
      expect((await state(current.payment.id)).status).toBe(
        PaymentStatus.PENDING,
      );
      expect((await state(current.payment.id)).transactions).toHaveLength(0);
    },
  );

  it('confirms an explicitly configured official VA through HMAC and deduplicates its replay', async () => {
    config.set('SEPAY_TEST_VA', sandboxVa);
    const current = await fixture();
    const instructions = await request(app.getHttpServer())
      .get(`/api/payments/${current.payment.id}/vietqr`)
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    expect(instructions.body.data.accountNumber).toBe(sandboxVa);
    expect(new URL(instructions.body.data.qrUrl).pathname).toContain(sandboxVa);
    const payload = { ...event(current.payment.id), subAccount: sandboxVa };
    await webhook(payload).expect(200, { success: true });
    await webhook(payload).expect(200, { success: true });
    const paid = await state(current.payment.id);
    expect(paid.status).toBe(PaymentStatus.PAID);
    expect(paid.order.status).toBe(OrderStatus.CONFIRMED);
    expect(paid.transactions).toHaveLength(1);
    expect(await stock(current.listing.id)).toBe(0);
  });

  it.each(['missing', 'different', 'account', 'gateway', 'amount', 'reference', 'direction'] as const)(
    'does not let configured VA bypass any payment guard: %s', async (kind) => {
      config.set('SEPAY_TEST_VA', sandboxVa);
      const current = await fixture();
      const payload = { ...event(current.payment.id), subAccount: sandboxVa };
      if (kind === 'missing') payload.subAccount = '';
      if (kind === 'different') payload.subAccount = 'SBSEPAY000000000000';
      if (kind === 'account') payload.accountNumber = '1111111111';
      if (kind === 'gateway') payload.gateway = 'AnotherBank';
      if (kind === 'amount') payload.transferAmount = 99999;
      if (kind === 'reference') Object.assign(payload, { content: 'no payment code', code: null });
      if (kind === 'direction') Object.assign(payload, { transferType: 'out' });
      await webhook(payload).expect(200, { success: true });
      const audit = await prisma.paymentEvent.findFirstOrThrow({ where: { providerEventId: payload.id } });
      expect(audit.status).not.toBe(PaymentEventStatus.APPLIED);
      expect(audit.reason).not.toBeNull();
      if (kind === 'missing' || kind === 'different') expect(audit.reason).toBe('SUB_ACCOUNT_MISMATCH');
      if (kind === 'account' || kind === 'gateway') expect(audit.reason).toBe('WRONG_DESTINATION');
      if (kind === 'amount') expect(audit.reason).toBe('AMOUNT_MISMATCH');
      if (kind === 'reference') expect(audit.reason).toBe('UNMATCHED_REFERENCE');
      if (kind === 'direction') expect(audit.reason).toBe('OUTGOING_TRANSFER');
      const unchanged = await state(current.payment.id);
      expect(unchanged.status).toBe(PaymentStatus.PENDING);
      expect(unchanged.order.status).toBe(OrderStatus.PENDING);
      expect(unchanged.transactions).toHaveLength(0);
    },
  );

  it('never reprocesses an old ignored VA event when configuration is enabled later', async () => {
    const current = await fixture();
    const payload = { ...event(current.payment.id), subAccount: sandboxVa };
    await webhook(payload).expect(200);
    config.set('SEPAY_TEST_VA', sandboxVa);
    await webhook(payload).expect(200);
    expect(await prisma.paymentEvent.findFirstOrThrow({ where: { providerEventId: payload.id } })).toMatchObject({ status: PaymentEventStatus.IGNORED, reason: 'UNSUPPORTED_SUB_ACCOUNT' });
    expect((await state(current.payment.id)).transactions).toHaveLength(0);
    const fresh = { ...event(current.payment.id), subAccount: sandboxVa };
    await webhook(fresh).expect(200);
    expect((await state(current.payment.id)).transactions).toHaveLength(1);
  });

  it.each(['cancel', 'expire'] as const)('keeps VA payments protected after %s', async (operation) => {
    config.set('SEPAY_TEST_VA', sandboxVa);
    const current = await fixture();
    if (operation === 'cancel') await orders.cancelBuyerOrder(buyer, current.order.id, {});
    else await prisma.order.update({ where: { id: current.order.id }, data: { expiresAt: new Date(0) } });
    const payload = { ...event(current.payment.id), subAccount: sandboxVa };
    await webhook(payload).expect(200);
    const audit = await prisma.paymentEvent.findFirstOrThrow({ where: { providerEventId: payload.id } });
    expect(audit).toMatchObject({ status: PaymentEventStatus.REJECTED, reason: operation === 'cancel' ? 'ORDER_CANCELLED' : 'ORDER_EXPIRED' });
    const unchanged = await state(current.payment.id);
    expect(unchanged.status).not.toBe(PaymentStatus.PAID);
    expect(unchanged.transactions).toHaveLength(0);
  });

  it('never resurrects cancelled or expired orders', async () => {
    const cancelled = await fixture();
    await orders.cancelBuyerOrder(buyer, cancelled.order.id, {});
    await webhook(event(cancelled.payment.id)).expect(200);
    expect((await state(cancelled.payment.id)).status).toBe(
      PaymentStatus.CANCELLED,
    );
    expect(await stock(cancelled.listing.id)).toBe(1);
    const expired = await fixture();
    await prisma.order.update({
      where: { id: expired.order.id },
      data: { expiresAt: new Date(0) },
    });
    await webhook(event(expired.payment.id)).expect(200);
    expect((await state(expired.payment.id)).status).toBe(
      PaymentStatus.PENDING,
    );
    const sentinel = await expiredSentinel();
    const outside = await outsideState(expired);
    await expect(
      fixtureOrders(prisma, { id: expired.order.id }).expirePendingOrders(),
    ).resolves.toEqual({ expired: 1 });
    expect(await outsideState(expired)).toEqual(outside);
    expect((await state(sentinel.payment.id)).status).toBe(PaymentStatus.PENDING);
    expect(await stock(sentinel.listing.id)).toBe(0);
    expect(await stock(expired.listing.id)).toBe(1);
    expect((await state(expired.payment.id)).status).toBe(PaymentStatus.CANCELLED);
    expect((await state(expired.payment.id)).order.status).toBe(OrderStatus.CANCELLED);
    expect((await state(expired.payment.id)).transactions).toHaveLength(0);
  });

  it.each([-3600_000, 600_000])(
    'rejects provider event time before creation or too far in the future: %s ms',
    async (offset) => {
      const current = await fixture();
      const payload = event(current.payment.id);
      payload.transactionDate = new Date(Date.now() + offset + 7 * 3600_000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
      await webhook(payload).expect(200);
      expect(
        (
          await prisma.paymentEvent.findFirstOrThrow({
            where: { providerEventId: payload.id },
          })
        ).reason,
      ).toBe('INVALID_PAYMENT_TIME');
      expect((await state(current.payment.id)).status).toBe(
        PaymentStatus.PENDING,
      );
    },
  );

  it('does not treat a bank-transfer webhook as COD payment confirmation', async () => {
    const current = await fixture(PaymentMethod.COD);
    const payload = event(current.payment.id);
    await webhook(payload).expect(200);
    expect(
      (
        await prisma.paymentEvent.findFirstOrThrow({
          where: { providerEventId: payload.id },
        })
      ).reason,
    ).toBe('UNSUPPORTED_PAYMENT_METHOD');
    expect((await state(current.payment.id)).status).toBe(
      PaymentStatus.PENDING,
    );
    expect((await state(current.payment.id)).order.status).toBe(
      OrderStatus.CONFIRMED,
    );
  });

  it.each(['cancel', 'expire'] as const)(
    'serializes payment confirmation with %s without releasing paid stock',
    async (operation) => {
      const current = await fixture();
      const sentinel = await expiredSentinel();
      const outside = await outsideState(current);
      const payload = event(current.payment.id);
      const later = new Date(Date.now() + 3600_000);
      await behindLock<unknown>(current.order.id, [
        () => payments.receiveSepay(payload),
        () =>
          operation === 'cancel'
            ? orders.cancelBuyerOrder(buyer, current.order.id, {})
            : fixtureOrders(prisma, { id: current.order.id }).expirePendingOrders(later),
      ]);
      expect(await outsideState(current)).toEqual(outside);
      expect((await state(sentinel.payment.id)).status).toBe(PaymentStatus.PENDING);
      expect(await stock(sentinel.listing.id)).toBe(0);
      const final = await state(current.payment.id);
      if (final.status === PaymentStatus.PAID) {
        expect(final.order.status).toBe(OrderStatus.CONFIRMED);
        expect(await stock(current.listing.id)).toBe(0);
        expect(final.transactions).toHaveLength(1);
      } else {
        expect(final.status).toBe(PaymentStatus.CANCELLED);
        expect(final.order.status).toBe(OrderStatus.CANCELLED);
        expect(await stock(current.listing.id)).toBe(1);
        expect(final.transactions).toHaveLength(0);
      }
    },
  );

  it('rolls back event, order and payment if transaction-ledger persistence fails', async () => {
    const current = await fixture();
    const payload = event(current.payment.id);
    const blocker = await prisma.transaction.create({
      data: {
        paymentId: current.payment.id,
        transactionCode: `SEPAY_TEST:${payload.id}`,
        amount: '100000.00',
        status: 'FAILED',
      },
    });
    await webhook(payload).expect(409);
    expect((await state(current.payment.id)).status).toBe(
      PaymentStatus.PENDING,
    );
    expect((await state(current.payment.id)).order.status).toBe(
      OrderStatus.PENDING,
    );
    expect(
      await prisma.paymentEvent.count({
        where: { providerEventId: payload.id },
      }),
    ).toBe(0);
    await prisma.transaction.delete({ where: { id: blocker.id } });
    await webhook(payload).expect(200);
    expect((await state(current.payment.id)).status).toBe(PaymentStatus.PAID);
  });

  it('provides owned VietQR instructions derived from server totals and never exposes credentials', async () => {
    const current = await fixture();
    const server = request(app.getHttpServer());
    const response = await server
      .get(`/api/payments/${current.payment.id}/vietqr`)
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      testOnly: true,
      mode: 'sepay_test',
      amount: '100000',
      currency: 'VND',
      reference: paymentReference(current.payment.id),
      accountNumber: sandboxAccount,
    });
    const qr = new URL(response.body.data.qrUrl);
    expect(qr.hostname).toBe('img.vietqr.io');
    expect(qr.searchParams.get('amount')).toBe('100000');
    expect(qr.searchParams.get('addInfo')).toBe(
      paymentReference(current.payment.id),
    );
    expect(JSON.stringify(response.body)).not.toContain(secret);
    await server
      .get(`/api/payments/${current.payment.id}/vietqr`)
      .auth(otherToken, { type: 'bearer' })
      .expect(404);
    const fractional = await fixture(PaymentMethod.BANK_TRANSFER, '10.25');
    await server
      .get(`/api/payments/${fractional.payment.id}/vietqr`)
      .auth(buyerToken, { type: 'bearer' })
      .expect(422);
    await webhook(event(current.payment.id)).expect(200);
    await server
      .get(`/api/payments/${current.payment.id}/vietqr`)
      .auth(buyerToken, { type: 'bearer' })
      .expect(409);
  });

  it('limits mock confirmation to the owner in explicit mock mode and makes retries idempotent', async () => {
    const current = await fixture();
    const server = request(app.getHttpServer());
    const path = `/api/payments/${current.payment.id}/mock-confirm`;
    await server
      .post(path)
      .auth(buyerToken, { type: 'bearer' })
      .send({ idempotencyKey: 'mock-retry' })
      .expect(503);
    config.set('PAYMENT_MODE', 'mock');
    await server
      .post(path)
      .auth(otherToken, { type: 'bearer' })
      .send({ idempotencyKey: 'mock-retry' })
      .expect(404);
    const first = await server
      .post(path)
      .auth(buyerToken, { type: 'bearer' })
      .send({ idempotencyKey: 'mock-retry' })
      .expect(200);
    expect(first.body.data.status).toBe(PaymentEventStatus.APPLIED);
    const repeat = await server
      .post(`/api/payments/${current.payment.id.toUpperCase()}/mock-confirm`)
      .auth(buyerToken, { type: 'bearer' })
      .send({ idempotencyKey: 'mock-retry' })
      .expect(200);
    expect(repeat.body.data).toMatchObject({
      eventId: first.body.data.eventId,
      duplicate: true,
    });
    expect((await state(current.payment.id)).transactions).toHaveLength(1);
    await server
      .post(path)
      .auth(buyerToken, { type: 'bearer' })
      .send({ idempotencyKey: 'other', amount: 1, status: 'PAID' })
      .expect(422);
    const cod = await fixture(PaymentMethod.COD);
    await server
      .post(`/api/payments/${cod.payment.id}/mock-confirm`)
      .auth(buyerToken, { type: 'bearer' })
      .send({ idempotencyKey: 'cod' })
      .expect(409);
  });

  it('keeps payment details buyer-scoped and event audit/reconciliation admin-only', async () => {
    const current = await fixture();
    const server = request(app.getHttpServer());
    await server.get(`/api/payments/${current.payment.id}`).expect(401);
    await server
      .get(`/api/payments/${current.payment.id}`)
      .auth(otherToken, { type: 'bearer' })
      .expect(404);
    await server
      .get(`/api/payments/${current.payment.id}`)
      .auth(sellerToken, { type: 'bearer' })
      .expect(404);
    const response = await server
      .get(`/api/payments/${current.payment.id}`)
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    expect(Object.keys(response.body.data).sort()).toEqual(
      [
        'id',
        'orderId',
        'amount',
        'method',
        'status',
        'paidAt',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    await server
      .get('/api/admin/payments/events')
      .auth(buyerToken, { type: 'bearer' })
      .expect(403);
    await server
      .get('/api/admin/payments/events')
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    await server
      .post('/api/admin/payments/reconcile/sepay-test')
      .auth(buyerToken, { type: 'bearer' })
      .send(range())
      .expect(403);
  });

  function range() {
    return {
      from: new Date(Date.now() - 3600_000).toISOString(),
      to: new Date(Date.now() + 1000).toISOString(),
      page: 1,
    };
  }

  function apiRow(payload: ReturnType<typeof event>) {
    const id = randomUUID();
    eventIds.add(id);
    return {
      id,
      bank_account_id: sandboxBankId,
      bank_brand_name: payload.gateway,
      account_number: payload.accountNumber,
      transaction_date: payload.transactionDate,
      amount_in: payload.transferAmount,
      amount_out: 0,
      transfer_type: payload.transferType,
      transaction_content: payload.content,
      reference_number: payload.referenceCode,
      code: null,
      va: payload.subAccount || null,
    };
  }

  it.each([false, true])('reconciles missing events and coalesces webhook/API bank references (explicit VA: %s)', async (useVa) => {
    if (useVa) config.set('SEPAY_TEST_VA', sandboxVa);
    const delivered = await fixture();
    const lost = await fixture();
    const first = event(delivered.payment.id);
    const second = event(lost.payment.id);
    if (useVa) {
      first.subAccount = sandboxVa;
      second.subAccount = sandboxVa;
    }
    await webhook(first).expect(200);
    const rows = [apiRow(first), apiRow(second)];
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            status: 'success',
            data: rows,
            meta: { pagination: { current_page: 1, has_more: true } },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await request(app.getHttpServer())
      .post('/api/admin/payments/reconcile/sepay-test')
      .auth(adminToken, { type: 'bearer' })
      .send(range())
      .expect(200);
    expect(response.body.data).toMatchObject({
      testOnly: true,
      hasMore: true,
      nextPage: 2,
    });
    expect(response.body.data.results).toEqual([
      expect.objectContaining({
        duplicate: true,
        status: PaymentEventStatus.APPLIED,
      }),
      expect.objectContaining({
        duplicate: false,
        status: PaymentEventStatus.APPLIED,
      }),
    ]);
    expect((await state(lost.payment.id)).status).toBe(PaymentStatus.PAID);
    expect((await state(delivered.payment.id)).transactions).toHaveLength(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).origin).toBe('https://userapi-sandbox.sepay.vn');
    expect(options.redirect).toBe('error');
    expect(JSON.stringify(response.body)).not.toContain(
      'phase6-sandbox-test-token',
    );
    await webhook(second).expect(200);
    expect((await state(lost.payment.id)).transactions).toHaveLength(1);
    const extra = await fixture();
    const reusedAlias = { ...event(extra.payment.id), id: rows[0].id };
    await webhook(reusedAlias).expect(409);
    expect((await state(extra.payment.id)).status).toBe(PaymentStatus.PENDING);
  });

  it('fails reconciliation closed on bad upstream data, missing token or invalid range', async () => {
    const current = await fixture();
    const payload = event(current.payment.id);
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            status: 'success',
            data: [{ ...apiRow(payload), bank_account_id: randomUUID() }],
            meta: { pagination: { current_page: 1, has_more: false } },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const server = request(app.getHttpServer());
    await server
      .post('/api/admin/payments/reconcile/sepay-test')
      .auth(adminToken, { type: 'bearer' })
      .send(range())
      .expect(503);
    expect((await state(current.payment.id)).status).toBe(
      PaymentStatus.PENDING,
    );
    config.set('SEPAY_TEST_API_TOKEN', '');
    await server
      .post('/api/admin/payments/reconcile/sepay-test')
      .auth(adminToken, { type: 'bearer' })
      .send(range())
      .expect(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await server
      .post('/api/admin/payments/reconcile/sepay-test')
      .auth(adminToken, { type: 'bearer' })
      .send({ ...range(), from: '2026-01-01T00:00:00Z' })
      .expect(422);
  });
});
