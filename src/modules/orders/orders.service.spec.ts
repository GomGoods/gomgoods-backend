import { describe, expect, it, vi } from 'vitest';

import { OrdersService } from './orders.service.js';

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

describe('OrdersService', () => {
  it('cancels pending buyer orders and releases inventory once', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      order: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'order-1' }),
      },
      orderItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            listingId: '00000000-0000-4000-8000-000000000050',
            quantity: 2,
          },
        ]),
      },
      listing: { update: vi.fn().mockResolvedValue({}) },
      shipment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = { $transaction: vi.fn((callback) => callback(tx)) };
    const service = new OrdersService(prisma as never);

    await expect(
      service.cancelBuyerOrder(
        user,
        '00000000-0000-4000-8000-000000000060',
        {},
      ),
    ).resolves.toEqual({ id: 'order-1' });
    expect(tx.listing.update).toHaveBeenCalledWith({
      where: { id: '00000000-0000-4000-8000-000000000050' },
      data: { quantity: { increment: 2 } },
    });
  });

  it('does not release inventory when a buyer order is no longer cancellable', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      order: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      orderItem: { findMany: vi.fn() },
      listing: { update: vi.fn() },
      shipment: { updateMany: vi.fn() },
      payment: { updateMany: vi.fn() },
    };
    const prisma = { $transaction: vi.fn((callback) => callback(tx)) };
    const service = new OrdersService(prisma as never);

    await expect(
      service.cancelBuyerOrder(
        user,
        '00000000-0000-4000-8000-000000000060',
        {},
      ),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_CANCELLABLE', status: 409 });
    expect(tx.orderItem.findMany).not.toHaveBeenCalled();
    expect(tx.listing.update).not.toHaveBeenCalled();
  });
});
