import { HttpStatus, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { SepayWebhookDto } from './dto/sepay-webhook.dto.js';
import type { ReconcilePaymentsDto } from './dto/payment-requests.dto.js';
import { PaymentSettings } from './payment-settings.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid provider response');
  return value as Record<string, unknown>;
}

function vietnamTime(value: string): string {
  return new Date(new Date(value).getTime() + 7 * 3600_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

@Injectable()
export class SepaySandboxClient {
  constructor(private readonly settings: PaymentSettings) {}

  async transactions(input: ReconcilePaymentsDto) {
    this.settings.requireMode('sepay_test');
    const from = new Date(input.from).getTime();
    const to = new Date(input.to).getTime();
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from > to ||
      to - from > 86400_000
    )
      throw new ApiException(
        'VALIDATION_FAILED',
        'Reconciliation requires an ordered time range of at most 24 hours',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const token = this.settings.required('SEPAY_TEST_API_TOKEN');
    const bankAccountId = this.settings.required('SEPAY_TEST_BANK_ACCOUNT_ID');
    // Fixed sandbox origin, no caller-selected URL or Live fallback.
    const url = new URL('https://userapi-sandbox.sepay.vn/v2/transactions');
    url.search = new URLSearchParams({
      bank_account_id: bankAccountId,
      transaction_date_from: vietnamTime(input.from),
      transaction_date_to: vietnamTime(input.to),
      page: String(input.page),
      per_page: '100',
      transaction_date_sort: 'asc',
    }).toString();
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok || !response.body)
        throw new Error('Provider unavailable');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 1024 * 1024) throw new Error('Provider response too large');
        chunks.push(chunk);
      }
      const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (
        body.status !== 'success' ||
        !Array.isArray(body.data) ||
        body.data.length > 100
      )
        throw new Error('Invalid provider response');
      const pagination = record(record(body.meta).pagination);
      if (
        typeof pagination.has_more !== 'boolean' ||
        pagination.current_page !== input.page
      )
        throw new Error('Invalid pagination');
      const events = body.data.map((value) => {
        const row = record(value);
        if (
          row.bank_account_id !== bankAccountId ||
          (row.transfer_type !== 'in' && row.transfer_type !== 'out')
        )
          throw new Error('Invalid bank account');
        const amount =
          row.transfer_type === 'in' ? row.amount_in : row.amount_out;
        const opposite =
          row.transfer_type === 'in' ? row.amount_out : row.amount_in;
        if (opposite !== 0) throw new Error('Ambiguous transfer direction');
        const mapped = plainToInstance(SepayWebhookDto, {
          id: row.id,
          gateway: row.bank_brand_name,
          transactionDate: row.transaction_date,
          accountNumber: row.account_number,
          subAccount: row.va,
          code: row.code,
          content: row.transaction_content,
          transferType: row.transfer_type,
          transferAmount: amount,
          referenceCode: row.reference_number,
        });
        if (
          validateSync(mapped, { whitelist: true, forbidNonWhitelisted: true })
            .length
        )
          throw new Error('Invalid provider transaction');
        return mapped;
      });
      return { events, hasMore: pagination.has_more };
    } catch {
      // Never expose headers, tokens, account payloads or upstream error bodies.
      throw new ApiException(
        'SERVICE_UNAVAILABLE',
        'SePay sandbox reconciliation is unavailable or returned invalid data',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
