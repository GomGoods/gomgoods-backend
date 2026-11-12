import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SepayWebhookDto {
  @ApiProperty({ description: 'SePay numeric webhook ID or API v2 UUID' })
  @Transform(({ value }) =>
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value,
  )
  @IsString()
  @Matches(
    /^(?:[1-9]\d{0,19}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  )
  id!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  gateway!: string;

  @ApiProperty({
    example: '2026-10-16 12:00:00',
    description: 'Vietnam time (UTC+07)',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  transactionDate!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,30}$/)
  accountNumber!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subAccount?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string | null;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  content!: string;

  @ApiProperty({ enum: ['in', 'out'] })
  @IsIn(['in', 'out'])
  transferType!: 'in' | 'out';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiProperty({ minimum: 1, maximum: 999999999999 })
  @IsInt()
  @Min(1)
  @Max(999999999999)
  transferAmount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  accumulated?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  referenceCode?: string | null;
}
