import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AccountTypes } from '../../common/decorators/account-types.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import { AccountType } from '../../generated/prisma/enums.js';
import type { SafeUser } from '../users/user.select.js';
import { CancelOrderDto } from './dto/cancel-order.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  @ApiOperation({ summary: 'Return current buyer orders' })
  @ApiOkResponse()
  findBuyerOrders(
    @CurrentUser() user: SafeUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.orders.findBuyerOrders(user, query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Return one buyer order' })
  @ApiOkResponse()
  findBuyerOrder(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) {
    return this.orders.findBuyerOrder(user, params.id);
  }

  @Post('orders/:id/cancel')
  @ApiOperation({ summary: 'Cancel a pending prepaid buyer order' })
  @ApiOkResponse()
  cancelBuyerOrder(
    @CurrentUser() user: SafeUser,
    @Param() params: UuidParamDto,
    @Body() input: CancelOrderDto,
  ) {
    return this.orders.cancelBuyerOrder(user, params.id, input);
  }

  @Get('seller/orders')
  @ApiOperation({ summary: 'Return orders for current personal/store seller' })
  @ApiOkResponse()
  findSellerOrders(
    @CurrentUser() user: SafeUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.orders.findSellerOrders(user, query);
  }

  @Get('seller/orders/:id')
  @ApiOperation({ summary: 'Return one seller-scoped order' })
  @ApiOkResponse()
  findSellerOrder(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) {
    return this.orders.findSellerOrder(user, params.id);
  }

  @Post('seller/orders/:id/cancel')
  @ApiOperation({ summary: 'Seller cancels a confirmed order before fulfillment' })
  @ApiOkResponse()
  cancelSellerOrder(
    @CurrentUser() user: SafeUser,
    @Param() params: UuidParamDto,
    @Body() input: CancelOrderDto,
  ) {
    return this.orders.cancelSellerOrder(user, params.id, input);
  }

  @Post('orders/expire-pending')
  @AccountTypes(AccountType.ADMIN)
  @ApiOperation({ summary: 'Expire pending prepaid orders; protected admin trigger' })
  @ApiOkResponse()
  expirePendingOrders() {
    return this.orders.expirePendingOrders();
  }
}
