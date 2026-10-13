import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateCurrentUserDto {
  @ApiPropertyOptional({
    minLength: 3,
    maxLength: 50,
    pattern: '^[A-Za-z0-9_]{3,50}$',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[A-Za-z0-9_]{3,50}$/, {
    message:
      'username must be 3-50 characters and contain only letters, numbers, or underscores',
  })
  username?: string;
}
