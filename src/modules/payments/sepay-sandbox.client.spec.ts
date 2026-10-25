import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaymentSettings } from './payment-settings.js';
import { SepaySandboxClient } from './sepay-sandbox.client.js';

const input = {
  from: '2026-10-16T00:00:00+07:00',
  to: '2026-10-16T23:59:59+07:00',
  page: 1,
};
const bankId = '00000000-0000-4000-8000-000000006000';

function client() {
  return new SepaySandboxClient(
    new PaymentSettings(
      new ConfigService({
        PAYMENT_MODE: 'sepay_test',
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://unit:unit@localhost/unit_test',
        SEPAY_TEST_API_TOKEN: 'unit-sandbox-token',
        SEPAY_TEST_BANK_ACCOUNT_ID: bankId,
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('SepaySandboxClient', () => {
  it('uses only the fixed HTTPS sandbox origin, bounded pagination and no redirects', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            status: 'success',
            data: [],
            meta: { pagination: { current_page: 1, has_more: false } },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().transactions(input)).resolves.toEqual({
      events: [],
      hasMore: false,
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.origin).toBe('https://userapi-sandbox.sepay.vn');
    expect(url.pathname).toBe('/v2/transactions');
    expect(url.searchParams.get('bank_account_id')).toBe(bankId);
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(options).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer unit-sandbox-token' },
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['network', 'status', 'json', 'pagination', 'size'] as const)(
    'fails closed without leaking token/upstream details: %s',
    async (failure) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async () => {
          if (failure === 'network')
            throw new Error('Authorization: Bearer unit-sandbox-token');
          if (failure === 'status')
            return new Response('private upstream data', { status: 429 });
          if (failure === 'json') return new Response('invalid JSON');
          if (failure === 'size')
            return new Response('x'.repeat(1024 * 1024 + 1));
          return new Response(
            JSON.stringify({
              status: 'success',
              data: [],
              meta: { pagination: { current_page: 2, has_more: true } },
            }),
          );
        }),
      );
      await expect(client().transactions(input)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message:
          'SePay sandbox reconciliation is unavailable or returned invalid data',
      });
    },
  );

  it('does not call the provider for inverted or unbounded time ranges', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client().transactions({ ...input, from: input.to, to: input.from }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      client().transactions({ ...input, from: '2026-10-01T00:00:00Z' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
