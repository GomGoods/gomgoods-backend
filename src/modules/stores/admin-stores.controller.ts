import { Body, Controller, Param, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AccountTypes } from '../../common/decorators/account-types.decorator.js';
import { ApiErrorResponseDto } from '../../common/dto/api-response.dto.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import { AccountType } from '../../generated/prisma/enums.js';
import { UpdateStoreStatusDto } from './dto/update-store-status.dto.js';
import { StoresService } from './stores.service.js';

@ApiTags('Admin Stores')
@Controller('admin/stores')
@AccountTypes(AccountType.ADMIN)
export class AdminStoresController {
  constructor(private readonly stores: StoresService) {}

  @Patch(':id/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve, suspend, or close a store' })
  @ApiOkResponse()
  @ApiResponse({ status: 403, type: ApiErrorResponseDto })
  @ApiResponse({ status: 409, type: ApiErrorResponseDto })
  updateStatus(
    @Param() params: UuidParamDto,
    @Body() input: UpdateStoreStatusDto,
  ) {
    return this.stores.updateStatus(params.id, input);
  }
}
