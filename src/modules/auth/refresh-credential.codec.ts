import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

export interface RefreshCredentialParts {
  sessionId: string;
  generation: number;
  tokenHash: string;
}

export interface IssuedRefreshCredential extends RefreshCredentialParts {
  rawToken: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

export class RefreshCredentialCodec {
  issue(
    sessionId: string = randomUUID(),
    generation = 0,
  ): IssuedRefreshCredential {
    const secret = randomBytes(32).toString('base64url');
    return {
      sessionId,
      generation,
      tokenHash: this.hashSecret(secret),
      rawToken: `${sessionId}.${generation}.${secret}`,
    };
  }

  parse(rawToken: string): RefreshCredentialParts | null {
    if (rawToken.length > 200) return null;
    const parts = rawToken.split('.');
    if (parts.length !== 3) return null;
    const [sessionId, rawGeneration, secret] = parts;
    if (
      !uuidPattern.test(sessionId) ||
      !/^(0|[1-9]\d*)$/.test(rawGeneration) ||
      !secretPattern.test(secret)
    ) {
      return null;
    }
    const generation = Number(rawGeneration);
    if (!Number.isSafeInteger(generation)) return null;
    return {
      sessionId,
      generation,
      tokenHash: this.hashSecret(secret),
    };
  }

  hashesMatch(storedHash: string, presentedHash: string): boolean {
    if (!/^[0-9a-f]{64}$/i.test(storedHash)) return false;
    if (!/^[0-9a-f]{64}$/i.test(presentedHash)) return false;
    return timingSafeEqual(
      Buffer.from(storedHash, 'hex'),
      Buffer.from(presentedHash, 'hex'),
    );
  }

  private hashSecret(secret: string): string {
    return createHash('sha256')
      .update(Buffer.from(secret, 'base64url'))
      .digest('hex');
  }
}
