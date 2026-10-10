import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AccountType } from '../../generated/prisma/enums.js';

export interface AccessTokenPayload {
  sub: string;
  accountType: AccountType;
}

@Injectable()
export class AccessTokenService {
  static readonly expiresInSeconds = 15 * 60;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async sign(payload: AccessTokenPayload) {
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: AccessTokenService.expiresInSeconds,
      issuer: this.config.getOrThrow<string>('JWT_ISSUER'),
      audience: this.config.getOrThrow<string>('JWT_AUDIENCE'),
    });
    return {
      accessToken,
      expiresIn: AccessTokenService.expiresInSeconds,
    };
  }

  verify(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      issuer: this.config.getOrThrow<string>('JWT_ISSUER'),
      audience: this.config.getOrThrow<string>('JWT_AUDIENCE'),
    });
  }
}
