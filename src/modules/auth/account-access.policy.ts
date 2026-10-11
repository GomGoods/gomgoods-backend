import { HttpStatus } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { UserStatus } from '../../generated/prisma/enums.js';

export function assertAccountActive(status: UserStatus): void {
  if (status === UserStatus.SUSPENDED) {
    throw new ApiException(
      'ACCOUNT_SUSPENDED',
      'This account is suspended',
      HttpStatus.FORBIDDEN,
    );
  }
  if (status === UserStatus.DELETED) {
    throw new ApiException(
      'ACCOUNT_DELETED',
      'This account is unavailable',
      HttpStatus.FORBIDDEN,
    );
  }
}
