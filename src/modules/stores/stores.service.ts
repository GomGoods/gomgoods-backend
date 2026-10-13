import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { StoreStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SafeUser } from '../users/user.select.js';
import type { CreateStoreDto } from './dto/create-store.dto.js';
import type { UpdateStoreStatusDto } from './dto/update-store-status.dto.js';
import type { UpdateStoreDto } from './dto/update-store.dto.js';
import { storeSummarySelect, type StoreSummary } from './store.select.js';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: SafeUser, input: CreateStoreDto): Promise<StoreSummary> {
    try {
      return await this.prisma.store.create({
        data: {
          userId: user.id,
          name: input.name,
          description: input.description,
          avatarUrl: input.avatarUrl,
          status: StoreStatus.PENDING,
        },
        select: storeSummarySelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiException(
          'STORE_ALREADY_EXISTS',
          'This user already owns a store',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async findMine(user: SafeUser): Promise<StoreSummary> {
    const store = await this.prisma.store.findUnique({
      where: { userId: user.id },
      select: storeSummarySelect,
    });
    if (!store) throw this.notFound();
    return store;
  }

  async findPublic(id: string): Promise<StoreSummary> {
    const store = await this.prisma.store.findFirst({
      where: { id, status: StoreStatus.ACTIVE },
      select: storeSummarySelect,
    });
    if (!store) throw this.notFound();
    return store;
  }

  async update(
    id: string,
    user: SafeUser,
    input: UpdateStoreDto,
  ): Promise<StoreSummary> {
    const store = await this.findOwnedStore(id, user.id);
    return this.prisma.store.update({
      where: { id: store.id },
      data: {
        name: input.name,
        description: input.description,
        avatarUrl: input.avatarUrl,
      },
      select: storeSummarySelect,
    });
  }

  async updateStatus(
    id: string,
    input: UpdateStoreStatusDto,
  ): Promise<StoreSummary> {
    const store = await this.prisma.store.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!store) throw this.notFound();
    if (
      store.status === StoreStatus.CLOSED &&
      input.status !== StoreStatus.CLOSED
    ) {
      throw new ApiException(
        'INVALID_STORE_STATUS_TRANSITION',
        'Closed stores cannot be reopened in Phase 3',
        HttpStatus.CONFLICT,
      );
    }
    return this.prisma.store.update({
      where: { id },
      data: { status: input.status },
      select: storeSummarySelect,
    });
  }

  async requireActiveOwnedStore(userId: string): Promise<{ id: string }> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true, status: true },
    });
    if (!store) throw this.notFound('Store not found');
    if (store.status !== StoreStatus.ACTIVE) {
      throw new ApiException(
        'STORE_NOT_ACTIVE',
        'Store must be active before creating products or store-backed listings',
        HttpStatus.FORBIDDEN,
      );
    }
    return { id: store.id };
  }

  private async findOwnedStore(id: string, userId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!store) throw this.notFound();
    if (store.userId !== userId) {
      throw new ApiException(
        'FORBIDDEN',
        'You do not have permission to modify this store',
        HttpStatus.FORBIDDEN,
      );
    }
    return store;
  }

  private notFound(message = 'Store not found') {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      message,
      HttpStatus.NOT_FOUND,
    );
  }
}
