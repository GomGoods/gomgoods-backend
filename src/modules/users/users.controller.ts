import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ApiErrorResponseDto } from '../../common/dto/api-response.dto.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import type { SafeUser } from './user.select.js';
import { UpdateCurrentUserDto } from './dto/update-current-user.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the current user profile' })
  @ApiOkResponse()
  @ApiResponse({ status: 401, type: ApiErrorResponseDto })
  me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update permitted current-user profile fields' })
  @ApiOkResponse()
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  @ApiResponse({ status: 422, type: ApiErrorResponseDto })
  updateMe(@CurrentUser() user: SafeUser, @Body() input: UpdateCurrentUserDto) {
    return this.users.updateCurrentUser(user.id, input);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Return a public user profile' })
  @ApiOkResponse()
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  findPublic(@Param() params: UuidParamDto) {
    return this.users.findPublicProfile(params.id);
  }
}
