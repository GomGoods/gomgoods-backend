import { createHash } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  OrderStatus,
  PaymentEventProvider,
  PaymentEventStatus,
  PaymentMethod,
  PaymentStatus,
  TransactionStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { lockOrderForMutation } from '../orders/order-lock.js';
import type { SafeUser } from '../users/user.select.js';
import type { SepayWebhookDto } from './dto/sepay-webhook.dto.js';
import {
  normalizeSepay,
  type NormalizedPaymentEvent,
  paymentReference,
  referencePaymentId,
} from './payment-event.js';
import { PaymentSettings } from './payment-settings.js';
import { paymentSelect } from './payment.select.js';

const eventSelect = {
  id: true,
  providerEventId: true,
  status: true,
  reason: true,
  paymentId: true,
  payloadHash: true,
} satisfies Prisma.PaymentEventSelect;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PaymentSettings,
  ) {}

  async findBuyerPayment(user: SafeUser, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, order: { userId: user.id } },
      select: paymentSelect,
    });
    if (!payment) throw this.notFound();
    return payment;
  }

  async instructions(user: SafeUser, id: string) {
    this.settings.requireMode('sepay_test');
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.payment.findFirst({
        where: { id, order: { userId: user.id } },
        select: { orderId: true },
      });
      if (!initial) throw this.notFound();
      await lockOrderForMutation(tx, initial.orderId);
      const payment = await tx.payment.findFirstOrThrow({
        where: { id, order: { userId: user.id } },
        include: { order: true },
      });
      if (
        payment.method !== PaymentMethod.BANK_TRANSFER ||
        payment.status !== PaymentStatus.PENDING ||
        payment.order.status !== OrderStatus.PENDING ||
        payment.order.cancelledAt ||
        !payment.order.expiresAt ||
        payment.order.expiresAt <= new Date()
      )
        throw new ApiException(
          'RESOURCE_CONFLICT',
          'Payment is not available for transfer',
          HttpStatus.CONFLICT,
        );
      if (!payment.amount.isInteger() || payment.amount.lte(0))
        throw new ApiException(
          'VALIDATION_FAILED',
          'VietQR requires a positive whole VND amount',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      const reference = paymentReference(payment.id);
      const rootAccountNumber = this.settings.required('SEPAY_TEST_ACCOUNT_NUMBER');
      const accountNumber = this.settings.va ?? rootAccountNumber;
      const bankBin = this.settings.required('VIETQR_TEST_BANK_BIN');
      const accountName = this.settings.required('VIETQR_TEST_ACCOUNT_NAME');
      const url = new URL(
        `https://img.vietqr.io/image/${bankBin}-${accountNumber}-compact2.svg`,
      );
      url.search = new URLSearchParams({
        amount: payment.amount.toFixed(0),
        addInfo: reference,
        accountName,
      }).toString();
      return {
        paymentId: payment.id,
        mode: 'sepay_test',
        testOnly: true,
        currency: 'VND',
        amount: payment.amount.toFixed(0),
        reference,
        expiresAt: payment.order.expiresAt,
        bankBin,
        accountNumber,
        accountName,
        qrUrl: url.toString(),
      };
    });
  }

  async mockConfirm(user: SafeUser, id: string, idempotencyKey: string) {
    this.settings.requireMode('mock');
    const payment = await this.findBuyerPayment(user, id);
    if (payment.method !== PaymentMethod.BANK_TRANSFER || payment.amount.lte(0))
      throw new ApiException(
        'RESOURCE_CONFLICT',
        'Mock confirmation requires a positive bank-transfer payment',
        HttpStatus.CONFLICT,
      );
    const fields = {
      provider: PaymentEventProvider.MOCK,
      providerEventId: `${payment.id}:${idempotencyKey}`,
      bankReference: null,
      accountNumber: 'MOCK',
      gateway: 'mock',
      paymentReference: paymentReference(payment.id),
      amount: payment.amount.toFixed(2),
      transferType: 'in' as const,
      occurredAt: payment.createdAt,
    };
    return this.ingest({
      ...fields,
      payloadHash: createHash('sha256')
        .update(JSON.stringify(fields))
        .digest('hex'),
      initialReason: null,
    });
  }

  async receiveSepay(input: SepayWebhookDto) {
    this.settings.requireMode('sepay_test');
    return this.ingest(normalizeSepay(input, this.settings.va));
  }

  private async ingest(input: NormalizedPaymentEvent) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const duplicates = await tx.paymentEvent.findMany({
          where: this.eventWhere(input),
          orderBy: { createdAt: 'asc' },
          select: eventSelect,
        });
        if (duplicates.length) return this.replay(tx, duplicates, input);
        const { initialReason, ...data } = input;
        const event = await tx.paymentEvent.create({
          data,
          select: { id: true },
        });
        const finish = async (
          status: PaymentEventStatus,
          reason: string | null,
          paymentId?: string,
        ) => {
          const result = await tx.paymentEvent.update({
            where: { id: event.id },
            data: { status, reason, paymentId },
            select: eventSelect,
          });
          return this.eventResponse(result, false);
        };
        if (input.provider === PaymentEventProvider.SEPAY_TEST) {
          if (
            input.accountNumber !==
              this.settings
                .required('SEPAY_TEST_ACCOUNT_NUMBER')
                .toUpperCase() ||
            input.gateway !==
              this.settings
                .required('SEPAY_TEST_BANK_NAME')
                .trim()
                .toLowerCase()
          )
            return finish(PaymentEventStatus.IGNORED, 'WRONG_DESTINATION');
          if (input.transferType !== 'in')
            return finish(PaymentEventStatus.IGNORED, 'OUTGOING_TRANSFER');
          if (initialReason)
            return finish(PaymentEventStatus.IGNORED, initialReason);
        }
        const paymentId = referencePaymentId(input.paymentReference);
        const initial = paymentId
          ? await tx.payment.findUnique({
              where: { id: paymentId },
              select: { orderId: true },
            })
          : null;
        if (!paymentId || !initial)
          return finish(PaymentEventStatus.IGNORED, 'UNMATCHED_REFERENCE');
        await lockOrderForMutation(tx, initial.orderId);
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
          include: { order: true },
        });
        const now = new Date();
        let reason: string | null = null;
        if (
          payment.method !== PaymentMethod.BANK_TRANSFER ||
          payment.order.paymentMethod !== PaymentMethod.BANK_TRANSFER
        )
          reason = 'UNSUPPORTED_PAYMENT_METHOD';
        else if (
          !payment.amount.equals(input.amount) ||
          !payment.amount.equals(payment.order.total)
        )
          reason = 'AMOUNT_MISMATCH';
        else if (
          input.occurredAt.getTime() <
            Math.floor(payment.createdAt.getTime() / 1000) * 1000 ||
          input.occurredAt.getTime() > now.getTime() + 300_000
        )
          reason = 'INVALID_PAYMENT_TIME';
        else if (
          payment.order.cancelledAt ||
          payment.order.status === OrderStatus.CANCELLED
        )
          reason = 'ORDER_CANCELLED';
        else if (
          !payment.order.expiresAt ||
          payment.order.expiresAt <= now ||
          input.occurredAt >= payment.order.expiresAt
        )
          reason = 'ORDER_EXPIRED';
        else if (
          payment.status !== PaymentStatus.PENDING ||
          payment.order.status !== OrderStatus.PENDING
        )
          reason = 'PAYMENT_NOT_PENDING';
        if (reason)
          return finish(PaymentEventStatus.REJECTED, reason, paymentId);
        const updatedOrder = await tx.order.updateMany({
          where: {
            id: payment.orderId,
            status: OrderStatus.PENDING,
            cancelledAt: null,
            expiresAt: { gt: now },
            payments: {
              none: {
                status: { in: [PaymentStatus.PAID, PaymentStatus.AUTHORIZED] },
              },
            },
          },
          data: { status: OrderStatus.CONFIRMED },
        });
        if (updatedOrder.count !== 1)
          return finish(
            PaymentEventStatus.REJECTED,
            'ORDER_NOT_PENDING',
            paymentId,
          );
        const updatedPayment = await tx.payment.updateMany({
          where: { id: paymentId, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.PAID, paidAt: input.occurredAt },
        });
        if (updatedPayment.count !== 1)
          throw new ApiException(
            'RESOURCE_CONFLICT',
            'Payment state changed during confirmation',
            HttpStatus.CONFLICT,
          );
        await tx.transaction.create({
          data: {
            paymentId,
            transactionCode: `${input.provider}:${input.providerEventId}`,
            amount: input.amount,
            status: TransactionStatus.SUCCEEDED,
          },
        });
        return finish(PaymentEventStatus.APPLIED, null, paymentId);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicates = await this.prisma.paymentEvent.findMany({
          where: this.eventWhere(input),
          orderBy: { createdAt: 'asc' },
          select: eventSelect,
        });
        if (duplicates.length)
          return this.replay(this.prisma, duplicates, input);
      }
      throw error;
    }
  }

  private eventWhere(
    input: NormalizedPaymentEvent,
  ): Prisma.PaymentEventWhereInput {
    return {
      provider: input.provider,
      OR: [
        { providerEventId: input.providerEventId },
        ...(input.bankReference
          ? [
              {
                accountNumber: input.accountNumber,
                gateway: input.gateway,
                bankReference: input.bankReference,
              },
            ]
          : []),
      ],
    };
  }

  private async replay(
    client: Prisma.TransactionClient | PrismaService,
    events: Prisma.PaymentEventGetPayload<{ select: typeof eventSelect }>[],
    input: NormalizedPaymentEvent,
  ) {
    if (events.some((event) => event.payloadHash !== input.payloadHash))
      throw new ApiException(
        'RESOURCE_CONFLICT',
        'Provider event identity was reused with different payment data',
        HttpStatus.CONFLICT,
      );
    const original =
      events.find((event) => event.reason !== 'DUPLICATE_PROVIDER_IDENTITY') ??
      events[0];
    // Webhook numeric IDs and API UUIDs may identify the same bank reference.
    // Retain each alias ID too, so it cannot later be reused for another payment.
    if (
      !events.some((event) => event.providerEventId === input.providerEventId)
    ) {
      const { initialReason: _initialReason, ...data } = input;
      const alias = await client.paymentEvent.upsert({
        where: {
          provider_providerEventId: {
            provider: input.provider,
            providerEventId: input.providerEventId,
          },
        },
        create: {
          ...data,
          bankReference: null,
          status: PaymentEventStatus.IGNORED,
          reason: 'DUPLICATE_PROVIDER_IDENTITY',
          paymentId: original.paymentId,
        },
        update: { providerEventId: input.providerEventId },
        select: { payloadHash: true },
      });
      if (alias.payloadHash !== input.payloadHash)
        throw new ApiException(
          'RESOURCE_CONFLICT',
          'Provider event identity was reused with different payment data',
          HttpStatus.CONFLICT,
        );
    }
    return this.eventResponse(original, true);
  }

  private eventResponse(
    event: Prisma.PaymentEventGetPayload<{ select: typeof eventSelect }>,
    duplicate: boolean,
  ) {
    return {
      eventId: event.id,
      paymentId: event.paymentId,
      status: event.status,
      reason: event.reason,
      duplicate,
      testOnly: true,
    };
  }

  private notFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'Payment not found',
      HttpStatus.NOT_FOUND,
    );
  }
}
