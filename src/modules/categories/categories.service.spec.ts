import { describe, expect, it, vi } from 'vitest';

import { CategoryStatus } from '../../generated/prisma/enums.js';
import { categorySelect } from './category.select.js';
import { CategoriesService } from './categories.service.js';

describe('CategoriesService', () => {
  it('returns active root categories and selects active children only', async () => {
    const prisma = {
      category: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new CategoriesService(prisma as never);

    await expect(service.findAll()).resolves.toEqual([]);
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { status: CategoryStatus.ACTIVE, parentId: null },
      orderBy: { name: 'asc' },
      select: categorySelect,
    });
    expect(categorySelect.children).toMatchObject({
      where: { status: CategoryStatus.ACTIVE },
      orderBy: { name: 'asc' },
    });
  });
});
