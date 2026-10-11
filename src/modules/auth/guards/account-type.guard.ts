import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ACCOUNT_TYPES_KEY } from '../../../common/decorators/account-types.decorator.js';
import { ApiException } from '../../../common/exceptions/api.exception.js';
import type { AccountType } from '../../../generated/prisma/enums.js';
import type { SafeUser } from '../../users/user.select.js';

@Injectable()
export class AccountTypeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<AccountType[]>(
      ACCOUNT_TYPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SafeUser }>();
    if (!request.user || !allowed.includes(request.user.accountType)) {
      throw new ApiException(
        'FORBIDDEN',
        'You do not have permission to access this resource',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
