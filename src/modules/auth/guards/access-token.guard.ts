import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { ApiException } from '../../../common/exceptions/api.exception.js';
import { UsersService } from '../../users/users.service.js';
import { AccessTokenService } from '../access-token.service.js';
import { assertAccountActive } from '../account-access.policy.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new ApiException(
        'AUTHENTICATION_REQUIRED',
        'A Bearer access token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    let subject: string;
    try {
      subject = (await this.tokens.verify(token)).sub;
    } catch (error) {
      const expired =
        error instanceof Error && error.name === 'TokenExpiredError';
      throw new ApiException(
        expired ? 'ACCESS_TOKEN_EXPIRED' : 'INVALID_ACCESS_TOKEN',
        expired
          ? 'The access token has expired'
          : 'The access token is invalid',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.users.findSafeById(subject);
    if (!user) {
      throw new ApiException(
        'INVALID_ACCESS_TOKEN',
        'The access token is invalid',
        HttpStatus.UNAUTHORIZED,
      );
    }
    assertAccountActive(user.status);

    Object.assign(request, { user });
    return true;
  }
}
