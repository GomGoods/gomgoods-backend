import { describe, expect, it, vi } from 'vitest';
import { decodeForumCursor, encodeForumCursor, isForumText } from './forum-policy.js';

describe('Forum plain-text and cursor boundary', () => {
  it('preserves Vietnamese, decomposed marks, emoji and CRLF without normalization', () => {
    for (const text of ['  Cảm ơn 👩🏽‍💻 🇻🇳\r\nDòng hai  ', 'e\u0301', '<script>alert(1)</script>']) {
      expect(isForumText(text, 10000)).toBe(true);
    }
    expect(isForumText('😀'.repeat(250), 250)).toBe(true);
    expect(isForumText('😀'.repeat(251), 250)).toBe(false);
    for (const text of ['', ' \n\t', '\u0000', '\ud800', '\udfff']) expect(isForumText(text, 10000)).toBe(false);
  });

  it('binds a cursor to its query, preserves its cutoff and rejects malformed values', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-04T12:00:00.000Z'));
    const point = { id: '00000000-0000-4000-8000-000000000001', createdAt: '2026-11-04T10:00:00.000Z', asOf: '2026-11-04T11:00:00.000Z', score: 3, watermark: '12' };
    const cursor = encodeForumCursor('feed:popular:anime', point);
    expect(decodeForumCursor('feed:popular:anime', cursor)).toEqual(point);
    expect(() => decodeForumCursor('feed:popular:game', cursor)).toThrow();
    for (const value of ['{}', 'not-json', 'x'.repeat(1500), Buffer.from(JSON.stringify({ ...point, score: -1 })).toString('base64url')]) expect(() => decodeForumCursor('feed:popular:anime', value)).toThrow();
    vi.restoreAllMocks();
  });
});
