import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../../generated/prisma/client.js';
import { StoreStatus, UserStatus } from '../../generated/prisma/enums.js';
import { FollowsService } from './follows.service.js';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'user@gomgoods.local',
  username: 'user',
  accountType: 'USER',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  store: null,
} as const;

describe('FollowsService', () => {
  it('blocks store owner self-follow with a conflict', async () => {
    const prisma = {
      store: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000010',
          userId: user.id,
          status: StoreStatus.ACTIVE,
        }),
      },
      follow: { create: vi.fn() },
    };
    const service = new FollowsService(prisma as never);

    await expect(
      service.followStore('00000000-0000-4000-8000-000000000010', user),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(prisma.follow.create).not.toHaveBeenCalled();
  });

  it('treats duplicate store follows as idempotent success', async () => {
    const prisma = {
      store: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000010',
          userId: '00000000-0000-4000-8000-000000000099',
          status: StoreStatus.ACTIVE,
        }),
      },
      follow: {
        create: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Unique violation', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        ),
      },
    };
    const service = new FollowsService(prisma as never);

    await expect(
      service.followStore('00000000-0000-4000-8000-000000000010', user),
    ).resolves.toEqual({ following: true, created: false });
  });

  it('unfollows only the current user relation', async () => {
    const prisma = {
      follow: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = new FollowsService(prisma as never);

    await expect(
      service.unfollowStore('00000000-0000-4000-8000-000000000010', user),
    ).resolves.toEqual({ following: false, created: false });
    expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        storeId: '00000000-0000-4000-8000-000000000010',
      },
    });
  });

  it('blocks user self-follow with a conflict', async () => {
    const prisma = {
      user: { findUnique: vi.fn() },
      userFollow: { create: vi.fn() },
    };
    const service = new FollowsService(prisma as never);

    await expect(service.followUser(user.id, user)).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      status: 409,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.userFollow.create).not.toHaveBeenCalled();
  });

  it('requires new user follows to target active users', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000020',
          status: UserStatus.SUSPENDED,
        }),
      },
      userFollow: { create: vi.fn() },
    };
    const service = new FollowsService(prisma as never);

    await expect(
      service.followUser('00000000-0000-4000-8000-000000000020', user),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(prisma.userFollow.create).not.toHaveBeenCalled();
  });

  it('treats duplicate user follows as idempotent success', async () => {
    const targetUserId = '00000000-0000-4000-8000-000000000020';
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: targetUserId,
          status: UserStatus.ACTIVE,
        }),
      },
      userFollow: {
        create: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Unique violation', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        ),
      },
    };
    const service = new FollowsService(prisma as never);

    await expect(service.followUser(targetUserId, user)).resolves.toEqual({
      following: true,
      created: false,
    });
  });

  it('unfollows only the current user-to-user relation', async () => {
    const targetUserId = '00000000-0000-4000-8000-000000000020';
    const prisma = {
      userFollow: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = new FollowsService(prisma as never);

    await expect(service.unfollowUser(targetUserId, user)).resolves.toEqual({
      following: false,
      created: false,
    });
    expect(prisma.userFollow.deleteMany).toHaveBeenCalledWith({
      where: { followerId: user.id, followingId: targetUserId },
    });
  });

  it('returns paginated public-safe active followed users', async () => {
    const followedUser = {
      id: '00000000-0000-4000-8000-000000000020',
      username: 'followed',
      createdAt: new Date(),
      store: { id: '00000000-0000-4000-8000-000000000030', status: 'SUSPENDED' },
    };
    const prisma = {
      userFollow: {
        findMany: vi.fn().mockResolvedValue([{ following: followedUser }]),
        count: vi.fn().mockResolvedValue(1),
      },
      $transaction: vi.fn((operations) => Promise.all(operations)),
    };
    const service = new FollowsService(prisma as never);

    await expect(
      service.findFollowedActiveUsers(user, { page: 1, limit: 20 }),
    ).resolves.toMatchObject({
      items: [{ id: followedUser.id, username: 'followed', store: null }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(prisma.userFollow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          followerId: user.id,
          following: { status: UserStatus.ACTIVE },
        },
        skip: 0,
        take: 20,
      }),
    );
  });
});
