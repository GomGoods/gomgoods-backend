import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  ApiErrorResponseDto,
  AuthSuccessResponseDto,
  UserSuccessResponseDto,
} from '../../common/dto/api-response.dto.js';
import type { SafeUser } from '../users/user.select.js';
import { AuthService } from './auth.service.js';
import type { IssuedAuthentication } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { AuthRequestGuard } from './guards/auth-request.guard.js';
import { RefreshCookieService } from './refresh-cookie.service.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(AuthRequestGuard)
  @Post('register')
  @ApiOperation({ summary: 'Register a user account' })
  @ApiCreatedResponse({ type: AuthSuccessResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  @ApiResponse({ status: 422, type: ApiErrorResponseDto })
  async register(
    @Body() input: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.withRefreshCookie(await this.auth.register(input), response);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(AuthRequestGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiOkResponse({ type: AuthSuccessResponseDto })
  @ApiResponse({ status: 401, type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, type: ApiErrorResponseDto })
  @ApiResponse({ status: 422, type: ApiErrorResponseDto })
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.withRefreshCookie(await this.auth.login(input), response);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(AuthRequestGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('gomgoods_refresh')
  @ApiOperation({ summary: 'Rotate the refresh credential' })
  @ApiOkResponse({ type: AuthSuccessResponseDto })
  @ApiResponse({ status: 401, type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, type: ApiErrorResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.refresh(this.refreshCookie.read(request));
    if (!result.ok) {
      if (result.clearCookie) this.refreshCookie.clear(response);
      throw result.error;
    }
    return this.withRefreshCookie(result.result, response);
  }

  @Public()
  @UseGuards(AuthRequestGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('gomgoods_refresh')
  @ApiOperation({ summary: 'Revoke the current authentication session' })
  @ApiNoContentResponse()
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(this.refreshCookie.read(request));
    this.refreshCookie.clear(response);
  }

  @UseGuards(AuthRequestGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke every session for the current user' })
  @ApiNoContentResponse()
  async logoutAll(
    @CurrentUser() user: SafeUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user.id);
    this.refreshCookie.clear(response);
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

  private withRefreshCookie(
    result: IssuedAuthentication,
    response: Response,
  ) {
    this.refreshCookie.set(
      response,
      result.refreshGrant.token,
      result.refreshGrant.expiresAt,
    );
    return result.publicResult;
  }
}
