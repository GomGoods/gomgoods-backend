import { ApiProperty } from '@nestjs/swagger';

import { AccountType, UserStatus } from '../../generated/prisma/enums.js';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: AccountType })
  accountType!: AccountType;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ nullable: true, required: false, type: Object })
  store?: Record<string, unknown> | null;
}

export class AuthDataResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ example: 900 })
  expiresIn!: number;
}

export class AuthSuccessResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: AuthDataResponseDto })
  data!: AuthDataResponseDto;
}

export class UserSuccessResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: UserResponseDto })
  data!: UserResponseDto;
}

class ApiErrorDto {
  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code!: string;

  @ApiProperty({ example: 'Request validation failed' })
  message!: string;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  details!: Record<string, unknown>[];
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ApiErrorDto })
  error!: ApiErrorDto;
}

class HealthDataResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({ example: 'available' })
  database!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}

export class HealthSuccessResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: HealthDataResponseDto })
  data!: HealthDataResponseDto;
}
