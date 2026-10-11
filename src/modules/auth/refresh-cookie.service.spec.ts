import { describe, expect, it, vi } from 'vitest';

import { RefreshCookieService } from './refresh-cookie.service.js';

describe('RefreshCookieService', () => {
  it('uses the configured production cookie topology without exposing the token', () => {
    const config = {
      get: vi.fn((key: string) =>
        key === 'AUTH_COOKIE_DOMAIN' ? 'api.gomgoods.example' : undefined,
      ),
      getOrThrow: vi.fn((key: string) =>
        key === 'AUTH_COOKIE_SECURE' ? true : 'none',
      ),
    };
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    const service = new RefreshCookieService(config as never);
    const expiry = new Date(Date.now() + 60_000);

    service.set(response as never, 'raw-secret', expiry);

    expect(response.cookie).toHaveBeenCalledWith(
      'gomgoods_refresh',
      'raw-secret',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/api/auth',
        domain: 'api.gomgoods.example',
        expires: expiry,
      }),
    );
  });

  it('clears with the same security and scope options', () => {
    const config = {
      get: vi.fn().mockReturnValue(undefined),
      getOrThrow: vi.fn((key: string) =>
        key === 'AUTH_COOKIE_SECURE' ? false : 'lax',
      ),
    };
    const response = { cookie: vi.fn(), clearCookie: vi.fn() };
    const service = new RefreshCookieService(config as never);

    service.clear(response as never);

    expect(response.clearCookie).toHaveBeenCalledWith('gomgoods_refresh', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/auth',
    });
  });
});
