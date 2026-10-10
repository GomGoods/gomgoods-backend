import { hash } from 'argon2';
import { describe, expect, it, vi } from 'vitest';

import { AccountType, UserStatus } from '../../generated/prisma/enums.js';
import { AuthService } from './auth.service.js';

const activeUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'user@gomgoods.local',
  username: 'gom_user',
  passwordHash: '',
  accountType: AccountType.USER,
  status: UserStatus.ACTIVE,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  store: null,
};

function createService() {
  const users = {
    create: vi.fn(),
    findAuthUserByEmail: vi.fn(),
    findSafeById: vi.fn(),
  };
  const tokens = {
    sign: vi.fn().mockResolvedValue({
      accessToken: 'signed-token',
      expiresIn: 900,
    }),
  };

  return {
    service: new AuthService(users as never, tokens as never),
    users,
    tokens,
  };
}

describe('AuthService', () => {
  it('normalizes registration email, hashes the password, and issues a token', async () => {
    const { service, users } = createService();
    users.create.mockImplementation(async (input) => {
      const { passwordHash: _passwordHash, ...safeUser } = activeUser;
      return { ...safeUser, email: input.email, username: input.username };
    });

    const result = await service.register({
      email: ' USER@GOMGOODS.LOCAL ',
      username: 'gom_user',
      password: 'correct-horse-battery',
    });

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@gomgoods.local',
        passwordHash: expect.not.stringContaining('correct-horse-battery'),
      }),
    );
    expect(result).toMatchObject({ accessToken: 'signed-token' });
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('returns one generic authentication failure for an unknown email', async () => {
    const { service, users } = createService();
    users.findAuthUserByEmail.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'missing@gomgoods.local',
        password: 'correct-horse-battery',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
  });

  it('rejects a suspended account after valid password verification', async () => {
    const { service, users } = createService();
    users.findAuthUserByEmail.mockResolvedValue({
      ...activeUser,
      passwordHash: await hash('correct-horse-battery'),
      status: UserStatus.SUSPENDED,
    });

    await expect(
      service.login({
        email: activeUser.email,
        password: 'correct-horse-battery',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED', status: 403 });
  });
});
