import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiException } from '../../common/exceptions/api.exception.js';

export type PaymentMode = 'disabled' | 'mock' | 'sepay_test';

@Injectable()
export class PaymentSettings {
  constructor(private readonly config: ConfigService) {}

  requireMode(mode: Exclude<PaymentMode, 'disabled'>) {
    const database = new URL(this.config.getOrThrow<string>('DATABASE_URL'));
    if (
      this.config.get('PAYMENT_MODE', 'disabled') !== mode ||
      this.config.get('NODE_ENV') === 'production' ||
      !decodeURIComponent(database.pathname).toLowerCase().includes('test')
    ) {
      throw new ApiException(
        'SERVICE_UNAVAILABLE',
        'This test payment provider is disabled',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  get mode(): PaymentMode {
    return this.config.get<PaymentMode>('PAYMENT_MODE', 'disabled');
  }

  get auth(): 'hmac' | 'api_key' {
    return this.config.get('SEPAY_WEBHOOK_AUTH', 'hmac');
  }

  get va(): string | undefined {
    return this.config.get<string>('SEPAY_TEST_VA')?.trim() || undefined;
  }

  required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value)
      throw new ApiException(
        'SERVICE_UNAVAILABLE',
        'Test payment configuration is incomplete',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    return value;
  }
}
