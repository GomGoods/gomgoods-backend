import type { Prisma } from '../../generated/prisma/client.js';

export const storeSummarySelect = {
  id: true,
  userId: true,
  name: true,
  description: true,
  avatarUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      username: true,
    },
  },
} satisfies Prisma.StoreSelect;

export type StoreSummary = Prisma.StoreGetPayload<{
  select: typeof storeSummarySelect;
}>;
