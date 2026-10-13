import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
import { CreateStoreDto } from './dto/create-store.dto.js';
import { UpdateStoreDto } from './dto/update-store.dto.js';
import { StoresService } from './stores.service.js';

@ApiTags('Stores')
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a pending store for the current user' })
  @ApiCreatedResponse()
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  create(@CurrentUser() user: SafeUser, @Body() input: CreateStoreDto) {
    return this.stores.create(user, input);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the current user store' })
  @ApiOkResponse()
  findMine(@CurrentUser() user: SafeUser) {
    return this.stores.findMine(user);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Return an active public store' })
  @ApiOkResponse()
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  findPublic(@Param() params: UuidParamDto) {
    return this.stores.findPublic(params.id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the current owner store profile' })
  @ApiOkResponse()
  update(
    @Param() params: UuidParamDto,
    @CurrentUser() user: SafeUser,
    @Body() input: UpdateStoreDto,
  ) {
    return this.stores.update(params.id, user, input);
  }
}
