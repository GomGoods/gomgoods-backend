import type { Prisma } from '../../generated/prisma/client.js';

export const listingSelect = {
  id: true,
  productId: true,
  sellerUserId: true,
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
  sellerUser: {
    select: {
      id: true,
      username: true,
    },
  },
  product: {
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      store: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          status: true,
          user: { select: { id: true, username: true } },
        },
      },
    },
  },
} satisfies Prisma.ListingSelect;

export type ListingResponse = Prisma.ListingGetPayload<{
  select: typeof listingSelect;
}>;
