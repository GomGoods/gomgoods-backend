import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ApiErrorResponseDto } from '../../common/dto/api-response.dto.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import type { SafeUser } from '../users/user.select.js';
import { FollowsService } from './follows.service.js';

@ApiTags('Follows')
@Controller()
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Post('stores/:id/follow')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Follow an active store' })
  @ApiCreatedResponse()
  @ApiOkResponse()
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  async followStore(
    @Param() params: UuidParamDto,
    @CurrentUser() user: SafeUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.follows.followStore(params.id, user);
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return { following: result.following };
  }

  @Delete('stores/:id/follow')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unfollow a store for the current user' })
  @ApiOkResponse()
  async unfollowStore(
    @Param() params: UuidParamDto,
    @CurrentUser() user: SafeUser,
  ) {
    const result = await this.follows.unfollowStore(params.id, user);
    return { following: result.following };
  }

  @Get('users/me/following/stores')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return active stores followed by the current user' })
  @ApiOkResponse()
  findFollowedStores(@CurrentUser() user: SafeUser) {
    return this.follows.findFollowedActiveStores(user);
  }

  @Post('users/:id/follow')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Follow an active user' })
  @ApiCreatedResponse()
  @ApiOkResponse()
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  async followUser(
    @Param() params: UuidParamDto,
    @CurrentUser() user: SafeUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.follows.followUser(params.id, user);
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return { following: result.following };
  }

  @Delete('users/:id/follow')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unfollow a user for the current user' })
  @ApiOkResponse()
  async unfollowUser(
    @Param() params: UuidParamDto,
    @CurrentUser() user: SafeUser,
  ) {
    const result = await this.follows.unfollowUser(params.id, user);
    return { following: result.following };
  }

  @Get('users/me/following/users')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return active users followed by the current user' })
  @ApiOkResponse()
  findFollowedUsers(
    @CurrentUser() user: SafeUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.follows.findFollowedActiveUsers(user, query);
  }
}
