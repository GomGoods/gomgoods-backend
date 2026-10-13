import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator.js';
import { ApiErrorResponseDto } from '../../common/dto/api-response.dto.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import { CategoriesService } from './categories.service.js';

@Public()
@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Return active categories' })
  @ApiOkResponse()
  findAll() {
    return this.categories.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Return an active category' })
  @ApiOkResponse()
  @ApiResponse({ status: 404, type: ApiErrorResponseDto })
  findOne(@Param() params: UuidParamDto) {
    return this.categories.findOne(params.id);
  }
}
