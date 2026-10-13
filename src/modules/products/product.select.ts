import type { Prisma } from '../../generated/prisma/client.js';
import { ListingStatus } from '../../generated/prisma/enums.js';

export const productListSelect = {
  id: true,
  storeId: true,
  categoryId: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  store: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      status: true,
      user: { select: { id: true, username: true } },
    },
  },
  category: {
    select: {
      id: true,
      name: true,
      parentId: true,
    },
  },
} satisfies Prisma.ProductSelect;

export const productDetailSelect = {
  ...productListSelect,
  listings: {
    where: { status: ListingStatus.ACTIVE },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      price: true,
      quantity: true,
      condition: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      images: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          imageUrl: true,
          sortOrder: true,
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

export type ProductListItem = Prisma.ProductGetPayload<{
  select: typeof productListSelect;
}>;

export type ProductDetail = Prisma.ProductGetPayload<{
  select: typeof productDetailSelect;
}>;
