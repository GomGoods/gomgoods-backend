import type { PaymentMode } from '../modules/payments/payment-settings.js';

export interface PaymentEnvironment {
  PAYMENT_MODE: PaymentMode;
  SEPAY_WEBHOOK_AUTH: 'hmac' | 'api_key';
  SEPAY_TEST_WEBHOOK_SECRET?: string;
  SEPAY_TEST_ACCOUNT_NUMBER?: string;
  SEPAY_TEST_BANK_NAME?: string;
  SEPAY_TEST_VA?: string;
  VIETQR_TEST_BANK_BIN?: string;
  VIETQR_TEST_ACCOUNT_NAME?: string;
  SEPAY_TEST_API_TOKEN?: string;
  SEPAY_TEST_BANK_ACCOUNT_ID?: string;
}

export function validatePaymentEnvironment(
  environment: Record<string, unknown>,
  nodeEnvironment: string,
  databaseUrl: string,
): PaymentEnvironment {
  const mode = String(environment.PAYMENT_MODE ?? 'disabled');
  if (!['disabled', 'mock', 'sepay_test'].includes(mode))
    throw new Error('PAYMENT_MODE must be disabled, mock, or sepay_test');
  const auth = String(environment.SEPAY_WEBHOOK_AUTH ?? 'hmac');
  if (!['hmac', 'api_key'].includes(auth))
    throw new Error('SEPAY_WEBHOOK_AUTH must be hmac or api_key');
  const optional = (key: string) =>
    typeof environment[key] === 'string'
      ? environment[key].trim() || undefined
      : undefined;
  const result: PaymentEnvironment = {
    PAYMENT_MODE: mode as PaymentMode,
    SEPAY_WEBHOOK_AUTH: auth as 'hmac' | 'api_key',
    SEPAY_TEST_WEBHOOK_SECRET: optional('SEPAY_TEST_WEBHOOK_SECRET'),
    SEPAY_TEST_ACCOUNT_NUMBER: optional('SEPAY_TEST_ACCOUNT_NUMBER'),
    SEPAY_TEST_BANK_NAME: optional('SEPAY_TEST_BANK_NAME'),
    SEPAY_TEST_VA: optional('SEPAY_TEST_VA'),
    VIETQR_TEST_BANK_BIN: optional('VIETQR_TEST_BANK_BIN'),
    VIETQR_TEST_ACCOUNT_NAME: optional('VIETQR_TEST_ACCOUNT_NAME'),
    SEPAY_TEST_API_TOKEN: optional('SEPAY_TEST_API_TOKEN'),
    SEPAY_TEST_BANK_ACCOUNT_ID: optional('SEPAY_TEST_BANK_ACCOUNT_ID'),
  };
  if (result.SEPAY_TEST_VA && !/^SBSEPAY[A-Z0-9]{12}$/.test(result.SEPAY_TEST_VA))
    throw new Error('SEPAY_TEST_VA must be one official Test Mode VA: SBSEPAY plus 12 uppercase alphanumeric characters');
  if (
    mode !== 'disabled' &&
    (nodeEnvironment === 'production' ||
      !decodeURIComponent(new URL(databaseUrl).pathname)
        .toLowerCase()
        .includes('test'))
  ) {
    throw new Error('Phase 6 payments require a non-production test database');
  }
  if (mode === 'sepay_test') {
    if (
      !result.SEPAY_TEST_WEBHOOK_SECRET ||
      result.SEPAY_TEST_WEBHOOK_SECRET.length < 32
    )
      throw new Error(
        'SEPAY_TEST_WEBHOOK_SECRET must contain at least 32 characters',
      );
    if (!/^[A-Za-z0-9]{1,19}$/.test(result.SEPAY_TEST_ACCOUNT_NUMBER ?? ''))
      throw new Error(
        'SEPAY_TEST_ACCOUNT_NUMBER must be a test account with 1-19 alphanumeric characters',
      );
    if (
      !result.SEPAY_TEST_BANK_NAME ||
      result.SEPAY_TEST_BANK_NAME.length > 100
    )
      throw new Error('SEPAY_TEST_BANK_NAME is required (max 100 characters)');
    if (!/^\d{6}$/.test(result.VIETQR_TEST_BANK_BIN ?? ''))
      throw new Error('VIETQR_TEST_BANK_BIN must contain 6 digits');
    if (!/^[A-Za-z0-9 ]{1,80}$/.test(result.VIETQR_TEST_ACCOUNT_NAME ?? ''))
      throw new Error(
        'VIETQR_TEST_ACCOUNT_NAME must contain 1-80 ASCII letters, digits or spaces',
      );
  }
  if (
    result.SEPAY_TEST_BANK_ACCOUNT_ID &&
    !/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(
      result.SEPAY_TEST_BANK_ACCOUNT_ID,
    )
  )
    throw new Error('SEPAY_TEST_BANK_ACCOUNT_ID must be a UUID');
  return result;
}
