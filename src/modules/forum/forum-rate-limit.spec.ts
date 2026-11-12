import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ForumRateLimit, ForumRateLimitError, forumLimits } from './forum-rate-limit.js';

describe('Forum shared write protection failure boundary', () => {
  it('fails closed with sanitized 503 for every write operation when storage rejects', async () => {
    const storage = { $transaction: vi.fn().mockRejectedValue(new Error('sensitive storage diagnostics')) };
    const module = await Test.createTestingModule({ providers: [ForumRateLimit, { provide: PrismaService, useValue: storage }] }).compile();
    try {
      for (const operation of Object.keys(forumLimits) as (keyof typeof forumLimits)[]) {
        await expect(module.get(ForumRateLimit).consume('00000000-0000-4000-8000-000000000001', operation)).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE', details: [], message: 'Forum write protection is temporarily unavailable' });
      }
    } finally { await module.close(); }
  });
  it('retains a storage-derived retry hint for rejected admission instead of falling back to local credit', async () => {
    const storage = { $transaction: vi.fn().mockResolvedValue(42) };
    const module = await Test.createTestingModule({ providers: [ForumRateLimit, { provide: PrismaService, useValue: storage }] }).compile();
    try {
      const action = module.get(ForumRateLimit).consume('00000000-0000-4000-8000-000000000001', 'report');
      await expect(action).rejects.toBeInstanceOf(ForumRateLimitError);
      await expect(action).rejects.toMatchObject({ status: 429, details: [{ retryAfterSeconds: 42 }] });
    } finally { await module.close(); }
  });
});
