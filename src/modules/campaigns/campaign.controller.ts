import { ArgumentsHost, Body, Catch, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Put, Query, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccountTypes } from '../../common/decorators/account-types.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter.js';
import type { SafeUser } from '../users/user.select.js';
import { ForumRequestGuard, ForumResponsePolicy } from '../forum/forum-http-policy.js';
import { CampaignEvidenceDto, CampaignFeedDto, CampaignInputDto, CampaignNoteDto, CampaignPageDto, FeaturedBadgesDto } from './campaign.dto.js';
import { CampaignRateLimitError } from './campaign-rate-limit.js';
import { CampaignService } from './campaign.service.js';
import { CampaignResponse, achievementSchema, adminParticipationSchema, auditSchema, campaignPageSchema, campaignSchema, featuredResultSchema, featuredSchema, ownParticipationSchema, participationSchema, reviewSchema, tagSchema } from './campaign.responses.js';
import { ApiErrorResponseDto } from '../../common/dto/api-response.dto.js';

@Catch()
export class CampaignExceptionFilter extends ApiExceptionFilter {
  override catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (error instanceof CampaignRateLimitError) response.setHeader('Retry-After', String(error.retryAfterSeconds));
    super.catch(error instanceof HttpException ? error : new ApiException('INTERNAL_SERVER_ERROR', 'Unexpected campaign error', HttpStatus.INTERNAL_SERVER_ERROR), host);
  }
}
@ApiTags('Community campaigns')
@ApiResponse({ status: 401, type: ApiErrorResponseDto })
@ApiResponse({ status: 403, type: ApiErrorResponseDto })
@ApiResponse({ status: 404, type: ApiErrorResponseDto })
@ApiResponse({ status: 409, type: ApiErrorResponseDto })
@ApiResponse({ status: 422, type: ApiErrorResponseDto })
@ApiResponse({ status: 429, type: ApiErrorResponseDto, headers: { 'Retry-After': { schema: { type: 'integer', minimum: 1 } } } })
@ApiResponse({ status: 503, type: ApiErrorResponseDto })
@UseGuards(ForumRequestGuard)
@UseInterceptors(ForumResponsePolicy)
@UseFilters(CampaignExceptionFilter)
@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}
  @Public() @Get() @ApiOperation({ summary: 'Discover published community campaigns, no fundraising or promotions' })
  @CampaignResponse(campaignPageSchema(campaignSchema))
  feed(@Query() query: CampaignFeedDto) { return this.campaigns.feed(query); }
  @Get('me') @ApiBearerAuth()
  @CampaignResponse(campaignPageSchema(participationSchema))
  mine(@CurrentUser() user: SafeUser, @Query() query: CampaignPageDto) { return this.campaigns.mine(user.id, query); }
  @Put('me/featured-badges') @ApiBearerAuth()
  @CampaignResponse(featuredResultSchema)
  featured(@CurrentUser() user: SafeUser, @Body() input: FeaturedBadgesDto) { return this.campaigns.feature(user.id, input.ids); }
  @Public() @Get('users/:id/achievements')
  @CampaignResponse(campaignPageSchema(achievementSchema))
  achievements(@Param() params: UuidParamDto, @Query() query: CampaignPageDto) { return this.campaigns.achievements(params.id, query); }
  @Public() @Get('users/:id/participation-tags')
  @CampaignResponse(campaignPageSchema(tagSchema))
  tags(@Param() params: UuidParamDto, @Query() query: CampaignPageDto) { return this.campaigns.tags(params.id, query); }
  @Public() @Get('users/:id/featured-badges')
  @CampaignResponse(featuredSchema)
  highlights(@Param() params: UuidParamDto) { return this.campaigns.featured(params.id); }
  @Get('admin') @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(campaignPageSchema(campaignSchema))
  admin(@Query() query: CampaignFeedDto) { return this.campaigns.feed(query, true); }
  @Post('admin') @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(campaignSchema, true)
  create(@CurrentUser() user: SafeUser, @Body() input: CampaignInputDto) { return this.campaigns.create(user.id, input); }
  @Get('admin/:id') @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(campaignSchema)
  adminDetail(@Param() params: UuidParamDto) { return this.campaigns.detail(params.id, true); }
  @Patch('admin/:id') @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(campaignSchema)
  edit(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CampaignInputDto) { return this.campaigns.edit(user.id, params.id, input); }
  @Post('admin/:id/publish') @HttpCode(200) @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(campaignSchema)
  publish(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CampaignNoteDto) { return this.campaigns.lifecycle(user.id, params.id, 'publish', input.note); }
  @Post('admin/:id/close') @HttpCode(200) @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(campaignSchema)
  close(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CampaignNoteDto) { return this.campaigns.lifecycle(user.id, params.id, 'close', input.note); }
  @Post('admin/:id/cancel') @HttpCode(200) @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(campaignSchema)
  cancel(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CampaignNoteDto) { return this.campaigns.lifecycle(user.id, params.id, 'cancel', input.note); }
  @Get('admin/:id/submissions') @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(campaignPageSchema(adminParticipationSchema))
  submissions(@Param() params: UuidParamDto, @Query() query: CampaignPageDto) { return this.campaigns.submissions(params.id, query); }
  @Get('admin/:id/audit') @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(campaignPageSchema(auditSchema))
  history(@Param() params: UuidParamDto, @Query() query: CampaignPageDto) { return this.campaigns.history(params.id, query); }
  @Post('admin/participations/:id/verify') @HttpCode(200) @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(reviewSchema)
  verify(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CampaignNoteDto) { return this.campaigns.review(user.id, params.id, 'verify', input.note); }
  @Post('admin/participations/:id/reject') @HttpCode(200) @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(reviewSchema)
  reject(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CampaignNoteDto) { return this.campaigns.review(user.id, params.id, 'reject', input.note); }
  @Post('admin/participations/:id/revoke') @HttpCode(200) @AccountTypes('ADMIN') @ApiBearerAuth()
  @CampaignResponse(reviewSchema)
  revoke(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CampaignNoteDto) { return this.campaigns.review(user.id, params.id, 'revoke', input.note); }
  @Post('participations/:id/start') @HttpCode(200) @ApiBearerAuth()
  @CampaignResponse(participationSchema)
  start(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) { return this.campaigns.participate(user.id, params.id, 'start'); }
  @Post('participations/:id/withdraw') @HttpCode(200) @ApiBearerAuth()
  @CampaignResponse(participationSchema)
  withdraw(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) { return this.campaigns.participate(user.id, params.id, 'withdraw'); }
  @Post('participations/:id/evidence') @HttpCode(200) @ApiBearerAuth()
  @CampaignResponse(participationSchema)
  evidence(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CampaignEvidenceDto) { return this.campaigns.participate(user.id, params.id, 'submit', input); }
  @Public() @Get(':id')
  @CampaignResponse(campaignSchema)
  detail(@Param() params: UuidParamDto) { return this.campaigns.detail(params.id); }
  @Get(':id/participation') @ApiBearerAuth()
  @CampaignResponse(ownParticipationSchema)
  participation(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) { return this.campaigns.ownParticipation(user.id, params.id); }
  @Post(':id/register') @HttpCode(200) @AccountTypes('USER') @ApiBearerAuth()
  @CampaignResponse(participationSchema)
  register(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) { return this.campaigns.register(user.id, params.id); }
}
