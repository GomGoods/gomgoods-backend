import type { Prisma } from '../../generated/prisma/client.js';

export const orderSelect = {
  id: true,
  checkoutGroupId: true,
  userId: true,
  addressId: true,
  sellerUserId: true,
  storeId: true,
  total: true,
  paymentMethod: true,
  status: true,
  note: true,
  expiresAt: true,
  cancelledAt: true,
  cancelReason: true,
  shippingRecipient: true,
  shippingPhone: true,
  shippingAddressLine: true,
  shippingCity: true,
  shippingDistrict: true,
  shippingWard: true,
  createdAt: true,
  updatedAt: true,
  sellerUser: {
    select: {
      id: true,
      username: true,
    },
  },
  store: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      status: true,
    },
  },
  items: {
    select: {
      id: true,
      listingId: true,
      quantity: true,
      unitPrice: true,
      subtotal: true,
      listingDescriptionSnapshot: true,
      productIdSnapshot: true,
      productNameSnapshot: true,
      storeNameSnapshot: true,
      sellerUsernameSnapshot: true,
    },
  },
  payments: {
    select: {
      id: true,
      amount: true,
      method: true,
      status: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  shipments: {
    select: {
      id: true,
      carrier: true,
      trackingNo: true,
      shippingFee: true,
      status: true,
      shippedAt: true,
      deliveredAt: true,
      createdAt: true,
      updatedAt: true,
      items: {
        select: {
          id: true,
          orderItemId: true,
          quantity: true,
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

export type OrderResponse = Prisma.OrderGetPayload<{
  select: typeof orderSelect;
}>;
