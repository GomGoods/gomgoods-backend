import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ApiErrorResponseDto } from '../../common/dto/api-response.dto.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import type { SafeUser } from '../users/user.select.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { ProductQueryDto } from './dto/product-query.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductsService } from './products.service.js';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Return active products' })
  @ApiOkResponse()
  findAll(@Query() query: ProductQueryDto) {
    return this.products.findAll(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Return an active product' })
  @ApiOkResponse()
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  findOne(@Param() params: UuidParamDto) {
    return this.products.findOne(params.id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a product for the current active store' })
  @ApiCreatedResponse()
  create(@CurrentUser() user: SafeUser, @Body() input: CreateProductDto) {
    return this.products.create(user, input);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an owned product' })
  @ApiOkResponse()
  update(
    @Param() params: UuidParamDto,
    @CurrentUser() user: SafeUser,
    @Body() input: UpdateProductDto,
  ) {
    return this.products.update(params.id, user, input);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-archive an owned product' })
  @ApiOkResponse()
  archive(@Param() params: UuidParamDto, @CurrentUser() user: SafeUser) {
    return this.products.archive(params.id, user);
  }
}
