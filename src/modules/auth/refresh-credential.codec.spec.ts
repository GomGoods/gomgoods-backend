import { describe, expect, it } from 'vitest';

import { RefreshCredentialCodec } from './refresh-credential.codec.js';

describe('RefreshCredentialCodec', () => {
  const codec = new RefreshCredentialCodec();

  it('issues an opaque credential and parses only its non-secret identity', () => {
    const issued = codec.issue('00000000-0000-4000-8000-000000000001', 7);
    const parsed = codec.parse(issued.rawToken);

    expect(parsed).toEqual({
      sessionId: issued.sessionId,
      generation: 7,
      tokenHash: issued.tokenHash,
    });
    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.rawToken).not.toContain(issued.tokenHash);
  });

  it('rejects malformed and oversized credentials', () => {
    expect(codec.parse('not-a-refresh-token')).toBeNull();
    expect(codec.parse('x'.repeat(201))).toBeNull();
  });

  it('compares only correctly formed hashes', () => {
    const issued = codec.issue();
    expect(codec.hashesMatch(issued.tokenHash, issued.tokenHash)).toBe(true);
    expect(codec.hashesMatch(issued.tokenHash, '00'.repeat(32))).toBe(false);
    expect(codec.hashesMatch(issued.tokenHash, 'invalid')).toBe(false);
  });
});
