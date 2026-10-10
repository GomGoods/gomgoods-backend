import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  ApiErrorResponseDto,
  AuthSuccessResponseDto,
  UserSuccessResponseDto,
} from '../../common/dto/api-response.dto.js';
import type { SafeUser } from '../users/user.select.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a user account' })
  @ApiCreatedResponse({ type: AuthSuccessResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  @ApiResponse({ status: 422, type: ApiErrorResponseDto })
  register(@Body() input: RegisterDto) {
    return this.auth.register(input);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiOkResponse({ type: AuthSuccessResponseDto })
  @ApiResponse({ status: 401, type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, type: ApiErrorResponseDto })
  @ApiResponse({ status: 422, type: ApiErrorResponseDto })
  login(@Body() input: LoginDto) {
    return this.auth.login(input);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the current authenticated user' })
  @ApiOkResponse({ type: UserSuccessResponseDto })
  @ApiResponse({ status: 401, type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, type: ApiErrorResponseDto })
  me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }
}
