import { Prisma } from '../../generated/prisma/client.js';
import { StoreStatus } from '../../generated/prisma/enums.js';
import { describe, expect, it, vi } from 'vitest';

import { StoresService } from './stores.service.js';

const safeUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@gomgoods.local',
  username: 'owner',
  accountType: 'USER',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  store: null,
} as const;

describe('StoresService', () => {
  it('maps duplicate store ownership to STORE_ALREADY_EXISTS', async () => {
    const prisma = {
      store: {
        create: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '7.10.0',
          }),
        ),
      },
    };
    const service = new StoresService(prisma as never);

    await expect(
      service.create(safeUser, { name: 'Phase 3 Store' }),
    ).rejects.toMatchObject({ code: 'STORE_ALREADY_EXISTS', status: 409 });
  });

  it('keeps closed stores terminal for Phase 3 moderation', async () => {
    const prisma = {
      store: {
        findUnique: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000020',
          status: StoreStatus.CLOSED,
        }),
        update: vi.fn(),
      },
    };
    const service = new StoresService(prisma as never);

    await expect(
      service.updateStatus('00000000-0000-4000-8000-000000000020', {
        status: StoreStatus.ACTIVE,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_STORE_STATUS_TRANSITION',
      status: 409,
    });
    expect(prisma.store.update).not.toHaveBeenCalled();
  });

  it('only returns active stores through the public lookup', async () => {
    const prisma = {
      store: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new StoresService(prisma as never);

    await expect(
      service.findPublic('00000000-0000-4000-8000-000000000020'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(prisma.store.findFirst).toHaveBeenCalledWith({
      where: {
        id: '00000000-0000-4000-8000-000000000020',
        status: StoreStatus.ACTIVE,
      },
      select: expect.any(Object),
    });
  });
});
