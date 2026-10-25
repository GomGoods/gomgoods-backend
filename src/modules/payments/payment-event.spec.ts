import { describe, expect, it } from 'vitest';

import {
  normalizeSepay,
  paymentReference,
  referencePaymentId,
  vietnamDate,
} from './payment-event.js';

const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const reference = paymentReference(id);
const approvedVa = 'SBSEPAYX9KA2B7MN4QR';
const input = {
  id: '123',
  gateway: 'Vietcombank',
  accountNumber: '0000000000',
  transactionDate: '2026-10-16 12:00:00',
  transferType: 'in' as const,
  transferAmount: 100000,
  content: `${reference} thanh toan`,
  code: reference,
  referenceCode: 'FT123',
};

describe('payment event normalization', () => {
  it('accepts only the explicitly configured Test Mode VA and keeps the fingerprint unchanged', () => {
    const event = { ...input, subAccount: approvedVa };
    const denied = normalizeSepay(event);
    const allowed = normalizeSepay(event, approvedVa);
    expect(denied.initialReason).toBe('UNSUPPORTED_SUB_ACCOUNT');
    expect(allowed.initialReason).toBeNull();
    expect(allowed.paymentReference).toBe(reference);
    expect(allowed.payloadHash).toBe(denied.payloadHash);
  });

  it.each([undefined, null, '', ' ', 'SBSEPAY000000000000', 'X9K'])(
    'does not accept missing or different VA when one is configured: %j',
    (subAccount) => {
      expect(normalizeSepay({ ...input, subAccount }, approvedVa).initialReason).toBe('SUB_ACCOUNT_MISMATCH');
    },
  );

  it('does not use an approved VA as a substitute for GGT or accept conflicting payment codes', () => {
    const event = { ...input, subAccount: approvedVa, content: 'sandbox without payment code', code: null };
    expect(normalizeSepay(event, approvedVa).paymentReference).toBeNull();
    expect(normalizeSepay({ ...event, code: reference }, approvedVa).initialReason).toBe('AMBIGUOUS_REFERENCE');
  });

  it.each([
    id,
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
  ])(
    'round-trips the full UUID without truncating reference entropy: %s',
    (value) => {
      expect(paymentReference(value)).toMatch(/^GGT[A-Z0-9]{25}$/);
      expect(referencePaymentId(paymentReference(value))).toBe(value);
    },
  );

  it('rejects out-of-range and partial references', () => {
    expect(referencePaymentId(`GGT${'Z'.repeat(25)}`)).toBeNull();
    expect(referencePaymentId('GGT123')).toBeNull();
    expect(
      normalizeSepay({
        ...input,
        code: null,
        content: `prefix${reference}suffix`,
      }).paymentReference,
    ).toBeNull();
  });

  it('uses bank-stable fields rather than transport IDs for webhook/API reconciliation', () => {
    expect(normalizeSepay(input).payloadHash).toBe(
      normalizeSepay({ ...input, id: id, code: null }).payloadHash,
    );
    expect(
      normalizeSepay({ ...input, transferAmount: 999 }).payloadHash,
    ).not.toBe(normalizeSepay(input).payloadHash);
  });

  it('does not guess between conflicting transfer references', () => {
    const other = paymentReference('00000000-0000-4000-8000-000000000001');
    expect(
      normalizeSepay({ ...input, content: `${reference} ${other}` })
        .initialReason,
    ).toBe('AMBIGUOUS_REFERENCE');
    expect(
      normalizeSepay({ ...input, code: other }).paymentReference,
    ).toBeNull();
  });

  it('interprets Vietnam time and rejects normalized invalid calendar dates', () => {
    expect(vietnamDate(input.transactionDate).toISOString()).toBe(
      '2026-10-16T05:00:00.000Z',
    );
    expect(() => vietnamDate('2026-02-30 12:00:00')).toThrow(
      'Invalid transaction date',
    );
    expect(() => vietnamDate('2026-10-16 25:00:00')).toThrow(
      'Invalid transaction date',
    );
  });
});
