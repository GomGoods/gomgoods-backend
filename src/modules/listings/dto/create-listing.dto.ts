import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import { IsMoneyString } from '../../../common/dto/decimal-string.decorator.js';
import { ListingCondition } from '../../../generated/prisma/enums.js';

export class CreateListingDto {
  @ApiProperty({
    description: 'Decimal string with at most 2 fractional digits',
    example: '1250000.00',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsMoneyString()
  price!: string;

  @ApiProperty({ minimum: 1 })
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ enum: ListingCondition })
  @IsEnum(ListingCondition)
  condition!: ListingCondition;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(4000)
  description?: string;
}
