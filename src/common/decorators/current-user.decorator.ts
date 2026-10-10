import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { SafeUser } from '../../modules/users/user.select.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SafeUser =>
    context.switchToHttp().getRequest<{ user: SafeUser }>().user,
);
