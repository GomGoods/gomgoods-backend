import { HttpStatus, Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { UserStatus } from '../../generated/prisma/enums.js';
import type { AuthUser, SafeUser } from '../users/user.select.js';
import { UsersService } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: AccessTokenService,
  ) {}

  async register(input: RegisterDto): Promise<AuthResult> {
    const user = await this.users.create({
      email: input.email.trim().toLowerCase(),
      username: input.username.trim(),
      passwordHash: await hash(input.password, { type: argon2id }),
    });
    return this.resultFor(user);
  }

  async login(input: LoginDto): Promise<AuthResult> {
    const user = await this.users.findAuthUserByEmail(
      input.email.trim().toLowerCase(),
    );
    const passwordMatches = user
      ? await verify(user.passwordHash, input.password).catch(() => false)
      : false;
    if (!user || !passwordMatches) {
      throw new ApiException(
        'INVALID_CREDENTIALS',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.assertActive(user);
    return this.resultFor(this.withoutPassword(user));
  }

  private async resultFor(user: SafeUser): Promise<AuthResult> {
    const token = await this.tokens.sign({
      sub: user.id,
      accountType: user.accountType,
    });
    return { user, ...token };
  }

  private assertActive(user: AuthUser): void {
    if (user.status === UserStatus.SUSPENDED) {
      throw new ApiException(
        'ACCOUNT_SUSPENDED',
        'This account is suspended',
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.status === UserStatus.DELETED) {
      throw new ApiException(
        'ACCOUNT_DELETED',
        'This account is unavailable',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private withoutPassword(user: AuthUser): SafeUser {
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
