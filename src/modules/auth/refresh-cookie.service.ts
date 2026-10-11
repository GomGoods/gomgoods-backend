import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';

import type { CookieSameSite } from '../../config/environment.js';

const refreshCookieName = 'gomgoods_refresh';

@Injectable()
export class RefreshCookieService {
  constructor(private readonly config: ConfigService) {}

  read(request: Request): string | undefined {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return undefined;
    for (const item of cookieHeader.split(';')) {
      const separator = item.indexOf('=');
      if (separator < 0) continue;
      const name = item.slice(0, separator).trim();
      if (name !== refreshCookieName) continue;
      try {
        return decodeURIComponent(item.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  set(response: Response, rawToken: string, expiresAt: Date): void {
    response.cookie(refreshCookieName, rawToken, {
      ...this.options(),
      expires: expiresAt,
      maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    });
  }

  clear(response: Response): void {
    response.clearCookie(refreshCookieName, this.options());
  }

  private options(): CookieOptions {
    const domain = this.config.get<string>('AUTH_COOKIE_DOMAIN');
    return {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('AUTH_COOKIE_SECURE'),
      sameSite:
        this.config.getOrThrow<CookieSameSite>('AUTH_COOKIE_SAME_SITE'),
      path: '/api/auth',
      ...(domain ? { domain } : {}),
    };
  }
}
