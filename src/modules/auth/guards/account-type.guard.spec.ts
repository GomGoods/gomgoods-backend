import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AccountType, UserStatus } from '../../../generated/prisma/enums.js';
import { AccountTypeGuard } from './account-type.guard.js';

function contextFor(accountType: AccountType): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          accountType,
          status: UserStatus.ACTIVE,
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AccountTypeGuard', () => {
  it('allows an administrator through an admin-only seam', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue([AccountType.ADMIN]),
    } as unknown as Reflector;

    expect(
      new AccountTypeGuard(reflector).canActivate(
        contextFor(AccountType.ADMIN),
      ),
    ).toBe(true);
  });

  it('rejects a regular user at an admin-only seam', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue([AccountType.ADMIN]),
    } as unknown as Reflector;

    expect(() =>
      new AccountTypeGuard(reflector).canActivate(contextFor(AccountType.USER)),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});
