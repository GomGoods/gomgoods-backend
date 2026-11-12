import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
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
import { CartService } from './cart.service.js';
import { AddCartItemDto } from './dto/add-cart-item.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';

@ApiTags('Cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Return the current user cart' })
  @ApiOkResponse()
  getCurrentCart(@CurrentUser() user: SafeUser) {
    return this.cart.getCurrentCart(user);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add a listing to the current cart' })
  @ApiCreatedResponse()
  addItem(@CurrentUser() user: SafeUser, @Body() input: AddCartItemDto) {
    return this.cart.addItem(user, input);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiOkResponse()
  updateItem(
    @CurrentUser() user: SafeUser,
    @Param() params: UuidParamDto,
    @Body() input: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(user, params.id, input);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Remove a cart item' })
  @ApiOkResponse()
  removeItem(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) {
    return this.cart.removeItem(user, params.id);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear the current cart' })
  @ApiOkResponse()
  clear(@CurrentUser() user: SafeUser) {
    return this.cart.clear(user);
  }
}
