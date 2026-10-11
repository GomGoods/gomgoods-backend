import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { ApiException } from '../../../common/exceptions/api.exception.js';

@Injectable()
export class AuthRequestGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    const csrfHeader = request.headers['x-gomgoods-csrf'];
    const allowedOrigins = this.config.getOrThrow<string[]>('CORS_ORIGINS');

    if (
      !origin ||
      origin === 'null' ||
      !allowedOrigins.includes(origin) ||
      csrfHeader !== '1'
    ) {
      throw new ApiException(
        'CSRF_VALIDATION_FAILED',
        'The authentication request could not be verified',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
