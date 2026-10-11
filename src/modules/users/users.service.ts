import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  authUserSelect,
  safeUserSelect,
  type AuthUser,
  type SafeUser,
} from './user.select.js';

interface CreateUserInput {
  email: string;
  username: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateUserInput): Promise<SafeUser> {
    const duplicate = await this.prisma.user.findFirst({
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
      return await this.prisma.user.create({
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
}
