import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { IsMoneyString } from '../../../common/dto/decimal-string.decorator.js';

function optionalInteger(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(value);
}

export class DiscoveryListingQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => optionalInteger(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ enum: ['personal', 'store'] })
  @IsOptional()
  @IsIn(['personal', 'store'])
  sellerType?: 'personal' | 'store';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: '100.00' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsMoneyString()
  minPrice?: string;

  @ApiPropertyOptional({ example: '1000.00' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsMoneyString()
  maxPrice?: string;
}
