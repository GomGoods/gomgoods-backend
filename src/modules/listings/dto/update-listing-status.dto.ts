import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { ListingStatus } from '../../../generated/prisma/enums.js';

export class UpdateListingStatusDto {
  @ApiProperty({
    enum: [ListingStatus.ACTIVE, ListingStatus.INACTIVE, ListingStatus.REMOVED],
  })
  @IsIn([ListingStatus.ACTIVE, ListingStatus.INACTIVE, ListingStatus.REMOVED])
  status!: ListingStatus;
}
