import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({ minimum: 1, maximum: 2_147_483_647 })
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity!: number;
}
