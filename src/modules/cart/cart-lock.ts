import type { Prisma } from '../../generated/prisma/client.js';

export async function lockCart(tx: Prisma.TransactionClient, userId: string) {
  // The user row is a stable per-cart mutex, including before a cart exists.
  // All cart mutations and checkout must acquire it before reading cart items.
  await tx.$queryRaw`
    SELECT "user_id" FROM "USER"
    WHERE "user_id" = ${userId}::uuid FOR NO KEY UPDATE
  `;
  return tx.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { id: true },
  });
}
