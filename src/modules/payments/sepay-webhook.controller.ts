import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator.js';
import { SepayWebhookDto } from './dto/sepay-webhook.dto.js';
import { PaymentsService } from './payments.service.js';
import { SepayWebhookGuard } from './sepay-webhook.guard.js';

@ApiTags('Payments')
@Controller('payments/webhooks')
export class SepayWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @UseGuards(SepayWebhookGuard)
  @Post('sepay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticated SePay Test Mode webhook (no user JWT)',
  })
  @ApiHeader({ name: 'X-SePay-Signature', required: false })
  @ApiHeader({ name: 'X-SePay-Timestamp', required: false })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean', enum: [true] } },
    },
  })
  async receive(@Body() input: SepayWebhookDto, @Res() response: Response) {
    await this.payments.receiveSepay(input);
    // Provider protocol requires this exact body, rather than the API envelope.
    response.status(HttpStatus.OK).json({ success: true });
  }
}
