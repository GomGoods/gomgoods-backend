import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { StoreStatus } from '../../../generated/prisma/enums.js';

export class UpdateStoreStatusDto {
  @ApiProperty({
    enum: [StoreStatus.ACTIVE, StoreStatus.SUSPENDED, StoreStatus.CLOSED],
  })
  @IsIn([StoreStatus.ACTIVE, StoreStatus.SUSPENDED, StoreStatus.CLOSED])
  status!: StoreStatus;
}
