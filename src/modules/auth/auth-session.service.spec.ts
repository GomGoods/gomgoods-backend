import { AccountType, UserStatus } from '../../generated/prisma/enums.js';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from './auth-session.service.js';

const safeUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'user@gomgoods.local',
  username: 'gom_user',
  accountType: AccountType.USER,
  status: UserStatus.ACTIVE,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  store: null,
};

function createService(credential: Record<string, unknown>) {
  const transaction = {
    refreshCredential: {
      findUnique: vi.fn().mockResolvedValue(credential),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    authSession: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
    authSession: transaction.authSession,
  };
  const config = {
    getOrThrow: vi.fn((key: string) =>
      key === 'AUTH_REFRESH_GRACE_SECONDS' ? 10 : 30,
    ),
  };
  const codec = {
    parse: vi.fn().mockReturnValue({
      sessionId: '00000000-0000-4000-8000-000000000099',
      generation: 0,
      tokenHash: 'aa'.repeat(32),
    }),
    hashesMatch: vi.fn().mockReturnValue(true),
    issue: vi.fn(),
  };
  return {
    service: new AuthSessionService(
      prisma as never,
      config as never,
      codec as never,
    ),
    transaction,
  };
}

describe('AuthSessionService', () => {
  it('commits account-status revocation as an outcome instead of throwing inside the transaction', async () => {
    const { service, transaction } = createService({
      tokenHash: 'aa'.repeat(32),
      usedAt: null,
      session: {
        id: '00000000-0000-4000-8000-000000000099',
        userId: safeUser.id,
        currentGeneration: 0,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: { ...safeUser, status: UserStatus.SUSPENDED },
      },
    });

    await expect(service.rotate('opaque')).resolves.toEqual({
      kind: 'ACCOUNT_SUSPENDED',
    });
    expect(transaction.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revocationReason: 'ACCOUNT_SUSPENDED',
        }),
      }),
    );
  });

  it('commits confirmed replay revocation as an outcome', async () => {
    const { service, transaction } = createService({
      tokenHash: 'aa'.repeat(32),
      usedAt: new Date(Date.now() - 11_000),
      session: {
        id: '00000000-0000-4000-8000-000000000099',
        userId: safeUser.id,
        currentGeneration: 1,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        user: safeUser,
      },
    });

    await expect(service.rotate('opaque')).resolves.toEqual({
      kind: 'REPLAY_REVOKED',
    });
    expect(transaction.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revocationReason: 'REPLAY_DETECTED' }),
      }),
    );
  });
});
