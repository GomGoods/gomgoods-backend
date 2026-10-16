import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { Prisma } from '../src/generated/prisma/client.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ShipmentStatus,
} from '../src/generated/prisma/enums.js';
import { AccessTokenService } from '../src/modules/auth/access-token.service.js';
import { CartService } from '../src/modules/cart/cart.service.js';
import { CheckoutService } from '../src/modules/checkout/checkout.service.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { lockOrderForMutation } from '../src/modules/orders/order-lock.js';
import { ShipmentsService } from '../src/modules/shipments/shipments.service.js';
import {
  safeUserSelect,
  type SafeUser,
} from '../src/modules/users/user.select.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './helpers/create-test-app.js';

describe('Phase 5 PostgreSQL concurrency regressions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let carts: CartService;
  let checkout: CheckoutService;
  let orders: OrdersService;
  let shipments: ShipmentsService;
  let buyer: SafeUser;
  let otherBuyer: SafeUser;
  let seller: SafeUser;
  let owner: SafeUser;
  const userIds = Array.from({ length: 4 }, () => randomUUID());
  const addressIds = [randomUUID(), randomUUID()];
  const storeId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    carts = app.get(CartService);
    checkout = app.get(CheckoutService);
    orders = app.get(OrdersService);
    shipments = app.get(ShipmentsService);
    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: `${id}@phase5-race.e2e.gomgoods.local`,
        username: `p5_${id.slice(0, 24)}`,
        passwordHash: 'unused-e2e-hash',
      })),
    });
    await prisma.address.createMany({
      data: addressIds.map((id, index) => ({
        id,
        userId: userIds[index],
        recipient: 'Test Buyer',
        phone: '0900000000',
        addressLine: 'Test Address',
        city: 'Test City',
        district: 'Test District',
        ward: 'Test Ward',
      })),
    });
    await prisma.store.create({
      data: {
        id: storeId,
        userId: userIds[3],
        name: 'Race Store',
        status: 'ACTIVE',
      },
    });
    await prisma.category.create({
      data: { id: categoryId, name: `Race ${categoryId}` },
    });
    await prisma.product.create({
      data: { id: productId, storeId, categoryId, name: 'Race Product' },
    });
    [buyer, otherBuyer, seller, owner] = await Promise.all(
      userIds.map((id) =>
        prisma.user.findUniqueOrThrow({
          where: { id },
          select: safeUserSelect,
        }),
      ),
    );
  });

  afterAll(async () => {
    if (!app) return;
    try {
      const scope = { order: { userId: { in: userIds } } };
      await prisma.shipmentItem.deleteMany({ where: { shipment: scope } });
      await prisma.shipment.deleteMany({ where: scope });
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
        where: { OR: [{ sellerUserId: { in: userIds } }, { productId }] },
      });
      await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.store.deleteMany({ where: { id: storeId } });
      await prisma.category.deleteMany({ where: { id: categoryId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await app.close();
    }
  });

  async function listing(quantity = 2, store = false) {
    return prisma.listing.create({
      data: {
        ...(store ? { productId } : { sellerUserId: seller.id }),
        price: '10.25',
        quantity,
        condition: 'NEW',
        status: 'ACTIVE',
      },
    });
  }

  async function cartItem(user: SafeUser, listingId: string, quantity = 1) {
    return carts.addItem(user, { listingId, quantity });
  }

  function input(
    user: SafeUser,
    ids: string[],
    key = randomUUID(),
    method: PaymentMethod = PaymentMethod.COD,
  ) {
    return {
      idempotencyKey: key,
      addressId: user.id === buyer.id ? addressIds[0] : addressIds[1],
      cartItemIds: ids,
      paymentMethod: method,
    };
  }

  async function order(
    quantity = 2,
    method: PaymentMethod = PaymentMethod.COD,
  ) {
    const offer = await listing(quantity);
    const item = await cartItem(buyer, offer.id, quantity);
    const group = await checkout.checkout(
      buyer,
      input(buyer, [item.id], randomUUID(), method),
    );
    return { offer, order: group.orders[0] };
  }

  function shipmentInput(orderItemId: string, quantity: number) {
    return { carrier: 'Test Carrier', items: [{ orderItemId, quantity }] };
  }

  async function stock(id: string) {
    return (await prisma.listing.findUniqueOrThrow({ where: { id } })).quantity;
  }

  // Queue real requests behind a held PostgreSQL row lock; no sleeps standing
  // in for proof that transactions overlap. The observer waits for lock waiters.
  async function race<T>(
    lock: Prisma.Sql,
    jobs: (() => Promise<T>)[],
    beforeRelease?: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(lock);
        acquired();
        await held;
        await beforeRelease?.(tx);
      },
      { timeout: 10_000 },
    );
    await Promise.race([
      ready,
      holder.then(() => {
        throw new Error('Lock holder exited early');
      }),
    ]);
    const results = Promise.allSettled(jobs.map((job) => job()));
    try {
      await vi.waitFor(
        async () => {
          const [row] = await prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `;
          expect(row.count).toBeGreaterThanOrEqual(jobs.length);
        },
        { timeout: 2_000, interval: 10 },
      );
    } finally {
      release();
      await holder;
      await results;
    }
    return results;
  }

  const cartLock = () =>
    Prisma.sql`SELECT "user_id" FROM "USER" WHERE "user_id" = ${buyer.id}::uuid FOR NO KEY UPDATE`;
  const orderLock = (id: string) =>
    Prisma.sql`SELECT "order_id" FROM "ORDER" WHERE "order_id" = ${id}::uuid FOR UPDATE`;

  it('replays concurrent same-key checkout after the first consumes the cart', async () => {
    const offer = await listing();
    const item = await cartItem(buyer, offer.id);
    const payload = input(buyer, [item.id]);
    const results = await race(cartLock(), [
      () => checkout.checkout(buyer, payload),
      () => checkout.checkout(buyer, payload),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const values = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    expect(values[0]).toEqual(values[1]);
    expect(await stock(offer.id)).toBe(1);
    expect(
      await prisma.checkoutGroup.count({
        where: { userId: buyer.id, idempotencyKey: payload.idempotencyKey },
      }),
    ).toBe(1);
  });

  it('consumes a cart item once for concurrent different keys', async () => {
    const offer = await listing();
    const item = await cartItem(buyer, offer.id);
    const results = await race(cartLock(), [
      () => checkout.checkout(buyer, input(buyer, [item.id])),
      () => checkout.checkout(buyer, input(buyer, [item.id])),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.orderItem.count({ where: { listingId: offer.id } }),
    ).toBe(1);
    expect(await stock(offer.id)).toBe(1);
  });

  it('rejects a concurrent same-key request with changed payload', async () => {
    const offer = await listing();
    const item = await cartItem(buyer, offer.id);
    const payload = input(buyer, [item.id]);
    const results = await race(cartLock(), [
      () => checkout.checkout(buyer, payload),
      () => checkout.checkout(buyer, { ...payload, note: 'different' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'RESOURCE_CONFLICT' } });
    expect(await stock(offer.id)).toBe(1);
  });

  it('prevents overselling between different buyers', async () => {
    const offer = await listing(1);
    const first = await cartItem(buyer, offer.id);
    const second = await cartItem(otherBuyer, offer.id);
    const results = await race(
      Prisma.sql`SELECT "listing_id" FROM "LISTING" WHERE "listing_id" = ${offer.id}::uuid FOR UPDATE`,
      [
        () => checkout.checkout(buyer, input(buyer, [first.id])),
        () => checkout.checkout(otherBuyer, input(otherBuyer, [second.id])),
      ],
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await stock(offer.id)).toBe(0);
    expect(
      await prisma.orderItem.count({ where: { listingId: offer.id } }),
    ).toBe(1);
    expect(
      await prisma.cartItem.count({ where: { listingId: offer.id } }),
    ).toBe(1);
  });

  it('reads listing price only after a concurrent seller edit commits', async () => {
    const offer = await listing(2);
    const item = await cartItem(buyer, offer.id);
    const results = await race(
      Prisma.sql`SELECT "listing_id" FROM "LISTING" WHERE "listing_id" = ${offer.id}::uuid FOR UPDATE`,
      [() => checkout.checkout(buyer, input(buyer, [item.id]))],
      (tx) =>
        tx.listing.update({
          where: { id: offer.id },
          data: { price: '19.99' },
        }),
    );
    expect(results[0].status).toBe('fulfilled');
    const bought = await prisma.orderItem.findFirstOrThrow({
      where: { listingId: offer.id },
    });
    expect(bought.unitPrice.toFixed(2)).toBe('19.99');
    expect(bought.subtotal.toFixed(2)).toBe('19.99');
    expect(await stock(offer.id)).toBe(1);
  });

  it('preserves exact cents at the supported monetary boundary', async () => {
    const offer = await listing(3);
    await prisma.listing.update({
      where: { id: offer.id },
      data: { price: '333333333333.33' },
    });
    const item = await cartItem(buyer, offer.id, 3);
    const group = await checkout.checkout(buyer, input(buyer, [item.id]));
    expect(group.total.toFixed(2)).toBe('999999999999.99');
    expect(group.orders[0].total.toFixed(2)).toBe('999999999999.99');
    expect(group.orders[0].payments[0].amount.toFixed(2)).toBe(
      '999999999999.99',
    );
  });

  it('rejects monetary overflow without reserving stock or consuming the cart', async () => {
    const offer = await listing(2);
    await prisma.listing.update({
      where: { id: offer.id },
      data: { price: '999999999999.99' },
    });
    const item = await cartItem(buyer, offer.id, 2);
    const payload = input(buyer, [item.id]);
    await expect(checkout.checkout(buyer, payload)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
    });
    expect(await stock(offer.id)).toBe(2);
    expect(await prisma.cartItem.count({ where: { id: item.id } })).toBe(1);
    expect(
      await prisma.checkoutGroup.count({
        where: { userId: buyer.id, idempotencyKey: payload.idempotencyKey },
      }),
    ).toBe(0);
  });

  it('rejects additive cart quantity overflow without altering the existing item', async () => {
    const offer = await listing(1);
    const item = await cartItem(buyer, offer.id, 2_147_483_647);
    await expect(cartItem(buyer, offer.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
    });
    expect(
      (await prisma.cartItem.findUniqueOrThrow({ where: { id: item.id } }))
        .quantity,
    ).toBe(2_147_483_647);
    expect(await stock(offer.id)).toBe(1);
  });

  it('rolls back an earlier decrement, checkout group and cart consumption on later stock failure', async () => {
    const offers = [await listing(1), await listing(1)].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const first = await cartItem(buyer, offers[0].id);
    const second = await cartItem(buyer, offers[1].id, 2);
    const payload = input(buyer, [first.id, second.id]);
    await expect(checkout.checkout(buyer, payload)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    expect(await Promise.all(offers.map((offer) => stock(offer.id)))).toEqual([
      1, 1,
    ]);
    expect(
      await prisma.checkoutGroup.count({
        where: { userId: buyer.id, idempotencyKey: payload.idempotencyKey },
      }),
    ).toBe(0);
    expect(
      await prisma.orderItem.count({
        where: { listingId: { in: offers.map((offer) => offer.id) } },
      }),
    ).toBe(0);
    expect(
      await prisma.cartItem.count({
        where: { id: { in: [first.id, second.id] } },
      }),
    ).toBe(2);
  });

  it('serializes checkout with cart quantity edits without silently dropping an edit', async () => {
    const offer = await listing(3);
    const item = await cartItem(buyer, offer.id);
    const results = await race<unknown>(cartLock(), [
      () => checkout.checkout(buyer, input(buyer, [item.id])),
      () => carts.updateItem(buyer, item.id, { quantity: 2 }),
    ]);
    const bought = await prisma.orderItem.findFirstOrThrow({
      where: { listingId: offer.id },
    });
    expect(await stock(offer.id)).toBe(3 - bought.quantity);
    if (results[1].status === 'fulfilled') expect(bought.quantity).toBe(2);
    else
      expect(results[1].reason).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('does not over-allocate concurrent shipments', async () => {
    const fixture = await order(2);
    const payload = shipmentInput(fixture.order.items[0].id, 2);
    const results = await race(orderLock(fixture.order.id), [
      () => shipments.createShipment(seller, fixture.order.id, payload),
      () => shipments.createShipment(seller, fixture.order.id, payload),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const allocated = await prisma.shipmentItem.aggregate({
      where: { orderItemId: payload.items[0].orderItemId },
      _sum: { quantity: true },
    });
    expect(allocated._sum.quantity).toBe(2);
  });

  it('serializes cancellation with readiness without resurrecting released stock', async () => {
    const fixture = await order();
    const shipment = await shipments.createShipment(
      seller,
      fixture.order.id,
      shipmentInput(fixture.order.items[0].id, 2),
    );
    const results = await race<unknown>(orderLock(fixture.order.id), [
      () => orders.cancelSellerOrder(seller, fixture.order.id, {}),
      () => shipments.markReady(seller, shipment.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const current = await prisma.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    const currentShipment = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
    });
    if (current.status === OrderStatus.CANCELLED) {
      expect(currentShipment.status).toBe(ShipmentStatus.CANCELLED);
      expect(await stock(fixture.offer.id)).toBe(2);
      await expect(
        shipments.markShipped(seller, shipment.id),
      ).rejects.toMatchObject({ code: 'INVALID_SHIPMENT_STATUS_TRANSITION' });
    } else {
      expect(currentShipment.status).toBe(ShipmentStatus.READY_TO_SHIP);
      expect(await stock(fixture.offer.id)).toBe(0);
    }
  });

  it('serializes cancellation with shipment creation and rejects later fulfillment', async () => {
    const fixture = await order();
    await race<unknown>(orderLock(fixture.order.id), [
      () => orders.cancelSellerOrder(seller, fixture.order.id, {}),
      () =>
        shipments.createShipment(
          seller,
          fixture.order.id,
          shipmentInput(fixture.order.items[0].id, 2),
        ),
    ]);
    expect(
      (
        await prisma.order.findUniqueOrThrow({
          where: { id: fixture.order.id },
        })
      ).status,
    ).toBe(OrderStatus.CANCELLED);
    expect(await stock(fixture.offer.id)).toBe(2);
    const created = await prisma.shipment.findMany({
      where: { orderId: fixture.order.id },
    });
    expect(
      created.every((shipment) => shipment.status === ShipmentStatus.CANCELLED),
    ).toBe(true);
    for (const shipment of created) {
      await expect(
        shipments.markReady(seller, shipment.id),
      ).rejects.toMatchObject({ code: 'INVALID_SHIPMENT_STATUS_TRANSITION' });
    }
  });

  it('releases cancelled/expired prepaid stock exactly once under concurrency', async () => {
    const fixture = await order(2, PaymentMethod.BANK_TRANSFER);
    await prisma.order.update({
      where: { id: fixture.order.id },
      data: { expiresAt: new Date(0) },
    });
    await race<unknown>(orderLock(fixture.order.id), [
      () => orders.cancelBuyerOrder(buyer, fixture.order.id, {}),
      () => orders.expirePendingOrders(),
    ]);
    expect(await stock(fixture.offer.id)).toBe(2);
    expect(
      (
        await prisma.order.findUniqueOrThrow({
          where: { id: fixture.order.id },
        })
      ).status,
    ).toBe(OrderStatus.CANCELLED);
    expect(
      (
        await prisma.payment.findFirstOrThrow({
          where: { orderId: fixture.order.id },
        })
      ).status,
    ).toBe(PaymentStatus.CANCELLED);
    await orders.expirePendingOrders();
    await expect(
      orders.cancelBuyerOrder(buyer, fixture.order.id, {}),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_CANCELLABLE' });
    expect(await stock(fixture.offer.id)).toBe(2);
  });

  it('expires a prepaid order once when two expiration workers overlap', async () => {
    const fixture = await order(2, PaymentMethod.BANK_TRANSFER);
    await prisma.order.update({
      where: { id: fixture.order.id },
      data: { expiresAt: new Date(0) },
    });
    const results = await race(orderLock(fixture.order.id), [
      () => orders.expirePendingOrders(),
      () => orders.expirePendingOrders(),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const total = results.reduce(
      (sum, result) =>
        sum + (result.status === 'fulfilled' ? result.value.expired : 0),
      0,
    );
    expect(total).toBe(1);
    expect(await stock(fixture.offer.id)).toBe(2);
    expect(
      (
        await prisma.payment.findFirstOrThrow({
          where: { orderId: fixture.order.id },
        })
      ).status,
    ).toBe(PaymentStatus.CANCELLED);
  });

  it.each(['seller', 'buyer', 'expire'] as const)(
    'rechecks payment after waiting for a concurrent payment update (%s)',
    async (mode) => {
      const fixture = await order(
        1,
        mode === 'seller' ? PaymentMethod.COD : PaymentMethod.BANK_TRANSFER,
      );
      await prisma.order.update({
        where: { id: fixture.order.id },
        data: { expiresAt: new Date(0) },
      });
      const payment = await prisma.payment.findFirstOrThrow({
        where: { orderId: fixture.order.id },
      });
      const results = await race<unknown>(
        Prisma.sql`SELECT "payment_id" FROM "PAYMENT" WHERE "payment_id" = ${payment.id}::uuid FOR UPDATE`,
        [
          () =>
            mode === 'seller'
              ? orders.cancelSellerOrder(seller, fixture.order.id, {})
              : mode === 'buyer'
                ? orders.cancelBuyerOrder(buyer, fixture.order.id, {})
                : orders.expirePendingOrders(),
        ],
        (tx) =>
          tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.PAID },
          }),
      );
      if (mode === 'expire')
        expect(results[0]).toMatchObject({
          status: 'fulfilled',
          value: { expired: 0 },
        });
      else
        expect(results[0]).toMatchObject({
          status: 'rejected',
          reason: { code: 'ORDER_NOT_CANCELLABLE' },
        });
      expect(await stock(fixture.offer.id)).toBe(0);
      expect(
        (
          await prisma.order.findUniqueOrThrow({
            where: { id: fixture.order.id },
          })
        ).cancelledAt,
      ).toBeNull();
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }))
          .status,
      ).toBe(PaymentStatus.PAID);
    },
  );

  it('uses the Phase 6 lock/CAS contract to reject payment confirmation after expiry', async () => {
    const fixture = await order(1, PaymentMethod.BANK_TRANSFER);
    await prisma.order.update({
      where: { id: fixture.order.id },
      data: { expiresAt: new Date(0) },
    });
    await orders.expirePendingOrders();
    const changed = await prisma.$transaction(async (tx) => {
      await lockOrderForMutation(tx, fixture.order.id);
      return tx.payment.updateMany({
        where: {
          orderId: fixture.order.id,
          status: PaymentStatus.PENDING,
          order: { status: OrderStatus.PENDING, cancelledAt: null },
        },
        data: { status: PaymentStatus.PAID },
      });
    });
    expect(changed.count).toBe(0);
    expect(await stock(fixture.offer.id)).toBe(1);
  });

  it('keeps payment, cancellation and stock consistent when a lock/CAS confirmation competes with cancel', async () => {
    const fixture = await order(1, PaymentMethod.BANK_TRANSFER);
    await race<unknown>(orderLock(fixture.order.id), [
      () => orders.cancelBuyerOrder(buyer, fixture.order.id, {}),
      () =>
        prisma.$transaction(async (tx) => {
          await lockOrderForMutation(tx, fixture.order.id);
          const confirmed = await tx.order.updateMany({
            where: {
              id: fixture.order.id,
              status: OrderStatus.PENDING,
              cancelledAt: null,
              expiresAt: { gt: new Date() },
              payments: { every: { status: PaymentStatus.PENDING } },
            },
            data: { status: OrderStatus.CONFIRMED },
          });
          if (confirmed.count === 1) {
            await tx.payment.updateMany({
              where: {
                orderId: fixture.order.id,
                status: PaymentStatus.PENDING,
              },
              data: { status: PaymentStatus.PAID },
            });
          }
          return confirmed;
        }),
    ]);
    const current = await prisma.order.findUniqueOrThrow({
      where: { id: fixture.order.id },
    });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: fixture.order.id },
    });
    if (current.status === OrderStatus.CANCELLED) {
      expect(payment.status).toBe(PaymentStatus.CANCELLED);
      expect(await stock(fixture.offer.id)).toBe(1);
    } else {
      expect(current.status).toBe(OrderStatus.CONFIRMED);
      expect(payment.status).toBe(PaymentStatus.PAID);
      expect(await stock(fixture.offer.id)).toBe(0);
    }
  });

  it('allows only one concurrent transition from READY_TO_SHIP', async () => {
    const fixture = await order(1);
    const shipment = await shipments.createShipment(
      seller,
      fixture.order.id,
      shipmentInput(fixture.order.items[0].id, 1),
    );
    await shipments.markReady(seller, shipment.id);
    const results = await race(orderLock(fixture.order.id), [
      () => shipments.markShipped(seller, shipment.id),
      () => shipments.markShipped(seller, shipment.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'INVALID_SHIPMENT_STATUS_TRANSITION' } });
    await expect(
      orders.cancelSellerOrder(seller, fixture.order.id, {}),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_CANCELLABLE' });
    expect(await stock(fixture.offer.id)).toBe(0);
  });

  it('tracks partial shipping/delivery by quantities and permits shipping the remainder', async () => {
    const fixture = await order(3);
    const first = await shipments.createShipment(
      seller,
      fixture.order.id,
      shipmentInput(fixture.order.items[0].id, 1),
    );
    await shipments.markReady(seller, first.id);
    await shipments.markShipped(seller, first.id);
    expect((await orders.findBuyerOrder(buyer, fixture.order.id)).status).toBe(
      OrderStatus.PARTIALLY_SHIPPED,
    );
    await shipments.confirmDelivered(buyer, first.id);
    expect((await orders.findBuyerOrder(buyer, fixture.order.id)).status).toBe(
      OrderStatus.PARTIALLY_SHIPPED,
    );
    const second = await shipments.createShipment(
      seller,
      fixture.order.id,
      shipmentInput(fixture.order.items[0].id, 2),
    );
    await shipments.markReady(seller, second.id);
    await shipments.markShipped(seller, second.id);
    expect((await orders.findBuyerOrder(buyer, fixture.order.id)).status).toBe(
      OrderStatus.SHIPPED,
    );
    await shipments.confirmDelivered(buyer, second.id);
    expect((await orders.findBuyerOrder(buyer, fixture.order.id)).status).toBe(
      OrderStatus.DELIVERED,
    );
  });

  it('serializes parallel delivery confirmations so the final order is delivered', async () => {
    const fixture = await order(2);
    const first = await shipments.createShipment(
      seller,
      fixture.order.id,
      shipmentInput(fixture.order.items[0].id, 1),
    );
    const second = await shipments.createShipment(
      seller,
      fixture.order.id,
      shipmentInput(fixture.order.items[0].id, 1),
    );
    for (const shipment of [first, second]) {
      await shipments.markReady(seller, shipment.id);
      await shipments.markShipped(seller, shipment.id);
    }
    const results = await race(orderLock(fixture.order.id), [
      () => shipments.confirmDelivered(buyer, first.id),
      () => shipments.confirmDelivered(buyer, second.id),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await orders.findBuyerOrder(buyer, fixture.order.id)).status).toBe(
      OrderStatus.DELIVERED,
    );
  });

  it('does not complete a multi-item order when only one order item has been delivered', async () => {
    const firstOffer = await listing(1);
    const secondOffer = await listing(2);
    const items = [
      await cartItem(buyer, firstOffer.id),
      await cartItem(buyer, secondOffer.id, 2),
    ];
    const group = await checkout.checkout(
      buyer,
      input(
        buyer,
        items.map((item) => item.id),
      ),
    );
    const current = group.orders[0];
    const firstItem = current.items.find(
      (item) => item.listingId === firstOffer.id,
    )!;
    const secondItem = current.items.find(
      (item) => item.listingId === secondOffer.id,
    )!;
    const first = await shipments.createShipment(
      seller,
      current.id,
      shipmentInput(firstItem.id, 1),
    );
    await shipments.markReady(seller, first.id);
    await shipments.markShipped(seller, first.id);
    await shipments.confirmDelivered(buyer, first.id);
    expect((await orders.findBuyerOrder(buyer, current.id)).status).toBe(
      OrderStatus.PARTIALLY_SHIPPED,
    );
    const second = await shipments.createShipment(
      seller,
      current.id,
      shipmentInput(secondItem.id, 2),
    );
    await shipments.markReady(seller, second.id);
    await shipments.markShipped(seller, second.id);
    expect((await orders.findBuyerOrder(buyer, current.id)).status).toBe(
      OrderStatus.SHIPPED,
    );
    await shipments.confirmDelivered(buyer, second.id);
    expect((await orders.findBuyerOrder(buyer, current.id)).status).toBe(
      OrderStatus.DELIVERED,
    );
  });

  it('enforces multi-seller privacy and rejects foreign cart/address/order/shipment access over HTTP', async () => {
    const personal = await listing();
    const store = await listing(2, true);
    const items = await Promise.all([
      cartItem(buyer, personal.id),
      cartItem(buyer, store.id),
    ]);
    const group = await checkout.checkout(
      buyer,
      input(
        buyer,
        items.map((item) => item.id),
      ),
    );
    const personalOrder = group.orders.find(
      (order) => order.sellerUserId === seller.id,
    )!;
    const storeOrder = group.orders.find((order) => order.storeId === storeId)!;
    const shipment = await shipments.createShipment(
      seller,
      personalOrder.id,
      shipmentInput(personalOrder.items[0].id, 1),
    );
    async function token(user: SafeUser) {
      const session = await prisma.authSession.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
      });
      return (
        await app
          .get(AccessTokenService)
          .sign({ sub: user.id, sid: session.id, accountType: 'USER' })
      ).accessToken;
    }
    const [sellerToken, ownerToken, otherToken] = await Promise.all([
      token(seller),
      token(owner),
      token(otherBuyer),
    ]);
    const server = request(app.getHttpServer());
    const response = await server
      .get(`/api/seller/orders/${personalOrder.id}`)
      .auth(sellerToken, { type: 'bearer' })
      .expect(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].listingId).toBe(personal.id);
    const forbidden = new Set([
      'password',
      'passwordHash',
      'email',
      'refreshToken',
      'refreshCredentials',
      'sessions',
      'requestHash',
      'idempotencyKey',
    ]);
    function checkPrivate(value: unknown) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        expect(forbidden.has(key), `Forbidden field: ${key}`).toBe(false);
        checkPrivate(child);
      }
    }
    checkPrivate(response.body.data);
    await server
      .get(`/api/seller/orders/${storeOrder.id}`)
      .auth(sellerToken, { type: 'bearer' })
      .expect(404);
    await server
      .get(`/api/seller/orders/${personalOrder.id}`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(404);
    await server
      .get(`/api/orders/${personalOrder.id}`)
      .auth(otherToken, { type: 'bearer' })
      .expect(404);
    await server
      .patch(`/api/shipments/${shipment.id}/ready`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(404);
    await server
      .patch(`/api/shipments/${shipment.id}/confirm-delivery`)
      .auth(otherToken, { type: 'bearer' })
      .expect(404);
    const foreign = await cartItem(buyer, personal.id);
    await server
      .patch(`/api/cart/items/${foreign.id}`)
      .auth(otherToken, { type: 'bearer' })
      .send({ quantity: 2 })
      .expect(404);
    await server
      .post('/api/checkout')
      .auth(otherToken, { type: 'bearer' })
      .send(input(otherBuyer, [foreign.id]))
      .expect(404);
    await server
      .post('/api/checkout')
      .auth(otherToken, { type: 'bearer' })
      .send({ ...input(otherBuyer, [foreign.id]), addressId: addressIds[0] })
      .expect(404);
    await server
      .post('/api/checkout')
      .auth(otherToken, { type: 'bearer' })
      .send({ ...input(otherBuyer, [foreign.id]), idempotencyKey: '   ' })
      .expect(422);
    await server
      .post('/api/cart/items')
      .auth(otherToken, { type: 'bearer' })
      .send({ listingId: personal.id, quantity: 2_147_483_648 })
      .expect(422);
    await server
      .post(`/api/orders/${personalOrder.id}/shipments`)
      .auth(sellerToken, { type: 'bearer' })
      .send({ ...shipmentInput(personalOrder.items[0].id, 1), carrier: '   ' })
      .expect(422);
  });
});
