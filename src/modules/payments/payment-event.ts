import { createHash } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { PaymentEventProvider } from '../../generated/prisma/enums.js';
import type { SepayWebhookDto } from './dto/sepay-webhook.dto.js';

export function paymentReference(id: string): string {
  return `GGT${BigInt(`0x${id.replaceAll('-', '')}`)
    .toString(36)
    .toUpperCase()
    .padStart(25, '0')}`;
}

export function referencePaymentId(reference: string | null): string | null {
  if (!reference || !/^GGT[A-Z0-9]{25}$/.test(reference)) return null;
  let value = 0n;
  for (const character of reference.slice(3))
    value = value * 36n + BigInt(parseInt(character, 36));
  if (value >= 2n ** 128n) return null;
  const hex = value.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function vietnamDate(value: string): Date {
  const date = new Date(`${value.replace(' ', 'T')}+07:00`);
  if (
    !Number.isFinite(date.getTime()) ||
    Number(value.slice(0, 4)) < 1970 ||
    new Date(date.getTime() + 7 * 3600_000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ') !== value
  ) {
    throw new ApiException(
      'VALIDATION_FAILED',
      'Invalid transaction date',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return date;
}

export interface NormalizedPaymentEvent {
  provider: PaymentEventProvider;
  providerEventId: string;
  bankReference: string | null;
  payloadHash: string;
  accountNumber: string;
  gateway: string;
  paymentReference: string | null;
  amount: string;
  transferType: 'in' | 'out';
  occurredAt: Date;
  initialReason: string | null;
}

export function normalizeSepay(input: SepayWebhookDto, expectedVa?: string): NormalizedPaymentEvent {
  const content = input.content.trim().toUpperCase();
  const references = [
    ...content.matchAll(/(?:^|[^A-Z0-9])(GGT[A-Z0-9]{25})(?=$|[^A-Z0-9])/g),
  ].map((match) => match[1]);
  const distinct = [...new Set(references)];
  const code = input.code?.trim().toUpperCase();
  const ambiguous =
    distinct.length > 1 ||
    (!!code && (distinct.length !== 1 || distinct[0] !== code));
  const reference = !ambiguous && distinct.length === 1 ? distinct[0] : null;
  const subAccount = input.subAccount?.trim() || null;
  const subAccountReason = expectedVa
    ? subAccount === expectedVa ? null : 'SUB_ACCOUNT_MISMATCH'
    : subAccount ? 'UNSUPPORTED_SUB_ACCOUNT' : null;
  const occurredAt = vietnamDate(input.transactionDate);
  const fields = {
    bankReference: input.referenceCode?.trim() || null,
    accountNumber: input.accountNumber.toUpperCase(),
    gateway: input.gateway.trim().toLowerCase(),
    paymentReference: reference,
    amount: `${input.transferAmount}.00`,
    transferType: input.transferType,
    occurredAt,
  };
  return {
    provider: PaymentEventProvider.SEPAY_TEST,
    providerEventId: input.id.toLowerCase(),
    ...fields,
    payloadHash: createHash('sha256')
      .update(
        JSON.stringify({
          ...fields,
          content,
          subAccount,
        }),
      )
      .digest('hex'),
    initialReason: ambiguous ? 'AMBIGUOUS_REFERENCE' : subAccountReason,
  };
}
