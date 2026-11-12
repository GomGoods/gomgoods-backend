import type { Prisma } from '../../generated/prisma/client.js';

export async function lockCart(tx: Prisma.TransactionClient, userId: string) {
  // A transaction-scoped mutex includes the no-cart-yet case. A shared account
  // fence still blocks suspension/deletion through commit, but remains compatible
  // with auction bidders that already hold the listing row.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`gomgoods:cart:${userId}`},0))::text`;
  await tx.$queryRaw`
    SELECT "user_id" FROM "USER"
    WHERE "user_id" = ${userId}::uuid FOR SHARE
  `;
  return tx.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { id: true },
  });
}
