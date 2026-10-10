import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^[A-Za-z0-9_]{3,50}$/, {
    message:
      'username must be 3-50 characters and contain only letters, numbers, or underscores',
  })
  username!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
