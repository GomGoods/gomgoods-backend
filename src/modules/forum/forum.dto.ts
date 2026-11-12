import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ForumText } from './forum-policy.js';

export enum ForumSort { NEWEST = 'newest', POPULAR = 'popular' }
export enum ForumPostState { DRAFT = 'DRAFT', PUBLISHED = 'PUBLISHED' }
export enum ForumReportReason { SPAM = 'SPAM', HARASSMENT = 'HARASSMENT', SCAM = 'SCAM', INAPPROPRIATE = 'INAPPROPRIATE', OTHER = 'OTHER' }
export enum ForumReviewState { IN_REVIEW = 'IN_REVIEW', RESOLVED = 'RESOLVED', REJECTED = 'REJECTED' }
export enum ForumReviewAction { NONE = 'NONE', HIDE = 'HIDE' }

export class ForumPageDto {
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(50) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) cursor?: string;
}
export class ForumFeedDto extends ForumPageDto {
  @ApiPropertyOptional({ enum: ForumSort, default: ForumSort.NEWEST }) @IsOptional() @IsEnum(ForumSort) sort: ForumSort = ForumSort.NEWEST;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9-]{1,50}$/) topic?: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @ForumText(100) q?: string;
}
export class CreateForumPostDto {
  @ApiProperty({ maxLength: 250 }) @ForumText(250) title!: string;
  @ApiProperty({ maxLength: 10000, description: 'Exact plain text; Unicode code points, no normalization or HTML interpretation.' }) @ForumText(10000) content!: string;
  @ApiProperty() @IsUUID() topicId!: string;
  @ApiPropertyOptional({ enum: ForumPostState, default: ForumPostState.PUBLISHED }) @ValidateIf((_object, value) => value !== undefined) @IsEnum(ForumPostState) status: ForumPostState = ForumPostState.PUBLISHED;
}
export class UpdateForumPostDto {
  @ApiPropertyOptional({ maxLength: 250 }) @ValidateIf((_object, value) => value !== undefined) @ForumText(250) title?: string;
  @ApiPropertyOptional({ maxLength: 10000 }) @ValidateIf((_object, value) => value !== undefined) @ForumText(10000) content?: string;
  @ApiPropertyOptional() @ValidateIf((_object, value) => value !== undefined) @IsUUID() topicId?: string;
  @ApiPropertyOptional({ enum: ForumPostState }) @ValidateIf((_object, value) => value !== undefined) @IsEnum(ForumPostState) status?: ForumPostState;
}
export class CreateForumCommentDto {
  @ApiProperty({ maxLength: 2000 }) @ForumText(2000) content!: string;
  @ApiPropertyOptional() @ValidateIf((_object, value) => value !== undefined) @IsUUID() parentId?: string;
}
export class UpdateForumCommentDto {
  @ApiProperty({ maxLength: 2000 }) @ForumText(2000) content!: string;
}
export class CreateForumReportDto {
  @ApiProperty({ enum: ForumReportReason }) @IsEnum(ForumReportReason) reason!: ForumReportReason;
  @ApiPropertyOptional({ maxLength: 2000 }) @ValidateIf((_object, value) => value !== undefined) @ForumText(2000) content?: string;
}
export class ForumModerationDto {
  @ApiProperty({ maxLength: 2000 }) @ForumText(2000) note!: string;
}
export class ReviewForumReportDto extends ForumModerationDto {
  @ApiProperty({ enum: ForumReviewState }) @IsEnum(ForumReviewState) status!: ForumReviewState;
  @ApiPropertyOptional({ enum: ForumReviewAction, default: ForumReviewAction.NONE }) @ValidateIf((_object, value) => value !== undefined) @IsEnum(ForumReviewAction) action: ForumReviewAction = ForumReviewAction.NONE;
}
