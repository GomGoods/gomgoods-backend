import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';

import { IsMoneyString } from '../../../common/dto/decimal-string.decorator.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { ListingCondition } from '../../../generated/prisma/enums.js';

export class ListingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ListingCondition })
  @IsOptional()
  @IsEnum(ListingCondition)
  condition?: ListingCondition;

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

  @ApiPropertyOptional({ enum: ['personal', 'store'] })
  @IsOptional()
  @IsIn(['personal', 'store'])
  sellerType?: 'personal' | 'store';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sellerUserId?: string;
}
