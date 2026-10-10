import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AccessTokenGuard } from './access-token.guard.js';

function protectedContext(token?: string): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AccessTokenGuard', () => {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(false),
  } as unknown as Reflector;

  it('distinguishes an expired token from another invalid token', async () => {
    const tokens = {
      verify: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('expired'), { name: 'TokenExpiredError' }),
        ),
    };
    const guard = new AccessTokenGuard(reflector, tokens as never, {} as never);

    await expect(
      guard.canActivate(protectedContext('expired')),
    ).rejects.toMatchObject({
      code: 'ACCESS_TOKEN_EXPIRED',
      status: 401,
    });
  });

  it('requires a Bearer token on a protected route', async () => {
    const guard = new AccessTokenGuard(reflector, {} as never, {} as never);

    await expect(guard.canActivate(protectedContext())).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      status: 401,
    });
  });
});
