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
import { CreateListingDto } from './dto/create-listing.dto.js';
import { ListingQueryDto } from './dto/listing-query.dto.js';
import { UpdateListingStatusDto } from './dto/update-listing-status.dto.js';
import { UpdateListingDto } from './dto/update-listing.dto.js';
import { ListingsService } from './listings.service.js';

@ApiTags('Listings')
@Controller()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get('listings')
  @ApiOperation({ summary: 'Return active listings' })
  @ApiOkResponse()
  findAll(@Query() query: ListingQueryDto) {
    return this.listings.findAll(query);
  }

  @Public()
  @Get('listings/:id')
  @ApiOperation({ summary: 'Return an active listing' })
  @ApiOkResponse()
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  findOne(@Param() params: UuidParamDto) {
    return this.listings.findOne(params.id);
  }

  @Post('listings/personal')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a personal listing in draft status' })
  @ApiCreatedResponse()
  createPersonal(
    @CurrentUser() user: SafeUser,
    @Body() input: CreateListingDto,
  ) {
    return this.listings.createPersonal(user, input);
  }

  @Post('products/:id/listings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a store-backed listing in draft status' })
  @ApiCreatedResponse()
  createForProduct(
    @Param() params: UuidParamDto,
    @CurrentUser() user: SafeUser,
    @Body() input: CreateListingDto,
  ) {
    return this.listings.createForProduct(params.id, user, input);
  }

  @Patch('listings/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an owned listing' })
  @ApiOkResponse()
  update(
    @Param() params: UuidParamDto,
    @CurrentUser() user: SafeUser,
    @Body() input: UpdateListingDto,
  ) {
    return this.listings.update(params.id, user, input);
  }

  @Patch('listings/:id/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an owned listing status' })
  @ApiOkResponse()
  updateStatus(
    @Param() params: UuidParamDto,
    @CurrentUser() user: SafeUser,
    @Body() input: UpdateListingStatusDto,
  ) {
    return this.listings.updateStatus(params.id, user, input);
  }

  @Delete('listings/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-remove an owned listing' })
  @ApiOkResponse()
  remove(@Param() params: UuidParamDto, @CurrentUser() user: SafeUser) {
    return this.listings.remove(params.id, user);
  }
}
