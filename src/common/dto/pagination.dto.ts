import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

function optionalInteger(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(value);
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => optionalInteger(value))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => optionalInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function paginationParams(query: PaginationQueryDto) {
  const page = query.page;
  const limit = query.limit;
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
  };
}
