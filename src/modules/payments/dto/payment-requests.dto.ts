import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { PaymentEventStatus } from '../../../generated/prisma/enums.js';

export class MockPaymentDto {
  @ApiProperty({ maxLength: 80 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  idempotencyKey!: string;
}

export class ReconcilePaymentsDto {
  @ApiProperty({ example: '2026-10-16T00:00:00+07:00' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ example: '2026-10-16T23:59:59+07:00' })
  @IsISO8601({ strict: true })
  to!: string;

  @ApiPropertyOptional({ default: 1, maximum: 10000 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
}

export class PaymentEventQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentEventStatus })
  @IsOptional()
  @IsEnum(PaymentEventStatus)
  status?: PaymentEventStatus;
}
