import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Mutation lock order: ORDER -> PAYMENT (by ID) -> shipments/inventory.
 * Phase 6 payment confirmation must take this lock in its transaction, then
 * CAS PENDING payment/order states; never confirm a cancelled/expired order.
 * Payment row locks also serialize existing payment updates during cancellation.
 */
export async function lockOrderForMutation(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  await tx.$queryRaw`
    SELECT "order_id" FROM "ORDER"
    WHERE "order_id" = ${orderId}::uuid FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT "payment_id" FROM "PAYMENT"
    WHERE "order_id" = ${orderId}::uuid ORDER BY "payment_id" FOR UPDATE
  `;
}
