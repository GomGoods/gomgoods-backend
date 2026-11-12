import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEnum, IsInt, IsISO8601, IsString, IsUUID, Max, MaxLength, Min, ValidateBy, ValidateIf } from 'class-validator';
import { CampaignType } from '../../generated/prisma/enums.js';
import { ForumText } from '../forum/forum-policy.js';

export function safeEvidenceUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  try {
    const url = new URL(value);
    // Evidence is never fetched, embedded, or previewed. Restrict links to common
    // public media hosts rather than allowing intranet/IP/data/javascript URLs.
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['drive.google.com', 'photos.google.com', 'imgur.com', 'i.imgur.com', 'www.youtube.com', 'youtu.be'].includes(url.hostname);
  } catch { return false; }
}
export class CampaignPageDto {
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @ValidateIf((_o, v) => v !== undefined) @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(50) limit = 20;
  @ApiPropertyOptional() @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(1024) cursor?: string;
}
export class CampaignFeedDto extends CampaignPageDto {
  @ApiPropertyOptional({ enum: CampaignType }) @ValidateIf((_o, v) => v !== undefined) @IsEnum(CampaignType) type?: CampaignType;
}
export class CampaignNoteDto {
  @ApiProperty() @ForumText(2000) note!: string;
}
export class CampaignInputDto extends CampaignNoteDto {
  @ApiProperty() @ForumText(200) title!: string;
  @ApiProperty() @ForumText(10000) description!: string;
  @ApiProperty({ enum: CampaignType }) @IsEnum(CampaignType) type!: CampaignType;
  @ApiProperty() @IsISO8601({ strict: true }) startsAt!: string;
  @ApiProperty() @IsISO8601({ strict: true }) endsAt!: string;
  @ApiProperty() @ForumText(10000) instructions!: string;
  @ApiProperty() @ForumText(10000) completionCriteria!: string;
  @ApiProperty() @ForumText(2000) eligibility!: string;
  @ApiPropertyOptional({ default: 0 }) @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) @Max(3650) minimumAccountAgeDays = 0;
  @ApiPropertyOptional() @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(1) @Max(100000) participationLimit?: number;
}
export class CampaignEvidenceDto {
  @ApiProperty() @IsUUID() submissionKey!: string;
  @ApiProperty({ description: 'Private plain text, never HTML' }) @ForumText(5000) text!: string;
  @ApiPropertyOptional({ description: 'HTTPS link on the documented media host allowlist; never fetched' })
  @ValidateIf((_o, v) => v !== undefined)
  @ValidateBy({ name: 'safeEvidenceUrl', validator: { validate: safeEvidenceUrl, defaultMessage: () => 'must be an HTTPS URL on an allowed public media host, without credentials or port' } }) url?: string;
}
export class FeaturedBadgesDto {
  @ApiProperty({ type: [String], maxItems: 3 }) @IsArray() @ArrayMaxSize(3) @ArrayUnique() @IsUUID(undefined, { each: true }) ids!: string[];
}
