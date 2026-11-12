import { Injectable, HttpStatus } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';

@Injectable()
export class ChatRateLimit {
  private readonly windows = new Map<string, number[]>();
  // Single-instance sliding windows shared by REST and WS, across sessions.
  consume(
    userId: string,
    kind: 'message' | 'conversation' | 'event' | 'connect',
  ) {
    const now = Date.now();
    for (const [key, values] of this.windows) {
      if (!values.length || values[values.length - 1] <= now - 60_000)
        this.windows.delete(key);
    }
    const key = `${kind}:${userId}`;
    const recent = (this.windows.get(key) ?? []).filter(
      (t) => t > now - 60_000,
    );
    const limit =
      kind === 'message'
        ? 30
        : kind === 'conversation'
          ? 10
          : kind === 'connect'
            ? 20
            : 120;
    if (
      recent.length >= limit ||
      (kind === 'message' && recent.filter((t) => t > now - 1000).length >= 5)
    ) {
      throw new ApiException(
        'RATE_LIMIT_EXCEEDED',
        'Chat rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.windows.set(key, recent);
  }
}
