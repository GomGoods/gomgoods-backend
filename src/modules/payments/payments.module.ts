import { Module } from '@nestjs/common';

import { PaymentSettings } from './payment-settings.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { SepaySandboxClient } from './sepay-sandbox.client.js';
import { SepayWebhookController } from './sepay-webhook.controller.js';
import { SepayWebhookGuard } from './sepay-webhook.guard.js';

@Module({
  controllers: [SepayWebhookController, PaymentsController],
  providers: [
    PaymentSettings,
    PaymentsService,
    SepayWebhookGuard,
    SepaySandboxClient,
  ],
})
export class PaymentsModule {}
