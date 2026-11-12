import type { Prisma } from '../../generated/prisma/client.js';

export const paymentSelect = {
  id: true,
  orderId: true,
  amount: true,
  method: true,
  status: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentSelect;
