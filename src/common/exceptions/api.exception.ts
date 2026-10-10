import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorDetail = Record<string, unknown>;

export class ApiException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details: ErrorDetail[] = [],
  ) {
    super(message, status);
  }
}
