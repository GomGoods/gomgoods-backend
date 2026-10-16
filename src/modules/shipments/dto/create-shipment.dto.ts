import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ShipmentItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderItemId!: string;

  @ApiProperty({ minimum: 1, maximum: 2_147_483_647 })
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity!: number;
}

export class CreateShipmentDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  carrier!: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(150)
  trackingNo?: string;

  @ApiProperty({ type: [ShipmentItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ShipmentItemDto)
  items!: ShipmentItemDto[];
}
