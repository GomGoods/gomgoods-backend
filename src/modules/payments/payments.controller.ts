import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AccountTypes } from '../../common/decorators/account-types.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { paginationParams } from '../../common/dto/pagination.dto.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import { AccountType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SafeUser } from '../users/user.select.js';
import {
  MockPaymentDto,
  PaymentEventQueryDto,
  ReconcilePaymentsDto,
} from './dto/payment-requests.dto.js';
import { PaymentsService } from './payments.service.js';
import { SepaySandboxClient } from './sepay-sandbox.client.js';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly sandbox: SepaySandboxClient,
    private readonly prisma: PrismaService,
  ) {}

  @Get('payments/:id')
  @ApiOperation({ summary: 'Return buyer-owned payment status' })
  @ApiOkResponse()
  findOne(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) {
    return this.payments.findBuyerPayment(user, params.id);
  }

  @Get('payments/:id/vietqr')
  @ApiOperation({
    summary:
      'Return test-only VietQR instructions for a pending bank-transfer payment',
  })
  @ApiOkResponse()
  instructions(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) {
    return this.payments.instructions(user, params.id);
  }

  @Post('payments/:id/mock-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Simulate payment for a buyer-owned order (mock mode and test DB only)',
  })
  @ApiOkResponse()
  mock(
    @CurrentUser() user: SafeUser,
    @Param() params: UuidParamDto,
    @Body() input: MockPaymentDto,
  ) {
    return this.payments.mockConfirm(user, params.id, input.idempotencyKey);
  }

  @Get('admin/payments/events')
  @AccountTypes(AccountType.ADMIN)
  @ApiOperation({
    summary:
      'Admin audit of test payment events, including unmatched/rejected transfers',
  })
  @ApiOkResponse()
  async events(@Query() query: PaymentEventQueryDto) {
    const { page, limit, skip, take } = paginationParams(query);
    const where = { status: query.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.paymentEvent.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          provider: true,
          providerEventId: true,
          paymentId: true,
          paymentReference: true,
          amount: true,
          status: true,
          reason: true,
          occurredAt: true,
          createdAt: true,
        },
      }),
      this.prisma.paymentEvent.count({ where }),
    ]);
    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  @Post('admin/payments/reconcile/sepay-test')
  @HttpCode(HttpStatus.OK)
  @AccountTypes(AccountType.ADMIN)
  @ApiOperation({
    summary:
      'Reconcile one page (up to 100 events) from SePay sandbox; repeat nextPage while hasMore',
  })
  @ApiOkResponse()
  async reconcile(@Body() input: ReconcilePaymentsDto) {
    const { events, hasMore } = await this.sandbox.transactions(input);
    const results = [];
    for (const event of events)
      results.push(await this.payments.receiveSepay(event));
    return {
      testOnly: true,
      page: input.page,
      hasMore,
      nextPage: hasMore ? input.page + 1 : null,
      results,
    };
  }
}
