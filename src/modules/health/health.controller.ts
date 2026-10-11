import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator.js';
import {
  ApiErrorResponseDto,
  HealthSuccessResponseDto,
} from '../../common/dto/api-response.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Check application and database readiness' })
  @ApiOkResponse({ type: HealthSuccessResponseDto })
  @ApiResponse({ status: 503, type: ApiErrorResponseDto })
  check() {
    return this.health.check();
  }
}
