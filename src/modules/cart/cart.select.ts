import type { Prisma } from '../../generated/prisma/client.js';

export const cartItemSelect = {
  id: true,
  cartId: true,
  listingId: true,
  quantity: true,
  createdAt: true,
  updatedAt: true,
  listing: {
    select: {
      id: true,
      productId: true,
      sellerUserId: true,
      price: true,
      quantity: true,
      condition: true,
      description: true,
      status: true,
      sellerUser: {
        select: {
          id: true,
          username: true,
          status: true,
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
              status: true,
            },
          },
          store: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              status: true,
              userId: true,
              user: { select: { id: true, username: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartItemSelect;

export type CartItemResponse = Prisma.CartItemGetPayload<{
  select: typeof cartItemSelect;
}> & { available: boolean; unavailableReason: string | null };
