import type { Prisma } from '../../generated/prisma/client.js';

export const categorySelect = {
  id: true,
  parentId: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  children: {
    where: {
      status: 'ACTIVE',
    },
    orderBy: {
      name: 'asc',
    },
    select: {
      id: true,
      parentId: true,
      name: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.CategorySelect;

export type CategoryResponse = Prisma.CategoryGetPayload<{
  select: typeof categorySelect;
}>;
