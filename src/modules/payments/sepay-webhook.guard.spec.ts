import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { PaymentSettings } from './payment-settings.js';
import { SepayWebhookGuard } from './sepay-webhook.guard.js';

const secret = 'test-webhook-secret-used-only-in-unit-tests';
const body = Buffer.from('{ "id": 123, "content": "kiểm thử" }');

function fixture(overrides: Record<string, unknown> = {}) {
  const config = new ConfigService({
    PAYMENT_MODE: 'sepay_test',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unit:unit@localhost/unit_test',
    SEPAY_WEBHOOK_AUTH: 'hmac',
    SEPAY_TEST_WEBHOOK_SECRET: secret,
    ...overrides,
  });
  return new SepayWebhookGuard(new PaymentSettings(config));
}

function context(headers: Record<string, string>, rawBody = body) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        rawBody,
        is: (type: string) => type === 'application/json',
      }),
    }),
  } as never;
}

function signed(timestamp = String(Math.floor(Date.now() / 1000))) {
  return {
    'x-sepay-timestamp': timestamp,
    'x-sepay-signature': `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`,
  };
}

describe('SepayWebhookGuard', () => {
  it('authenticates original raw bytes, including whitespace and Unicode', () => {
    expect(fixture().canActivate(context(signed()))).toBe(true);
    expect(() =>
      fixture().canActivate(
        context(
          signed(),
          Buffer.from(JSON.stringify(JSON.parse(body.toString()))),
        ),
      ),
    ).toThrow('Invalid webhook authentication');
  });

  it.each([-301, 301])(
    'rejects stale and future signed timestamps (%s seconds)',
    (offset) => {
      expect(() =>
        fixture().canActivate(
          context(signed(String(Math.floor(Date.now() / 1000) + offset))),
        ),
      ).toThrow('Invalid webhook authentication');
    },
  );

  it('rejects missing signatures and malformed hash lengths without throwing buffer errors', () => {
    expect(() => fixture().canActivate(context({}))).toThrow(
      'Invalid webhook authentication',
    );
    expect(() =>
      fixture().canActivate(
        context({ ...signed(), 'x-sepay-signature': 'sha256=00' }),
      ),
    ).toThrow('Invalid webhook authentication');
  });

  it('supports only the configured API Key scheme with a constant-time comparison', () => {
    const guard = fixture({ SEPAY_WEBHOOK_AUTH: 'api_key' });
    expect(
      guard.canActivate(context({ authorization: `Apikey ${secret}` })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(context({ authorization: `Bearer ${secret}` })),
    ).toThrow('Invalid webhook authentication');
    expect(() =>
      guard.canActivate(context({ authorization: 'Apikey wrong' })),
    ).toThrow('Invalid webhook authentication');
  });

  it.each([
    { PAYMENT_MODE: 'disabled' },
    { PAYMENT_MODE: 'mock' },
    { NODE_ENV: 'production' },
    { DATABASE_URL: 'postgresql://unit:unit@localhost/gomgoods' },
  ])('fails closed outside test-only SePay mode: %j', (overrides) => {
    expect(() => fixture(overrides).canActivate(context(signed()))).toThrow(
      'This test payment provider is disabled',
    );
  });
});
