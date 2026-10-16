import { describe, expect, it, vi } from 'vitest';

import {
  ListingStatus,
  ProductStatus,
  StoreStatus,
} from '../../generated/prisma/enums.js';
import { ProductQueryDto } from './dto/product-query.dto.js';
import { ProductsService } from './products.service.js';

const safeUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@gomgoods.local',
  username: 'owner',
  accountType: 'USER',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  store: null,
} as const;

describe('ProductsService', () => {
  it('delegates active-store enforcement before product creation', async () => {
    const prisma = {
      category: { findFirst: vi.fn() },
      product: { create: vi.fn() },
    };
    const stores = {
      requireActiveOwnedStore: vi.fn().mockRejectedValue(
        Object.assign(new Error('Store inactive'), {
          code: 'STORE_NOT_ACTIVE',
          status: 403,
        }),
      ),
    };
    const service = new ProductsService(prisma as never, stores as never);

    await expect(
      service.create(safeUser, {
        categoryId: '00000000-0000-4000-8000-000000000030',
        name: 'Nendoroid',
      }),
    ).rejects.toMatchObject({ code: 'STORE_NOT_ACTIVE', status: 403 });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('filters public product queries to active stores and categories', async () => {
    const prisma = {
      product: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn((operations) => Promise.all(operations)),
    };
    const service = new ProductsService(prisma as never, {} as never);

    await expect(service.findAll(new ProductQueryDto())).resolves.toMatchObject({
      items: [],
      meta: { total: 0 },
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ProductStatus.ACTIVE,
          store: { status: StoreStatus.ACTIVE },
          category: { status: 'ACTIVE' },
        }),
      }),
    );
  });


  it('archives a product and soft-removes only non-terminal related listings atomically', async () => {
    const productId = '00000000-0000-4000-8000-000000000040';
    const transaction = {
      listing: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      product: {
        update: vi.fn().mockResolvedValue({
          id: productId,
          status: ProductStatus.ARCHIVED,
        }),
      },
    };
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: productId,
          status: ProductStatus.ACTIVE,
          store: { userId: safeUser.id, status: StoreStatus.ACTIVE },
        }),
      },
      $transaction: vi.fn((callback) => callback(transaction)),
    };
    const service = new ProductsService(prisma as never, {} as never);

    await expect(service.archive(productId, safeUser)).resolves.toMatchObject({
      status: ProductStatus.ARCHIVED,
    });
    expect(transaction.listing.updateMany).toHaveBeenCalledWith({
      where: {
        productId,
        status: {
          in: [
            ListingStatus.DRAFT,
            ListingStatus.ACTIVE,
            ListingStatus.INACTIVE,
          ],
        },
      },
      data: { status: ListingStatus.REMOVED },
    });
    expect(transaction.product.update).toHaveBeenCalledWith({
      where: { id: productId },
      data: { status: ProductStatus.ARCHIVED },
      select: expect.any(Object),
    });
  });

  it('rejects updates to archived products', async () => {
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000040',
          status: ProductStatus.ARCHIVED,
          store: { userId: safeUser.id, status: StoreStatus.ACTIVE },
        }),
        update: vi.fn(),
      },
    };
    const service = new ProductsService(prisma as never, {} as never);

    await expect(
      service.update('00000000-0000-4000-8000-000000000040', safeUser, {
        name: 'Archived',
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_ACTIVE', status: 409 });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});
