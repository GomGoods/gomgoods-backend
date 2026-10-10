import { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';

import { UsersService } from './users.service.js';

describe('UsersService', () => {
  it('preserves the email conflict code when the database wins a registration race', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '7.10.0',
            meta: { target: ['email'] },
          }),
        ),
      },
    };
    const service = new UsersService(prisma as never);

    await expect(
      service.create({
        email: 'user@gomgoods.local',
        username: 'gom_user',
        passwordHash: '$argon2id$hash',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS', status: 409 });
  });
});
