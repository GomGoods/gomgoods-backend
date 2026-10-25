import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { PaymentSettings } from './payment-settings.js';

@Injectable()
export class SepayWebhookGuard implements CanActivate {
  constructor(private readonly settings: PaymentSettings) {}

  canActivate(context: ExecutionContext): boolean {
    this.settings.requireMode('sepay_test');
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const unauthorized = () =>
      new ApiException(
        'AUTHENTICATION_REQUIRED',
        'Invalid webhook authentication',
        HttpStatus.UNAUTHORIZED,
      );
    if (!request.is('application/json')) throw unauthorized();
    if (this.settings.auth === 'api_key') {
      const expected = `Apikey ${this.settings.required('SEPAY_TEST_WEBHOOK_SECRET')}`;
      const actual = request.headers.authorization ?? '';
      const digest = (value: string) =>
        createHash('sha256').update(value).digest();
      if (!timingSafeEqual(digest(actual), digest(expected)))
        throw unauthorized();
      return true;
    }
    const timestamp = request.headers['x-sepay-timestamp'];
    const signature = request.headers['x-sepay-signature'];
    if (
      typeof timestamp !== 'string' ||
      !/^\d{10}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      typeof signature !== 'string' ||
      !/^sha256=[a-fA-F0-9]{64}$/.test(signature) ||
      !request.rawBody
    )
      throw unauthorized();
    const expected = createHmac(
      'sha256',
      this.settings.required('SEPAY_TEST_WEBHOOK_SECRET'),
    )
      .update(`${timestamp}.`)
      .update(request.rawBody)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex')))
      throw unauthorized();
    return true;
  }
}
