import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID, ValidateBy } from 'class-validator';
import { ApiException } from '../../common/exceptions/api.exception.js';

export function isForumText(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || !/\S/u.test(value)) return false;
  let count = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point === 0 || (point >= 0xd800 && point <= 0xdfff) || ++count > max) return false;
  }
  return count > 0;
}

export function ForumText(max: number) {
  return ValidateBy({ name: 'forumText', validator: {
    validate: (value: unknown) => isForumText(value, max),
    defaultMessage: () => `must contain 1–${max} Unicode code points with non-whitespace text, no NUL or unpaired surrogates`,
  } });
}

export interface ForumCursor { id: string; createdAt: string; asOf: string; score: number; watermark: string }
const scopeHash = (scope: string) => createHash('sha256').update(scope).digest('hex');
export function encodeForumCursor(scope: string, point: ForumCursor) {
  return Buffer.from(JSON.stringify({ ...point, scope: scopeHash(scope), v: 1 })).toString('base64url');
}
export function decodeForumCursor(scope: string, value: string): ForumCursor {
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const row = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const date = (input: unknown) => typeof input === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input) && new Date(input).toISOString() === input;
    if (!row || row.v !== 1 || row.scope !== scopeHash(scope) || typeof row.id !== 'string' || !isUUID(row.id) ||
      !date(row.createdAt) || !date(row.asOf) || Date.parse(row.asOf) > Date.now() || row.createdAt > row.asOf || !Number.isSafeInteger(row.score) || row.score < 0 ||
      typeof row.watermark !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(row.watermark) || BigInt(row.watermark) > 9223372036854775807n) throw new Error();
    return { id: row.id.toLowerCase(), createdAt: row.createdAt, asOf: row.asOf, score: row.score, watermark: row.watermark };
  } catch {
    throw new ApiException('VALIDATION_FAILED', 'Invalid forum cursor or query scope', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
