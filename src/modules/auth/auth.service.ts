import { HttpStatus, Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthUser, SafeUser } from '../users/user.select.js';
import { UsersService } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { assertAccountActive } from './account-access.policy.js';
import {
  AuthSessionService,
  type SessionGrant,
} from './auth-session.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
  expiresIn: number;
}

export interface IssuedAuthentication {
  publicResult: AuthResult;
  refreshGrant: {
    token: string;
    expiresAt: Date;
  };
}

export type RefreshAuthResult =
  | { ok: true; result: IssuedAuthentication }
  | { ok: false; error: ApiException; clearCookie: boolean };

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: AccessTokenService,
    private readonly sessions: AuthSessionService,
    private readonly prisma: PrismaService,
  ) {}

  async register(input: RegisterDto): Promise<IssuedAuthentication> {
    const passwordHash = await hash(input.password, { type: argon2id });
    const { user, grant } = await this.prisma.$transaction(async (database) => {
      const user = await this.users.create(
        {
          email: input.email.trim().toLowerCase(),
          username: input.username.trim(),
          passwordHash,
        },
        database,
      );
      const grant = await this.sessions.start(user.id, database);
      return { user, grant };
    });
    return this.resultFor(user, grant);
  }

  async login(input: LoginDto): Promise<IssuedAuthentication> {
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
    assertAccountActive(user.status);
    const safeUser = this.withoutPassword(user);
    return this.resultFor(safeUser, await this.sessions.start(safeUser.id));
  }

  async refresh(rawToken: string | undefined): Promise<RefreshAuthResult> {
    const outcome = await this.sessions.rotate(rawToken);
    if (outcome.kind === 'ROTATED') {
      return {
        ok: true,
        result: await this.resultFor(outcome.user, outcome.grant),
      };
    }
    if (outcome.kind === 'CONCURRENT_ROTATION') {
      return {
        ok: false,
        clearCookie: false,
        error: new ApiException(
          'REFRESH_ALREADY_ROTATED',
          'The refresh credential was already rotated',
          HttpStatus.CONFLICT,
        ),
      };
    }
    if (outcome.kind === 'REPLAY_REVOKED') {
      return {
        ok: false,
        clearCookie: true,
        error: new ApiException(
          'REFRESH_TOKEN_REUSED',
          'The refresh credential is no longer valid',
          HttpStatus.UNAUTHORIZED,
        ),
      };
    }
    if (outcome.kind === 'ACCOUNT_SUSPENDED') {
      return {
        ok: false,
        clearCookie: true,
        error: new ApiException(
          'ACCOUNT_SUSPENDED',
          'This account is suspended',
          HttpStatus.FORBIDDEN,
        ),
      };
    }
    if (outcome.kind === 'ACCOUNT_DELETED') {
      return {
        ok: false,
        clearCookie: true,
        error: new ApiException(
          'ACCOUNT_DELETED',
          'This account is unavailable',
          HttpStatus.FORBIDDEN,
        ),
      };
    }
    return {
      ok: false,
      clearCookie: true,
      error: new ApiException(
        'INVALID_REFRESH_TOKEN',
        'The refresh credential is invalid',
        HttpStatus.UNAUTHORIZED,
      ),
    };
  }

  logout(rawToken: string | undefined): Promise<void> {
    return this.sessions.revokeCurrent(rawToken);
  }

  logoutAll(userId: string): Promise<void> {
    return this.sessions.revokeAll(userId);
  }

  private async resultFor(
    user: SafeUser,
    grant: SessionGrant,
  ): Promise<IssuedAuthentication> {
    const token = await this.tokens.sign({
      sub: user.id,
      sid: grant.sessionId,
      accountType: user.accountType,
    });
    return {
      publicResult: { user, ...token },
      refreshGrant: {
        token: grant.refreshToken,
        expiresAt: grant.expiresAt,
      },
    };
  }

  private withoutPassword(user: AuthUser): SafeUser {
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
