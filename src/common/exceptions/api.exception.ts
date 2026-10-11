import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorDetail = Record<string, unknown>;
export type ApiErrorCode =
  | 'ACCESS_TOKEN_EXPIRED'
  | 'ACCOUNT_DELETED'
  | 'ACCOUNT_SUSPENDED'
  | 'AUTHENTICATION_REQUIRED'
  | 'BAD_REQUEST'
  | 'CSRF_VALIDATION_FAILED'
  | 'EMAIL_ALREADY_EXISTS'
  | 'FORBIDDEN'
  | 'INTERNAL_SERVER_ERROR'
  | 'INVALID_ACCESS_TOKEN'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_REFRESH_TOKEN'
  | 'RATE_LIMIT_EXCEEDED'
  | 'REFRESH_ALREADY_ROTATED'
  | 'REFRESH_TOKEN_REUSED'
  | 'REQUEST_FAILED'
  | 'RESOURCE_CONFLICT'
  | 'RESOURCE_NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'USERNAME_ALREADY_EXISTS'
  | 'VALIDATION_FAILED';

export class ApiException extends HttpException {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
    public readonly details: ErrorDetail[] = [],
  ) {
    super(message, status);
  }
}
