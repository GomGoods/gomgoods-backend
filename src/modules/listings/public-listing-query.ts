import type { Prisma } from '../../generated/prisma/client.js';
import {
  CategoryStatus,
  ListingCondition,
  ListingStatus,
  ProductStatus,
  StoreStatus,
  UserStatus,
} from '../../generated/prisma/enums.js';

export interface PublicListingFilters {
  id?: string;
  q?: string;
  condition?: ListingCondition;
  minPrice?: string;
  maxPrice?: string;
  sellerType?: 'personal' | 'store';
  productId?: string;
  sellerUserId?: string;
  categoryId?: string;
  storeId?: string;
}

export type ListingSort = 'newest' | 'oldest' | 'price_asc' | 'price_desc';

export function publicListingWhere(
  filters: PublicListingFilters,
): Prisma.ListingWhereInput {
  const and: Prisma.ListingWhereInput[] = [
    { status: ListingStatus.ACTIVE },
    { sellingMode: 'FIXED_PRICE' },
    { quantity: { gt: 0 } },
    {
      OR: [
        {
          product: {
            status: ProductStatus.ACTIVE,
            category: { status: CategoryStatus.ACTIVE },
            store: { status: StoreStatus.ACTIVE },
          },
        },
        {
          sellerUser: {
            status: UserStatus.ACTIVE,
          },
        },
      ],
    },
  ];

  if (filters.id) and.push({ id: filters.id });
  if (filters.condition) and.push({ condition: filters.condition });
  if (filters.productId) and.push({ productId: filters.productId });
  if (filters.sellerUserId) and.push({ sellerUserId: filters.sellerUserId });
  if (filters.minPrice || filters.maxPrice) {
    and.push({
      price: {
        ...(filters.minPrice ? { gte: filters.minPrice } : {}),
        ...(filters.maxPrice ? { lte: filters.maxPrice } : {}),
      },
    });
  }
  if (filters.sellerType === 'personal') and.push({ sellerUserId: { not: null } });
  if (filters.sellerType === 'store') and.push({ productId: { not: null } });
  if (filters.categoryId) {
    and.push({ product: { categoryId: filters.categoryId } });
  }
  if (filters.storeId) {
    and.push({ product: { storeId: filters.storeId } });
  }
  if (filters.q) {
    and.push({
      OR: [
        { description: { contains: filters.q, mode: 'insensitive' } },
        {
          product: {
            OR: [
              { name: { contains: filters.q, mode: 'insensitive' } },
              { description: { contains: filters.q, mode: 'insensitive' } },
            ],
          },
        },
      ],
    });
  }

  return { AND: and };
}

export function listingOrderBy(
  sort: ListingSort = 'newest',
): Prisma.ListingOrderByWithRelationInput[] {
  if (sort === 'oldest') return [{ createdAt: 'asc' }, { id: 'asc' }];
  if (sort === 'price_asc') return [{ price: 'asc' }, { id: 'asc' }];
  if (sort === 'price_desc') return [{ price: 'desc' }, { id: 'desc' }];
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}
