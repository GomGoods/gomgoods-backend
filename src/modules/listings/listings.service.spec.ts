import { describe, expect, it, vi } from 'vitest';

import {
  ListingCondition,
  ListingStatus,
  ProductStatus,
  StoreStatus,
} from '../../generated/prisma/enums.js';
import { ListingQueryDto } from './dto/listing-query.dto.js';
import { ListingsService } from './listings.service.js';

const owner = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@gomgoods.local',
  username: 'owner',
  accountType: 'USER',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  store: null,
} as const;

describe('ListingsService', () => {
  it('rejects edits to removed listings', async () => {
    const prisma = {
      listing: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000050',
          status: ListingStatus.REMOVED,
          sellerUserId: owner.id,
          product: null,
        }),
        update: vi.fn(),
      },
    };
    const service = new ListingsService(prisma as never);

    await expect(
      service.update('00000000-0000-4000-8000-000000000050', owner, {
        price: '1000',
      }),
    ).rejects.toMatchObject({ code: 'LISTING_NOT_EDITABLE', status: 409 });
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('rejects wrong-owner listing mutations', async () => {
    const prisma = {
      listing: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000050',
          status: ListingStatus.ACTIVE,
          sellerUserId: '00000000-0000-4000-8000-000000000099',
          product: null,
        }),
        update: vi.fn(),
      },
    };
    const service = new ListingsService(prisma as never);

    await expect(
      service.updateStatus('00000000-0000-4000-8000-000000000050', owner, {
        status: ListingStatus.INACTIVE,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('validates minPrice is less than or equal to maxPrice', async () => {
    const prisma = {
      listing: { findMany: vi.fn(), count: vi.fn() },
      $transaction: vi.fn(),
    };
    const service = new ListingsService(prisma as never);

    await expect(
      service.findAll(
        Object.assign(new ListingQueryDto(), {
          minPrice: '100.00',
          maxPrice: '99.99',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires store-backed listings to belong to an active owned product', async () => {
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000060',
          status: ProductStatus.ARCHIVED,
          store: { userId: owner.id, status: StoreStatus.ACTIVE },
        }),
      },
      listing: { create: vi.fn() },
    };
    const service = new ListingsService(prisma as never);

    await expect(
      service.createForProduct(
        '00000000-0000-4000-8000-000000000060',
        owner,
        {
          price: '1000',
          quantity: 1,
          condition: ListingCondition.NEW,
        },
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_ACTIVE', status: 403 });
    expect(prisma.listing.create).not.toHaveBeenCalled();
  });
});
