import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AuthRequestGuard } from './auth-request.guard.js';

function context(origin?: string, csrf?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          ...(origin ? { origin } : {}),
          ...(csrf ? { 'x-gomgoods-csrf': csrf } : {}),
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuthRequestGuard', () => {
  const guard = new AuthRequestGuard({
    getOrThrow: vi.fn().mockReturnValue(['http://localhost:3001']),
  } as never);

  it('accepts the exact configured origin and CSRF header', () => {
    expect(guard.canActivate(context('http://localhost:3001', '1'))).toBe(
      true,
    );
  });

  it('rejects missing, null, or untrusted origins', () => {
    expect(() => guard.canActivate(context(undefined, '1'))).toThrow();
    expect(() => guard.canActivate(context('null', '1'))).toThrow();
    expect(() =>
      guard.canActivate(context('https://attacker.example', '1')),
    ).toThrow();
  });

  it('rejects a request without the CSRF header', () => {
    expect(() =>
      guard.canActivate(context('http://localhost:3001')),
    ).toThrow();
  });
});
