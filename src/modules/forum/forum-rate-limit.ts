import { HttpStatus, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export const forumLimits = {
  post: { limit: 3, seconds: 60 }, edit: { limit: 10, seconds: 60 }, delete: { limit: 5, seconds: 60 },
  comment: { limit: 10, seconds: 60 }, 'comment-edit': { limit: 10, seconds: 60 }, 'comment-delete': { limit: 10, seconds: 60 },
  like: { limit: 30, seconds: 60 }, report: { limit: 3, seconds: 600 }, moderation: { limit: 30, seconds: 60 },
} as const;
export type ForumMutation = keyof typeof forumLimits;
export class ForumRateLimitError extends ApiException {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMIT_EXCEEDED', 'Forum rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS, [{ retryAfterSeconds }]);
  }
}

@Injectable()
export class ForumRateLimit implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private readonly logger = new Logger(ForumRateLimit.name);
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      if (this.sweeping) return;
      this.sweeping = true;
      void this.pruneExpired().catch(() => this.logger.warn('Forum limiter expiry cleanup unavailable')).finally(() => { this.sweeping = false; });
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async consume(userId: string, operation: ForumMutation): Promise<void> {
    const { limit, seconds } = forumLimits[operation];
    try {
      // A separate committed budget transaction counts failed/rolled-back domain
      // operations too. The unique key makes admission atomic across instances.
      const admitted = await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
        const rows = await tx.$queryRaw<{ admitted: boolean }[]>`
          INSERT INTO "FORUM_RATE_LIMIT" (user_id,operation,request_count,window_started_at,expires_at)
          VALUES (${userId}::uuid,${operation},1,statement_timestamp(),statement_timestamp()+${seconds}*interval '1 second')
          ON CONFLICT (user_id,operation) DO UPDATE SET
            request_count=CASE WHEN "FORUM_RATE_LIMIT".expires_at<=statement_timestamp() THEN 1 ELSE "FORUM_RATE_LIMIT".request_count+1 END,
            window_started_at=CASE WHEN "FORUM_RATE_LIMIT".expires_at<=statement_timestamp() THEN statement_timestamp() ELSE "FORUM_RATE_LIMIT".window_started_at END,
            expires_at=CASE WHEN "FORUM_RATE_LIMIT".expires_at<=statement_timestamp() THEN statement_timestamp()+${seconds}*interval '1 second' ELSE "FORUM_RATE_LIMIT".expires_at END
          WHERE "FORUM_RATE_LIMIT".expires_at<=statement_timestamp() OR "FORUM_RATE_LIMIT".request_count<${limit}
          RETURNING true AS admitted`;
        if (rows.length) return 0;
        const retry = await tx.$queryRaw<{ seconds: number }[]>`SELECT GREATEST(1,ceil(extract(epoch FROM (expires_at-statement_timestamp()))))::int AS seconds FROM "FORUM_RATE_LIMIT" WHERE user_id=${userId}::uuid AND operation=${operation}`;
        return retry[0]?.seconds ?? 1;
      }, { maxWait: 1000, timeout: 2500 });
      if (admitted) throw new ForumRateLimitError(admitted);
    } catch (error) {
      if (error instanceof ForumRateLimitError) throw error;
      // Fail closed for Forum writes only; never fall back to per-process credit
      // or expose SQL, parameters, connection strings or driver errors.
      throw new ApiException('SERVICE_UNAVAILABLE', 'Forum write protection is temporarily unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
  async pruneExpired(): Promise<number> {
    // Bounded batches and SKIP LOCKED permit multiple sweepers without blocking
    // admission on live keys. Normally rows live <=10 minutes + sweep interval.
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
      return tx.$executeRaw`
      WITH expired AS (
        SELECT user_id,operation FROM "FORUM_RATE_LIMIT" WHERE expires_at<=statement_timestamp()
        ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
      ) DELETE FROM "FORUM_RATE_LIMIT" r USING expired e WHERE r.user_id=e.user_id AND r.operation=e.operation`;
    }, { maxWait: 1000, timeout: 2500 });
  }
}
