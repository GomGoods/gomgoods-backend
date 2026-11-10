import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';

export type ForumMutation = 'post' | 'edit' | 'comment' | 'like' | 'report' | 'moderation';
@Injectable()
export class ForumRateLimit {
  private readonly windows = new Map<string, number[]>();
  // Same single-instance boundary as Chat; the global HTTP guard also limits IPs.
  consume(userId: string, action: ForumMutation) {
    const now = Date.now();
    for (const [key, values] of this.windows) if (!values.length || values.at(-1)! <= now - 60000) this.windows.delete(key);
    const key = `${action}:${userId}`;
    const recent = (this.windows.get(key) || []).filter(time => time > now - 60000);
    const limit = { post: 5, edit: 30, comment: 30, like: 120, report: 10, moderation: 60 }[action];
    if (recent.length >= limit) throw new ApiException('RATE_LIMIT_EXCEEDED', 'Forum rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now); this.windows.set(key, recent);
  }
}
