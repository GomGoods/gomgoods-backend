import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UserStatus } from '../../generated/prisma/enums.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  safeUserSelect,
  type SafeUser,
} from '../users/user.select.js';
import { RefreshCredentialCodec } from './refresh-credential.codec.js';

type SessionDatabase = Pick<
  Prisma.TransactionClient,
  'authSession' | 'refreshCredential'
>;

export interface SessionGrant {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

const revocationReason = {
  accountSuspended: 'ACCOUNT_SUSPENDED',
  accountDeleted: 'ACCOUNT_DELETED',
  logout: 'LOGOUT',
  logoutAll: 'LOGOUT_ALL',
  replayDetected: 'REPLAY_DETECTED',
} as const;

export type RefreshRotationResult =
  | {
      kind: 'ROTATED';
      user: SafeUser;
      grant: SessionGrant;
    }
  | { kind: 'CONCURRENT_ROTATION' }
  | { kind: 'REPLAY_REVOKED' }
  | { kind: 'ACCOUNT_SUSPENDED' }
  | { kind: 'ACCOUNT_DELETED' }
  | { kind: 'INVALID' };

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly codec: RefreshCredentialCodec,
  ) {}

  async start(
    userId: string,
    database?: SessionDatabase,
  ): Promise<SessionGrant> {
    if (database) return this.createSession(database, userId);
    return this.prisma.$transaction((transaction) =>
      this.createSession(transaction, userId),
    );
  }

  async rotate(rawToken: string | undefined): Promise<RefreshRotationResult> {
    if (!rawToken) return { kind: 'INVALID' };
    const presented = this.codec.parse(rawToken);
    if (!presented) return { kind: 'INVALID' };

    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const credential = await this.findCredential(
        transaction,
        presented.sessionId,
        presented.generation,
      );
      if (
        !credential ||
        !this.codec.hashesMatch(credential.tokenHash, presented.tokenHash)
      ) {
        return { kind: 'INVALID' } as const;
      }

      const { session } = credential;
      if (session.user.status !== UserStatus.ACTIVE) {
        const reason =
          session.user.status === UserStatus.SUSPENDED
            ? revocationReason.accountSuspended
            : revocationReason.accountDeleted;
        await transaction.authSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: now, revocationReason: reason },
        });
        return { kind: reason } as const;
      }

      if (session.revokedAt || session.expiresAt <= now) {
        return { kind: 'INVALID' } as const;
      }

      if (
        presented.generation !== session.currentGeneration ||
        credential.usedAt
      ) {
        return this.classifyUsedCredential(
          transaction,
          session.id,
          credential.usedAt,
          now,
        );
      }

      const successor = this.codec.issue(
        session.id,
        presented.generation + 1,
      );
      const advanced = await transaction.authSession.updateMany({
        where: {
          id: session.id,
          currentGeneration: presented.generation,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          currentGeneration: { increment: 1 },
          lastUsedAt: now,
        },
      });

      if (advanced.count !== 1) {
        const current = await transaction.refreshCredential.findUnique({
          where: {
            sessionId_generation: {
              sessionId: session.id,
              generation: presented.generation,
            },
          },
          select: { usedAt: true },
        });
        return this.classifyUsedCredential(
          transaction,
          session.id,
          current?.usedAt ?? null,
          now,
        );
      }

      const consumed = await transaction.refreshCredential.updateMany({
        where: {
          sessionId: session.id,
          generation: presented.generation,
          usedAt: null,
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new Error('Refresh credential rotation lost its atomic update');
      }
      await transaction.refreshCredential.create({
        data: {
          sessionId: successor.sessionId,
          generation: successor.generation,
          tokenHash: successor.tokenHash,
        },
      });

      return {
        kind: 'ROTATED',
        user: session.user,
        grant: {
          sessionId: session.id,
          refreshToken: successor.rawToken,
          expiresAt: session.expiresAt,
        },
      } as const;
    });
  }

  async revokeCurrent(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const presented = this.codec.parse(rawToken);
    if (!presented) return;

    await this.prisma.$transaction(async (transaction) => {
      const credential = await transaction.refreshCredential.findUnique({
        where: {
          sessionId_generation: {
            sessionId: presented.sessionId,
            generation: presented.generation,
          },
        },
        select: { tokenHash: true },
      });
      if (
        !credential ||
        !this.codec.hashesMatch(credential.tokenHash, presented.tokenHash)
      ) {
        return;
      }
      await transaction.authSession.updateMany({
        where: { id: presented.sessionId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revocationReason: revocationReason.logout,
        },
      });
    });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revocationReason: revocationReason.logoutAll,
      },
    });
  }

  private async createSession(
    database: SessionDatabase,
    userId: string,
  ): Promise<SessionGrant> {
    const issued = this.codec.issue();
    const expiresAt = new Date(
      Date.now() +
        this.config.getOrThrow<number>('AUTH_REFRESH_TTL_DAYS') *
          24 *
          60 *
          60 *
          1000,
    );
    await database.authSession.create({
      data: {
        id: issued.sessionId,
        userId,
        expiresAt,
        credentials: {
          create: {
            generation: issued.generation,
            tokenHash: issued.tokenHash,
          },
        },
      },
    });
    return {
      sessionId: issued.sessionId,
      refreshToken: issued.rawToken,
      expiresAt,
    };
  }

  private findCredential(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    generation: number,
  ) {
    return transaction.refreshCredential.findUnique({
      where: { sessionId_generation: { sessionId, generation } },
      select: {
        tokenHash: true,
        usedAt: true,
        session: {
          select: {
            id: true,
            userId: true,
            currentGeneration: true,
            expiresAt: true,
            revokedAt: true,
            user: { select: safeUserSelect },
          },
        },
      },
    });
  }

  private async classifyUsedCredential(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    usedAt: Date | null,
    now: Date,
  ): Promise<RefreshRotationResult> {
    if (!usedAt) return { kind: 'INVALID' };
    const graceMilliseconds =
      this.config.getOrThrow<number>('AUTH_REFRESH_GRACE_SECONDS') * 1000;
    if (now.getTime() - usedAt.getTime() <= graceMilliseconds) {
      return { kind: 'CONCURRENT_ROTATION' };
    }
    await transaction.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: {
        revokedAt: now,
        revocationReason: revocationReason.replayDetected,
      },
    });
    return { kind: 'REPLAY_REVOKED' };
  }
}
