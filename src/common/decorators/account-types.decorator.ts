import { SetMetadata } from '@nestjs/common';

import type { AccountType } from '../../generated/prisma/enums.js';

export const ACCOUNT_TYPES_KEY = 'accountTypes';
export const AccountTypes = (...accountTypes: AccountType[]) =>
  SetMetadata(ACCOUNT_TYPES_KEY, accountTypes);
