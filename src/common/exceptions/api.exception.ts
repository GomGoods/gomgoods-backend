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
  | 'INVALID_ORDER_STATUS_TRANSITION'
  | 'INVALID_LISTING_STATUS_TRANSITION'
  | 'INVALID_REFRESH_TOKEN'
  | 'INVALID_SHIPMENT_STATUS_TRANSITION'
  | 'INVALID_STORE_STATUS_TRANSITION'
  | 'INSUFFICIENT_STOCK'
  | 'LISTING_NOT_EDITABLE'
  | 'ORDER_NOT_CANCELLABLE'
  | 'PAYMENT_NOT_CONFIRMED'
  | 'PRODUCT_NOT_ACTIVE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'REFRESH_ALREADY_ROTATED'
  | 'REFRESH_TOKEN_REUSED'
  | 'REQUEST_FAILED'
  | 'RESOURCE_CONFLICT'
  | 'RESOURCE_NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'STORE_ALREADY_EXISTS'
  | 'STORE_NOT_ACTIVE'
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
