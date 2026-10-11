import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import { Prisma } from '../../generated/prisma/client.js';
import { ApiException } from '../exceptions/api.exception.js';
import type { ApiErrorCode } from '../exceptions/api.exception.js';

const statusCodes: Partial<Record<number, ApiErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'FORBIDDEN',
  404: 'RESOURCE_NOT_FOUND',
  409: 'RESOURCE_CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMIT_EXCEEDED',
  503: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const normalized = this.normalize(exception);
    if (normalized.status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(normalized.status).json({
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
      },
    });
  }

  private normalize(exception: unknown) {
    if (exception instanceof ApiException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          code: 'RESOURCE_CONFLICT',
          message: 'A resource with these values already exists',
          details: [],
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'RESOURCE_NOT_FOUND',
          message: 'Resource not found',
          details: [],
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String(body.message)
          : exception.message;
      return {
        status,
        code: statusCodes[status] ?? 'REQUEST_FAILED',
        message,
        details: [],
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: [],
    };
  }
}
