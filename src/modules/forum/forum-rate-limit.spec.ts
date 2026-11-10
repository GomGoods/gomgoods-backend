import { describe, expect, it, vi } from 'vitest';
import { ForumRateLimit } from './forum-rate-limit.js';

describe('Forum per-user spam budget', () => {
  it('shares budgets across sessions, separates actors and expires the window', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100000);
    const limits = new ForumRateLimit();
    for (let i = 0; i < 5; i++) limits.consume('a', 'post');
    expect(() => limits.consume('a', 'post')).toThrow('Forum rate limit');
    expect(() => limits.consume('b', 'post')).not.toThrow();
    clock.mockReturnValue(160001);
    expect(() => limits.consume('a', 'post')).not.toThrow();
    clock.mockRestore();
  });
});
