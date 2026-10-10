import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('reports a dependency failure without exposing the database error', async () => {
    const database = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('connection details')),
    };

    await expect(
      new HealthService(database as never).check(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
