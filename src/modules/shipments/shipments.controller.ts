import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import type { SafeUser } from '../users/user.select.js';
import { CreateShipmentDto } from './dto/create-shipment.dto.js';
import { ShipmentsService } from './shipments.service.js';

@ApiTags('Shipments')
@ApiBearerAuth()
@Controller()
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post('orders/:id/shipments')
  @ApiOperation({ summary: 'Seller creates a shipment for an owned order' })
  @ApiCreatedResponse()
  createShipment(
    @CurrentUser() user: SafeUser,
    @Param() params: UuidParamDto,
    @Body() input: CreateShipmentDto,
  ) {
    return this.shipments.createShipment(user, params.id, input);
  }

  @Patch('shipments/:id/ready')
  @ApiOperation({ summary: 'Seller marks shipment ready to ship' })
  @ApiOkResponse()
  markReady(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) {
    return this.shipments.markReady(user, params.id);
  }

  @Patch('shipments/:id/ship')
  @ApiOperation({ summary: 'Seller marks shipment shipped' })
  @ApiOkResponse()
  markShipped(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) {
    return this.shipments.markShipped(user, params.id);
  }

  @Patch('shipments/:id/confirm-delivery')
  @ApiOperation({ summary: 'Buyer confirms a shipped shipment was delivered' })
  @ApiOkResponse()
  confirmDelivered(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) {
    return this.shipments.confirmDelivered(user, params.id);
  }
}
