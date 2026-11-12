import { describe, expect, it, vi } from 'vitest';

import { PaymentMethod } from '../../generated/prisma/enums.js';
import { CheckoutService } from './checkout.service.js';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'buyer@gomgoods.local',
  username: 'buyer',
  accountType: 'USER',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  store: null,
} as const;

describe('CheckoutService', () => {
  it('rejects reused idempotency keys with a different payload', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      cart: { upsert: vi.fn().mockResolvedValue({ id: 'cart-1' }) },
      checkoutGroup: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000010',
          requestHash: 'different-hash',
        }),
      },
    };
    const service = new CheckoutService({
      $transaction: vi.fn((callback) => callback(prisma)),
    } as never);

    await expect(
      service.checkout(user, {
        idempotencyKey: 'same-key',
        addressId: '00000000-0000-4000-8000-000000000020',
        paymentMethod: PaymentMethod.COD,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
  });

  it('rejects checkout when atomic stock decrement cannot update a listing', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      address: {
        findFirst: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000020',
          recipient: 'Buyer',
          phone: '0900000000',
          addressLine: '1 Test',
          city: 'City',
          district: 'District',
          ward: 'Ward',
        }),
      },
      cart: {
        upsert: vi.fn().mockResolvedValue({ id: 'cart-1' }),
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000030',
        }),
      },
      cartItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000040',
            listingId: '00000000-0000-4000-8000-000000000050',
            quantity: 1,
            listing: {
              id: '00000000-0000-4000-8000-000000000050',
              productId: null,
              sellerUserId: '00000000-0000-4000-8000-000000000099',
              price: '10.00',
              quantity: 1,
              condition: 'GOOD',
              description: null,
              status: 'ACTIVE',
              sellingMode: 'FIXED_PRICE',
              sellerUser: {
                id: '00000000-0000-4000-8000-000000000099',
                username: 'seller',
                status: 'ACTIVE',
              },
              product: null,
            },
          },
        ]),
        deleteMany: vi.fn(),
      },
      checkoutGroup: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000060',
        }),
      },
      listing: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      order: { create: vi.fn() },
      payment: { create: vi.fn() },
    };
    const prisma = {
      checkoutGroup: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new CheckoutService(prisma as never);

    await expect(
      service.checkout(user, {
        idempotencyKey: 'stock-key',
        addressId: '00000000-0000-4000-8000-000000000020',
        paymentMethod: PaymentMethod.COD,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409 });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
  });
});
