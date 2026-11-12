import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { assertAccountActive } from '../auth/account-access.policy.js';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class ChatAuthService {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly users: UsersService,
  ) {}

  async authenticate(token: unknown) {
    if (typeof token !== 'string' || token.length > 4096) throw this.invalid();
    let claims;
    try {
      claims = await this.tokens.verify(token);
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError')
        throw new ApiException(
          'ACCESS_TOKEN_EXPIRED',
          'The access token has expired',
          HttpStatus.UNAUTHORIZED,
        );
      throw this.invalid();
    }
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string')
      throw this.invalid();
    const user = await this.users.findSafeByIdForSession(
      claims.sub,
      claims.sid,
    );
    if (!user) throw this.invalid();
    assertAccountActive(user.status);
    return { userId: user.id, sessionId: claims.sid };
  }

  private invalid() {
    return new ApiException(
      'INVALID_ACCESS_TOKEN',
      'The access token is invalid',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
