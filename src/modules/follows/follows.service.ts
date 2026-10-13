import { HttpStatus, Injectable } from '@nestjs/common';

import {
  type PaginatedResult,
  paginationParams,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { StoreStatus, UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { storeSummarySelect, type StoreSummary } from '../stores/store.select.js';
import {
  publicUserSelect,
  type PublicUser,
  type SafeUser,
} from '../users/user.select.js';

export interface FollowState {
  following: boolean;
  created: boolean;
}

@Injectable()
export class FollowsService {
  constructor(private readonly prisma: PrismaService) {}

  async followStore(storeId: string, user: SafeUser): Promise<FollowState> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, userId: true, status: true },
    });
    if (!store) throw this.storeNotFound();
    if (store.userId === user.id) {
      throw new ApiException(
        'RESOURCE_CONFLICT',
        'Store owners cannot follow their own store',
        HttpStatus.CONFLICT,
      );
    }
    if (store.status !== StoreStatus.ACTIVE) throw this.storeNotFound();

    try {
      await this.prisma.follow.create({
        data: { userId: user.id, storeId },
      });
      return { following: true, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { following: true, created: false };
      }
      throw error;
    }
  }

  async unfollowStore(storeId: string, user: SafeUser): Promise<FollowState> {
    await this.prisma.follow.deleteMany({
      where: { userId: user.id, storeId },
    });
    return { following: false, created: false };
  }

  async findFollowedActiveStores(user: SafeUser): Promise<StoreSummary[]> {
    const follows = await this.prisma.follow.findMany({
      where: {
        userId: user.id,
        store: { status: StoreStatus.ACTIVE },
      },
      orderBy: { createdAt: 'desc' },
      select: { store: { select: storeSummarySelect } },
    });
    return follows.map((follow) => follow.store);
  }

  async followUser(targetUserId: string, user: SafeUser): Promise<FollowState> {
    if (targetUserId === user.id) {
      throw new ApiException(
        'RESOURCE_CONFLICT',
        'Users cannot follow themselves',
        HttpStatus.CONFLICT,
      );
    }
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });
    if (!targetUser || targetUser.status !== UserStatus.ACTIVE) {
      throw this.userNotFound();
    }

    try {
      await this.prisma.userFollow.create({
        data: { followerId: user.id, followingId: targetUserId },
      });
      return { following: true, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { following: true, created: false };
      }
      throw error;
    }
  }

  async unfollowUser(
    targetUserId: string,
    user: SafeUser,
  ): Promise<FollowState> {
    await this.prisma.userFollow.deleteMany({
      where: { followerId: user.id, followingId: targetUserId },
    });
    return { following: false, created: false };
  }

  async findFollowedActiveUsers(
    user: SafeUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<PublicUser>> {
    const { page, limit, skip, take } = paginationParams(query);
    const where = {
      followerId: user.id,
      following: { status: UserStatus.ACTIVE },
    };
    const [follows, total] = await this.prisma.$transaction([
      this.prisma.userFollow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: { following: { select: publicUserSelect } },
      }),
      this.prisma.userFollow.count({ where }),
    ]);
    return {
      items: follows.map((follow) => ({
        ...follow.following,
        store:
          follow.following.store?.status === StoreStatus.ACTIVE
            ? follow.following.store
            : null,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private storeNotFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'Store not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private userNotFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'User not found',
      HttpStatus.NOT_FOUND,
    );
  }
}
