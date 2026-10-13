import type { Prisma } from '../../generated/prisma/client.js';

export const safeUserSelect = {
  id: true,
  email: true,
  username: true,
  accountType: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  store: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      status: true,
    },
  },
} satisfies Prisma.UserSelect;

export const publicUserSelect = {
  id: true,
  username: true,
  createdAt: true,
  store: {
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      status: true,
    },
  },
} satisfies Prisma.UserSelect;

export const authUserSelect = {
  ...safeUserSelect,
  passwordHash: true,
} satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{
  select: typeof safeUserSelect;
}>;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;

export type AuthUser = Prisma.UserGetPayload<{
  select: typeof authUserSelect;
}>;
