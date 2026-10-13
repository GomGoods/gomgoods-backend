import { describe, expect, it, vi } from 'vitest';

import { DiscoveryService } from './discovery.service.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

function listing(id: string) {
  return {
    id,
    productId: null,
    sellerUserId: '00000000-0000-4000-8000-000000000001',
    price: '100.00',
    quantity: 1,
    condition: 'GOOD',
    description: 'Discovery listing',
    status: 'ACTIVE',
    createdAt,
    updatedAt: createdAt,
    images: [],
    sellerUser: { id: '00000000-0000-4000-8000-000000000001', username: 'u' },
    product: null,
  };
}

describe('DiscoveryService', () => {
  it('uses limit plus one and returns a filter-bound cursor', async () => {
    const prisma = {
      listing: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            listing('00000000-0000-4000-8000-000000000003'),
            listing('00000000-0000-4000-8000-000000000002'),
            listing('00000000-0000-4000-8000-000000000001'),
          ]),
      },
    };
    const service = new DiscoveryService(prisma as never);

    const result = await service.findListings({
      limit: 2,
      sellerType: 'personal',
    });

    expect(prisma.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
      }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.nextCursor).toEqual(expect.any(String));
  });

  it('rejects cursors when filters change between pages', async () => {
    const prisma = {
      listing: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            listing('00000000-0000-4000-8000-000000000002'),
            listing('00000000-0000-4000-8000-000000000001'),
          ]),
      },
    };
    const service = new DiscoveryService(prisma as never);
    const firstPage = await service.findListings({
      limit: 1,
      sellerType: 'personal',
    });

    await expect(
      service.findListings({
        limit: 1,
        sellerType: 'store',
        cursor: firstPage.pageInfo.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
  });

  it('validates minPrice is less than or equal to maxPrice', async () => {
    const prisma = {
      listing: { findMany: vi.fn() },
    };
    const service = new DiscoveryService(prisma as never);

    await expect(
      service.findListings({ limit: 20, minPrice: '2.00', maxPrice: '1.00' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(prisma.listing.findMany).not.toHaveBeenCalled();
  });
});
