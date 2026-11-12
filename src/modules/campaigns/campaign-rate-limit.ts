import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const budgets = { participation: 30, submission: 10, admin: 30, featured: 10 } as const;
export class CampaignRateLimitError extends ApiException {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMIT_EXCEEDED', 'Campaign write limit exceeded', HttpStatus.TOO_MANY_REQUESTS, [{ retryAfterSeconds }]);
  }
}
@Injectable()
export class CampaignRateLimit {
  constructor(private readonly prisma: PrismaService) {}
  async consume(userId: string, operation: keyof typeof budgets) {
    try {
      const retry = await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
        await tx.$executeRaw`WITH expired AS (SELECT user_id,operation FROM "CAMPAIGN_RATE_LIMIT" WHERE expires_at<=statement_timestamp() ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED) DELETE FROM "CAMPAIGN_RATE_LIMIT" r USING expired e WHERE r.user_id=e.user_id AND r.operation=e.operation`;
        const rows = await tx.$queryRaw<{ admitted: boolean }[]>`
          INSERT INTO "CAMPAIGN_RATE_LIMIT" (user_id,operation,request_count,expires_at)
          VALUES (${userId}::uuid,${operation},1,statement_timestamp()+interval '60 seconds')
          ON CONFLICT (user_id,operation) DO UPDATE SET
          request_count=CASE WHEN "CAMPAIGN_RATE_LIMIT".expires_at<=statement_timestamp() THEN 1 ELSE "CAMPAIGN_RATE_LIMIT".request_count+1 END,
          expires_at=CASE WHEN "CAMPAIGN_RATE_LIMIT".expires_at<=statement_timestamp() THEN statement_timestamp()+interval '60 seconds' ELSE "CAMPAIGN_RATE_LIMIT".expires_at END
          WHERE "CAMPAIGN_RATE_LIMIT".expires_at<=statement_timestamp() OR "CAMPAIGN_RATE_LIMIT".request_count<${budgets[operation]}
          RETURNING true AS admitted`;
        if (rows.length) return 0;
        const remaining = await tx.$queryRaw<{ seconds: number }[]>`SELECT GREATEST(1,ceil(extract(epoch FROM (expires_at-statement_timestamp()))))::int AS seconds FROM "CAMPAIGN_RATE_LIMIT" WHERE user_id=${userId}::uuid AND operation=${operation}`;
        return remaining[0]?.seconds ?? 1;
      }, { maxWait: 1000, timeout: 2500 });
      if (retry) throw new CampaignRateLimitError(retry);
    } catch (error) {
      if (error instanceof CampaignRateLimitError) throw error;
      throw new ApiException('SERVICE_UNAVAILABLE', 'Campaign write protection unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
