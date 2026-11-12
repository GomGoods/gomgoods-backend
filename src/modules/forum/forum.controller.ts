import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountTypes } from '../../common/decorators/account-types.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ApiErrorResponseDto } from '../../common/dto/api-response.dto.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import type { SafeUser } from '../users/user.select.js';
import { CreateForumCommentDto, CreateForumPostDto, CreateForumReportDto, ForumFeedDto, ForumModerationDto, ForumPageDto, ReviewForumReportDto, UpdateForumCommentDto, UpdateForumPostDto } from './forum.dto.js';
import { ForumService } from './forum.service.js';
import { ForumExceptionFilter, ForumRequestGuard, ForumResponsePolicy } from './forum-http-policy.js';
import { ForumResponse, forumAdminReportSchema, forumAuditSchema, forumCommentSchema, forumFeedItemSchema, forumLikeSchema, forumPageSchema, forumPostSchema, forumReportSchema, forumStateSchema, forumTopicsSchema } from './forum.responses.js';

@ApiTags('Forum')
@ApiResponse({ status: 401, type: ApiErrorResponseDto })
@ApiResponse({ status: 403, type: ApiErrorResponseDto })
@ApiResponse({ status: 404, type: ApiErrorResponseDto })
@ApiResponse({ status: 409, type: ApiErrorResponseDto })
@ApiResponse({ status: 422, type: ApiErrorResponseDto })
@ApiResponse({ status: 503, type: ApiErrorResponseDto })
@ApiResponse({ status: 429, type: ApiErrorResponseDto, headers: { 'Retry-After': { description: 'Seconds until this write budget can be retried', schema: { type: 'integer', minimum: 1 } } } })
@UseGuards(ForumRequestGuard)
@UseInterceptors(ForumResponsePolicy)
@UseFilters(ForumExceptionFilter)
@Controller('forum')
export class ForumController {
  constructor(private readonly forum: ForumService) {}

  @Public() @Get('topics') @ApiOperation({ summary: 'Active forum taxonomy, independent of commerce categories' })
  @ForumResponse(forumTopicsSchema)
  topics() { return this.forum.topics(); }

  @Public() @Get('posts') @ApiOperation({ summary: 'Public feed: newest or snapshot LIKE score, then createdAt/id descending; literal title/content search' })
  @ForumResponse(forumPageSchema(forumFeedItemSchema))
  feed(@Query() query: ForumFeedDto) { return this.forum.feed(query); }

  @Get('me/posts') @ApiBearerAuth() @ApiOperation({ summary: 'Current author posts including own drafts, hidden and soft-deleted states' })
  @ForumResponse(forumPageSchema(forumPostSchema))
  mine(@CurrentUser() user: SafeUser, @Query() query: ForumPageDto) { return this.forum.mine(user.id, query); }

  @Post('posts') @ApiBearerAuth() @ApiOperation({ summary: 'Create a plain-text post as the authenticated author' })
  @ForumResponse(forumPostSchema, true)
  create(@CurrentUser() user: SafeUser, @Body() input: CreateForumPostDto) { return this.forum.create(user.id, input); }

  @Public() @Get('posts/:id') @ApiOperation({ summary: 'Read one public post; non-public IDs return 404' })
  @ForumResponse(forumPostSchema)
  detail(@Param() params: UuidParamDto) { return this.forum.detail(params.id); }

  @Patch('posts/:id') @ApiBearerAuth() @ApiOperation({ summary: 'Author-only edit/publish; moderation-hidden/deleted posts cannot be reopened' })
  @ForumResponse(forumPostSchema)
  update(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: UpdateForumPostDto) { return this.forum.update(user.id, params.id, input); }

  @Delete('posts/:id') @ApiBearerAuth() @ApiOperation({ summary: 'Author-only idempotent soft deletion' })
  @ForumResponse(forumStateSchema)
  remove(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) { return this.forum.remove(user.id, params.id); }

  @Public() @Get('posts/:id/comments') @ApiOperation({ summary: 'Flat visible-comment page ordered createdAt/id ascending; parentId expresses one reply level' })
  @ForumResponse(forumPageSchema(forumCommentSchema))
  comments(@Param() params: UuidParamDto, @Query() query: ForumPageDto) { return this.forum.comments(params.id, query); }

  @Post('posts/:id/comments') @ApiBearerAuth() @ApiOperation({ summary: 'Comment or reply to a visible root comment in this public post' })
  @ForumResponse(forumCommentSchema, true)
  comment(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CreateForumCommentDto) { return this.forum.addComment(user.id, params.id, input); }

  @Patch('comments/:id') @ApiBearerAuth() @ApiOperation({ summary: 'Edit own visible comment' })
  @ForumResponse(forumCommentSchema)
  editComment(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: UpdateForumCommentDto) { return this.forum.editComment(user.id, params.id, input); }

  @Delete('comments/:id') @ApiBearerAuth() @ApiOperation({ summary: 'Soft-delete own comment, including own moderated content' })
  @ForumResponse(forumStateSchema)
  removeComment(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) { return this.forum.removeComment(user.id, params.id); }

  @Put('posts/:id/like') @ApiBearerAuth() @ApiOperation({ summary: 'Idempotent LIKE with a database unique user/post key' })
  @ForumResponse(forumLikeSchema)
  like(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) { return this.forum.like(user.id, params.id, true); }

  @Delete('posts/:id/like') @ApiBearerAuth() @ApiOperation({ summary: 'Idempotent unlike, only while the post is public' })
  @ForumResponse(forumLikeSchema)
  unlike(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto) { return this.forum.like(user.id, params.id, false); }

  @Post('posts/:id/reports') @HttpCode(200) @ApiBearerAuth() @ApiOperation({ summary: 'Create/reuse one report per user/target, including previously reviewed reports' })
  @ForumResponse(forumReportSchema)
  reportPost(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CreateForumReportDto) { return this.forum.report(user.id, params.id, 'POST', input); }

  @Post('comments/:id/reports') @HttpCode(200) @ApiBearerAuth() @ApiOperation({ summary: 'Report a visible comment without permitting arbitrary polymorphic targets' })
  @ForumResponse(forumReportSchema)
  reportComment(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: CreateForumReportDto) { return this.forum.report(user.id, params.id, 'COMMENT', input); }

  @Get('admin/reports') @AccountTypes('ADMIN') @ApiBearerAuth() @ApiOperation({ summary: 'ADMIN forum-only reports and bounded recent moderation audit, no private chat access' })
  @ForumResponse(forumPageSchema(forumAdminReportSchema))
  reports(@Query() query: ForumPageDto) { return this.forum.reports(query); }

  @Patch('admin/reports/:id') @AccountTypes('ADMIN') @ApiBearerAuth() @ApiOperation({ summary: 'Review an open report; RESOLVED may hide target atomically with an audit note' })
  @ForumResponse(forumReportSchema)
  review(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: ReviewForumReportDto) { return this.forum.review(user.id, params.id, input); }

  @Post('admin/posts/:id/hide') @HttpCode(200) @AccountTypes('ADMIN') @ApiBearerAuth() @ApiOperation({ summary: 'Hide a violating post with a mandatory audit note, without hard deletion' })
  @ForumResponse(forumStateSchema)
  hidePost(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: ForumModerationDto) { return this.forum.moderate(user.id, params.id, 'POST', input); }

  @Post('admin/comments/:id/hide') @HttpCode(200) @AccountTypes('ADMIN') @ApiBearerAuth() @ApiOperation({ summary: 'Hide a violating comment with a mandatory audit note' })
  @ForumResponse(forumStateSchema)
  hideComment(@CurrentUser() user: SafeUser, @Param() params: UuidParamDto, @Body() input: ForumModerationDto) { return this.forum.moderate(user.id, params.id, 'COMMENT', input); }

  @Get('admin/posts/:id/moderation-actions') @AccountTypes('ADMIN') @ApiBearerAuth() @ApiOperation({ summary: 'Paginate retained forum-only moderation audit for a post' })
  @ForumResponse(forumPageSchema(forumAuditSchema))
  history(@Param() params: UuidParamDto, @Query() query: ForumPageDto) { return this.forum.moderationHistory(params.id, query); }
}
