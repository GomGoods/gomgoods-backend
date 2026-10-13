import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator.js';
import { ApiErrorResponseDto } from '../../common/dto/api-response.dto.js';
import { DiscoveryService } from './discovery.service.js';
import { DiscoveryListingQueryDto } from './dto/discovery-listing-query.dto.js';

@ApiTags('Discovery')
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Get('listings')
  @ApiOperation({ summary: 'Return active listing discovery feed' })
  @ApiOkResponse()
  @ApiResponse({ status: 422, type: ApiErrorResponseDto })
  findListings(@Query() query: DiscoveryListingQueryDto) {
    return this.discovery.findListings(query);
  }
}
