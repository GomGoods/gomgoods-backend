import type { Prisma } from '../../src/generated/prisma/client.js';
import { OrdersService } from '../../src/modules/orders/orders.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

// Restrict the sweep's candidate query only; mutations, transactions and locks
// still run against PostgreSQL through the unchanged production service.
export function fixtureOrders(prisma: PrismaService, where: Prisma.OrderWhereInput) {
  const scoped = prisma.$extends({
    query: {
      order: {
        findMany({ args, query }) {
          args.where = { AND: [args.where ?? {}, where] };
          return query(args);
        },
      },
    },
  });
  return new OrdersService(scoped as unknown as PrismaService);
}
