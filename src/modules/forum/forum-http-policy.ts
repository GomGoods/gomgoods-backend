import { ArgumentsHost, Catch, ExecutionContext, HttpException, HttpStatus, Injectable, type CallHandler, type CanActivate, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter.js';
import { ForumRateLimitError } from './forum-rate-limit.js';
import { Prisma } from '../../generated/prisma/client.js';

function headers(response: Response) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}
@Injectable()
export class ForumRequestGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    // Global auth already verifies JWT/session/current role; reject ambiguous
    // extra authorization fields without changing authentication in other modules.
    const request = context.switchToHttp().getRequest<Request>();
    const authorizationCount = request.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === 'authorization').length;
    if (authorizationCount !== 1 || !/^Bearer [^\s]+$/.test(request.headers.authorization ?? '')) throw new ApiException('INVALID_ACCESS_TOKEN', 'Invalid authorization header', HttpStatus.UNAUTHORIZED);
    return true;
  }
}
@Injectable()
export class ForumResponsePolicy implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) { headers(context.switchToHttp().getResponse<Response>()); return next.handle(); }
}
@Catch()
export class ForumExceptionFilter extends ApiExceptionFilter {
  override catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    headers(response);
    if (error instanceof ForumRateLimitError) response.setHeader('Retry-After', String(error.retryAfterSeconds));
    const expectedDatabaseConflict = error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2025'].includes(error.code);
    super.catch(error instanceof HttpException || expectedDatabaseConflict ? error : new ApiException('INTERNAL_SERVER_ERROR', 'An unexpected Forum error occurred', HttpStatus.INTERNAL_SERVER_ERROR), host);
  }
}
