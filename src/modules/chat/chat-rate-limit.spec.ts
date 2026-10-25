import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatRateLimit } from './chat-rate-limit.js';

afterEach(() => vi.useRealTimers());
describe('ChatRateLimit single-instance budgets', () => {
  it('enforces burst and rolling minute limits across callers, and expires old entries', () => {
    vi.useFakeTimers();
    const limits = new ChatRateLimit();
    for (let group = 0; group < 6; group++) {
      for (let i = 0; i < 5; i++) limits.consume('user', 'message');
      expect(() => limits.consume('user', 'message')).toThrowError(
        expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
      );
      vi.advanceTimersByTime(1001);
    }
    expect(() => limits.consume('user', 'message')).toThrow();
    limits.consume('other-user', 'message');
    vi.advanceTimersByTime(60_000);
    expect(() => limits.consume('user', 'message')).not.toThrow();
  });

  it('bounds conversation attempts and command/connection floods independently', () => {
    const limits = new ChatRateLimit();
    for (const [kind, count] of [
      ['conversation', 10],
      ['event', 120],
      ['connect', 20],
    ] as const) {
      for (let i = 0; i < count; i++) limits.consume('user', kind);
      expect(() => limits.consume('user', kind)).toThrowError(
        expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
      );
    }
  });
});
