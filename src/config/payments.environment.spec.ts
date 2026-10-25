import { describe, expect, it } from 'vitest';

import { validatePaymentEnvironment } from './payments.environment.js';

const testDb = 'postgresql://unit:unit@localhost/gomgoods_test';
const valid = {
  PAYMENT_MODE: 'sepay_test',
  SEPAY_TEST_WEBHOOK_SECRET: 'test-secret-with-at-least-thirty-two-characters',
  SEPAY_TEST_ACCOUNT_NUMBER: '0000000000',
  SEPAY_TEST_BANK_NAME: 'Vietcombank',
  VIETQR_TEST_BANK_BIN: '970436',
  VIETQR_TEST_ACCOUNT_NAME: 'GOMGOODS TEST',
};

describe('payment environment', () => {
  it('allows only an explicit official sandbox VA, without enabling VA by default', () => {
    expect(validatePaymentEnvironment(valid, 'test', testDb).SEPAY_TEST_VA).toBeUndefined();
    expect(validatePaymentEnvironment({ ...valid, SEPAY_TEST_VA: 'SBSEPAYX9KA2B7MN4QR' }, 'test', testDb).SEPAY_TEST_VA).toBe('SBSEPAYX9KA2B7MN4QR');
  });

  it.each(['X9K', '1234567890', 'SBSEPAYSHORT', 'SBSEPAYX9KA2B7MN4QR,SBSEPAY000000000000', 'sbsepayx9ka2b7mn4qr'])(
    'refuses non-official or multiple VA configuration: %s',
    (va) => {
      expect(() => validatePaymentEnvironment({ ...valid, SEPAY_TEST_VA: va }, 'test', testDb)).toThrow('SEPAY_TEST_VA');
    },
  );

  it('is disabled by default and does not require provider credentials', () => {
    expect(
      validatePaymentEnvironment({}, 'production', testDb).PAYMENT_MODE,
    ).toBe('disabled');
  });

  it('accepts test-only mock and SePay settings', () => {
    expect(
      validatePaymentEnvironment({ PAYMENT_MODE: 'mock' }, 'test', testDb)
        .PAYMENT_MODE,
    ).toBe('mock');
    expect(
      validatePaymentEnvironment(valid, 'test', testDb).SEPAY_WEBHOOK_AUTH,
    ).toBe('hmac');
  });

  it.each(['live', 'sepay', 'production'])(
    'does not enable unsupported Live payment modes: %s',
    (mode) => {
      expect(() =>
        validatePaymentEnvironment(
          { PAYMENT_MODE: mode },
          'development',
          testDb,
        ),
      ).toThrow('PAYMENT_MODE');
    },
  );

  it('blocks production and non-test databases even with valid secrets', () => {
    expect(() =>
      validatePaymentEnvironment(valid, 'production', testDb),
    ).toThrow('non-production test database');
    expect(() =>
      validatePaymentEnvironment(
        valid,
        'development',
        'postgresql://unit:unit@localhost/gomgoods',
      ),
    ).toThrow('non-production test database');
  });

  it.each([
    { SEPAY_TEST_WEBHOOK_SECRET: '' },
    { SEPAY_WEBHOOK_AUTH: 'none' },
    { SEPAY_TEST_ACCOUNT_NUMBER: '../live' },
    { VIETQR_TEST_BANK_BIN: 'https://evil.test' },
    { VIETQR_TEST_ACCOUNT_NAME: '' },
  ])('rejects incomplete or unsafe active configuration: %j', (overrides) => {
    expect(() =>
      validatePaymentEnvironment({ ...valid, ...overrides }, 'test', testDb),
    ).toThrow();
  });
});
