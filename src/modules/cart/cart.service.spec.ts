import { describe, expect, it, vi } from 'vitest';

import {
  CategoryStatus,
  ListingStatus,
  ProductStatus,
  StoreStatus,
} from '../../generated/prisma/enums.js';
import { CartService } from './cart.service.js';

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

function transactional<T extends object>(prisma: T) {
  return Object.assign(prisma, {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((callback) => callback(prisma)),
  });
}

describe('CartService', () => {
  it('blocks adding a listing owned by the current personal seller', async () => {
    const prisma = {
      cart: {
        upsert: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000010',
        }),
      },
      listing: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000020',
          sellerUserId: user.id,
          status: ListingStatus.ACTIVE,
          quantity: 1,
          sellerUser: { status: 'ACTIVE' },
          product: null,
        }),
      },
      cartItem: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    };
    const service = new CartService(transactional(prisma) as never);

    await expect(
      service.addItem(user, {
        listingId: '00000000-0000-4000-8000-000000000020',
        quantity: 1,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it('flags unavailable cart items without deleting them', async () => {
    const prisma = {
      cart: {
        upsert: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000010',
        }),
      },
      cartItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000030',
            cartId: '00000000-0000-4000-8000-000000000010',
            listingId: '00000000-0000-4000-8000-000000000020',
            quantity: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            listing: {
              id: '00000000-0000-4000-8000-000000000020',
              productId: null,
              sellerUserId: '00000000-0000-4000-8000-000000000099',
              price: '10.00',
              quantity: 0,
              condition: 'GOOD',
              description: null,
              status: ListingStatus.ACTIVE,
              sellerUser: {
                id: '00000000-0000-4000-8000-000000000099',
                username: 'seller',
                status: 'ACTIVE',
              },
              product: null,
            },
          },
        ]),
      },
    };
    const service = new CartService(transactional(prisma) as never);

    await expect(service.getCurrentCart(user)).resolves.toMatchObject({
      items: [{ available: false, unavailableReason: 'OUT_OF_STOCK' }],
    });
  });

  it('allows active store-backed listings from another owner', async () => {
    const prisma = {
      cart: {
        upsert: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000010',
        }),
      },
      listing: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000020',
          sellerUserId: null,
          status: ListingStatus.ACTIVE,
          quantity: 2,
          sellerUser: null,
          product: {
            status: ProductStatus.ACTIVE,
            category: { status: CategoryStatus.ACTIVE },
            store: {
              userId: '00000000-0000-4000-8000-000000000099',
              status: StoreStatus.ACTIVE,
            },
          },
        }),
      },
      cartItem: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000030',
          cartId: '00000000-0000-4000-8000-000000000010',
          listingId: '00000000-0000-4000-8000-000000000020',
          quantity: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          listing: {
            id: '00000000-0000-4000-8000-000000000020',
            productId: '00000000-0000-4000-8000-000000000040',
            sellerUserId: null,
            price: '10.00',
            quantity: 2,
            condition: 'GOOD',
            description: null,
            status: ListingStatus.ACTIVE,
            sellerUser: null,
            product: {
              id: '00000000-0000-4000-8000-000000000040',
              name: 'Product',
              description: null,
              status: ProductStatus.ACTIVE,
              category: {
                id: '00000000-0000-4000-8000-000000000050',
                name: 'Category',
                status: CategoryStatus.ACTIVE,
              },
              store: {
                id: '00000000-0000-4000-8000-000000000060',
                name: 'Store',
                avatarUrl: null,
                status: StoreStatus.ACTIVE,
                userId: '00000000-0000-4000-8000-000000000099',
                user: {
                  id: '00000000-0000-4000-8000-000000000099',
                  username: 'owner',
                },
              },
            },
          },
        }),
      },
    };
    const service = new CartService(transactional(prisma) as never);

    await expect(
      service.addItem(user, {
        listingId: '00000000-0000-4000-8000-000000000020',
        quantity: 1,
      }),
    ).resolves.toMatchObject({ available: true, unavailableReason: null });
  });
});
