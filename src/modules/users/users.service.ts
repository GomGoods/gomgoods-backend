import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  authUserSelect,
  publicUserSelect,
  safeUserSelect,
  type AuthUser,
  type PublicUser,
  type SafeUser,
} from './user.select.js';
import type { UpdateCurrentUserDto } from './dto/update-current-user.dto.js';

interface CreateUserInput {
  email: string;
  username: string;
  passwordHash: string;
}

type UserDatabase = Pick<Prisma.TransactionClient, 'user'>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateUserInput,
    database: UserDatabase = this.prisma,
  ): Promise<SafeUser> {
    const duplicate = await database.user.findFirst({
      where: {
        OR: [{ email: input.email }, { username: input.username }],
      },
      select: { email: true, username: true },
    });
    if (duplicate?.email === input.email) {
      throw new ApiException(
        'EMAIL_ALREADY_EXISTS',
        'An account with this email already exists',
        HttpStatus.CONFLICT,
      );
    }
    if (duplicate?.username === input.username) {
      throw new ApiException(
        'USERNAME_ALREADY_EXISTS',
        'An account with this username already exists',
        HttpStatus.CONFLICT,
      );
    }

    try {
      return await database.user.create({
        data: input,
        select: safeUserSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.map(String)
          : [];
        if (target.includes('email')) {
          throw new ApiException(
            'EMAIL_ALREADY_EXISTS',
            'An account with this email already exists',
            HttpStatus.CONFLICT,
          );
        }
        if (target.includes('username')) {
          throw new ApiException(
            'USERNAME_ALREADY_EXISTS',
            'An account with this username already exists',
            HttpStatus.CONFLICT,
          );
        }
      }
      throw error;
    }
  }

  findAuthUserByEmail(email: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: authUserSelect,
    });
  }

  findSafeById(id: string): Promise<SafeUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: safeUserSelect,
    });
  }

  async updateCurrentUser(
    id: string,
    input: UpdateCurrentUserDto,
  ): Promise<SafeUser> {
    if (!input.username) {
      const user = await this.findSafeById(id);
      if (!user) {
        throw new ApiException(
          'RESOURCE_NOT_FOUND',
          'User not found',
          HttpStatus.NOT_FOUND,
        );
      }
      return user;
    }
    try {
      return await this.prisma.user.update({
        where: { id },
        data: { username: input.username },
        select: safeUserSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiException(
          'USERNAME_ALREADY_EXISTS',
          'An account with this username already exists',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async findPublicProfile(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id, status: 'ACTIVE' },
      select: publicUserSelect,
    });
    if (!user) {
      throw new ApiException(
        'RESOURCE_NOT_FOUND',
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      ...user,
      store: user.store?.status === 'ACTIVE' ? user.store : null,
    };
  }

  findSafeByIdForSession(
    id: string,
    sessionId: string,
  ): Promise<SafeUser | null> {
    return this.prisma.user.findFirst({
      where: {
        id,
        authSessions: {
          some: {
            id: sessionId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        },
      },
      select: safeUserSelect,
    });
  }
}
