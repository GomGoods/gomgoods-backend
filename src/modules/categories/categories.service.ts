import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { CategoryStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { categorySelect } from './category.select.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.category.findMany({
      where: { status: CategoryStatus.ACTIVE, parentId: null },
      orderBy: { name: 'asc' },
      select: categorySelect,
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, status: CategoryStatus.ACTIVE },
      select: categorySelect,
    });
    if (!category) {
      throw new ApiException(
        'RESOURCE_NOT_FOUND',
        'Category not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return category;
  }
}
