import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ApiResponseInterceptor } from './api-response.interceptor.js';

describe('ApiResponseInterceptor', () => {
  it('wraps controller data in the approved success envelope', async () => {
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getResponse: () => ({ statusCode: 200 }) }),
    } as ExecutionContext;
    const next = { handle: () => of({ status: 'ok' }) } as CallHandler;

    await expect(
      firstValueFrom(new ApiResponseInterceptor().intercept(context, next)),
    ).resolves.toEqual({ success: true, data: { status: 'ok' } });
  });
});
