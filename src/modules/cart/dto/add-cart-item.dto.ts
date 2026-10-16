import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listingId!: string;

  @ApiProperty({ minimum: 1, maximum: 2_147_483_647, default: 1 })
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity = 1;
}
