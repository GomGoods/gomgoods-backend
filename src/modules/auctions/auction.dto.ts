import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsISO8601, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ForumText } from '../forum/forum-policy.js';
export const MAX_VND = 999_999_999_999;
export class AuctionPageDto {
  @ApiPropertyOptional() @ValidateIf((_o,v)=>v!==undefined) @Transform(({value})=>Number(value)) @IsInt() @Min(1) @Max(50) limit=20;
  @ApiPropertyOptional() @ValidateIf((_o,v)=>v!==undefined) @IsString() @MaxLength(1024) cursor?:string;
}
export class CreateAuctionDto {
  @ApiProperty() @IsUUID() listingId!:string;
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VND) startingPrice!:number;
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VND) bidStep!:number;
  @ApiProperty() @IsISO8601({strict:true}) @Matches(/(?:Z|[+-]\d\d:\d\d)$/) startsAt!:string;
  @ApiProperty() @IsISO8601({strict:true}) @Matches(/(?:Z|[+-]\d\d:\d\d)$/) endsAt!:string;
}
export class PlaceBidDto {
  @ApiProperty() @IsUUID() idempotencyKey!:string;
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_VND) amount!:number;
  @ApiProperty() @IsUUID() addressId!:string;
}
export class SocketBidDto extends PlaceBidDto { @ApiProperty() @IsUUID() auctionId!:string; }
export class AuctionSubscribeDto { @ApiProperty() @IsUUID() auctionId!:string; }
export class AuctionCancelDto { @ApiProperty() @ForumText(1000) reason!:string; }
export class AuctionAddressDto {
  @ApiProperty() @ForumText(150) recipient!:string;
  @ApiProperty() @Matches(/^[+0-9 ()-]{8,30}$/) phone!:string;
  @ApiProperty() @ForumText(255) addressLine!:string;
  @ApiProperty() @ForumText(100) city!:string;
  @ApiProperty() @ForumText(100) district!:string;
  @ApiProperty() @ForumText(100) ward!:string;
}
export function effectiveEnd(now:Date,end:Date,original:Date):Date {
  return +end-+now<120000 ? new Date(Math.min(Math.max(+end,+now+120000),+original+1800000)) : end;
}
