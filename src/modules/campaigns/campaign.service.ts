import { HttpStatus, Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { ParticipationStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertAccountActive } from '../auth/account-access.policy.js';
import { decodeForumCursor, encodeForumCursor } from '../forum/forum-policy.js';
import type { CampaignEvidenceDto, CampaignFeedDto, CampaignInputDto, CampaignPageDto } from './campaign.dto.js';
import { CampaignRateLimit } from './campaign-rate-limit.js';
import { AccessTokenService } from '../auth/access-token.service.js';

type Tx = Prisma.TransactionClient;
const campaignSelect = { id: true, name: true, description: true, type: true, startsAt: true, endsAt: true, status: true, instructions: true, completionCriteria: true, eligibility: true, minimumAccountAgeDays: true, participationLimit: true, createdAt: true, updatedAt: true, organizer: { select: { id: true, username: true } } } satisfies Prisma.CampaignSelect;
const participantSelect = { id: true, campaignId: true, status: true, joinedAt: true, updatedAt: true, evidenceText: true, evidenceUrl: true, submissionKey: true, submittedAt: true, campaign: { select: campaignSelect } } satisfies Prisma.CampaignParticipantSelect;
type Campaign = Prisma.CampaignGetPayload<{}>;
const presentCampaign = <T extends { name: string }>(row: T) => { const { name, ...rest } = row; return { ...rest, title: name }; };
const presentParticipation = (row: Prisma.CampaignParticipantGetPayload<{ select: typeof participantSelect }>) => ({ ...row, campaign: presentCampaign(row.campaign) });

@Injectable({ scope: Scope.REQUEST })
export class CampaignService {
  constructor(private readonly prisma: PrismaService, private readonly limits: CampaignRateLimit, private readonly tokens: AccessTokenService, @Inject(REQUEST) private readonly request: Request) {}
  private missing() { return new ApiException('RESOURCE_NOT_FOUND', 'Campaign resource not found', HttpStatus.NOT_FOUND); }
  private conflict(message = 'Campaign state does not permit this operation') { return new ApiException('RESOURCE_CONFLICT', message, HttpStatus.CONFLICT); }
  private async actor(tx: Tx, id: string, role?: 'ADMIN' | 'USER', exclusive = false) {
    if (exclusive) await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id=${id}::uuid FOR UPDATE`;
    else await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id=${id}::uuid FOR SHARE`;
    const user = await tx.user.findUnique({ where: { id }, select: { status: true, accountType: true, createdAt: true } });
    if (!user) throw this.missing();
    assertAccountActive(user.status);
    if (role && user.accountType !== role) throw new ApiException('FORBIDDEN', `Requires ${role} account`, HttpStatus.FORBIDDEN);
    return user;
  }
  private async session(tx: Tx, userId: string) {
    try {
      const payload = await this.tokens.verify((this.request.headers.authorization ?? '').slice(7));
      if (payload.sub !== userId || !('exp' in payload) || typeof payload.exp !== 'number') throw new Error();
      const valid = await tx.$queryRaw<{ id: string }[]>`SELECT session_id AS id FROM "AUTH_SESSION" WHERE session_id=${payload.sid}::uuid AND user_id=${userId}::uuid AND revoked_at IS NULL AND expires_at>clock_timestamp() AND ${payload.exp}>extract(epoch FROM clock_timestamp()) FOR SHARE`;
      if (!valid.length) throw new Error();
    } catch { throw new ApiException('INVALID_ACCESS_TOKEN', 'Session or access token is no longer valid', HttpStatus.UNAUTHORIZED); }
  }
  private async now(tx: Tx) { return (await tx.$queryRaw<{ now: Date }[]>`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`)[0].now; }
  private async locked(tx: Tx, id: string, actorId: string) {
    await tx.$queryRaw`SELECT campaign_id FROM "CAMPAIGN" WHERE campaign_id=${id}::uuid FOR UPDATE`;
    const campaign = await tx.campaign.findUnique({ where: { id } });
    if (!campaign || !campaign.organizerId) throw this.missing();
    await this.session(tx, actorId);
    return campaign;
  }
  private live(campaign: Campaign, now: Date) {
    if (campaign.status !== 'ACTIVE' || campaign.startsAt > now || campaign.endsAt <= now) throw this.conflict('Registration and submissions require an active campaign within its deadline');
  }
  private async audit(tx: Tx, campaignId: string, actorId: string, action: string, fromStatus: string | null, toStatus: string, note: string, participantId?: string) {
    return tx.campaignAudit.create({ data: { campaignId, actorId, action, fromStatus, toStatus, note, participantId, createdAt: await this.now(tx) } });
  }
  private fields(input: CampaignInputDto) {
    const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
    if (!Number.isFinite(+startsAt) || !Number.isFinite(+endsAt) || endsAt <= startsAt) throw new ApiException('VALIDATION_FAILED', 'End must follow start', HttpStatus.UNPROCESSABLE_ENTITY);
    return { name: input.title, description: input.description, type: input.type, startsAt, endsAt, instructions: input.instructions, completionCriteria: input.completionCriteria, eligibility: input.eligibility, minimumAccountAgeDays: input.minimumAccountAgeDays, participationLimit: input.participationLimit ?? null };
  }
  async create(actorId: string, input: CampaignInputDto) {
    const fields = this.fields(input); await this.limits.consume(actorId, 'admin');
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actorId, 'ADMIN');
      await this.session(tx, actorId);
      const row = await tx.campaign.create({ data: { ...fields, organizerId: actorId, createdAt: await this.now(tx) }, select: campaignSelect });
      await this.audit(tx, row.id, actorId, 'CREATE', null, 'DRAFT', input.note);
      return presentCampaign(row);
    });
  }
  async edit(actorId: string, id: string, input: CampaignInputDto) {
    const fields = this.fields(input); await this.limits.consume(actorId, 'admin');
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actorId, 'ADMIN'); const campaign = await this.locked(tx, id, actorId);
      // Freeze participation rules once published so completed work is never
      // judged against a silently rewritten requirement or deadline.
      if (campaign.status !== 'DRAFT') throw this.conflict('Only draft campaigns can be edited');
      const row = await tx.campaign.update({ where: { id }, data: fields, select: campaignSelect });
      await this.audit(tx, id, actorId, 'EDIT', campaign.status, campaign.status, input.note);
      return presentCampaign(row);
    });
  }
  async lifecycle(actorId: string, id: string, action: 'publish' | 'close' | 'cancel', note: string) {
    await this.limits.consume(actorId, 'admin');
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actorId, 'ADMIN'); const campaign = await this.locked(tx, id, actorId);
      const status = { publish: 'ACTIVE', close: 'COMPLETED', cancel: 'CANCELLED' }[action] as 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
      if (campaign.status === status) return presentCampaign(await tx.campaign.findUniqueOrThrow({ where: { id }, select: campaignSelect }));
      if (action === 'publish' ? campaign.status !== 'DRAFT' || campaign.endsAt <= await this.now(tx) : action === 'close' ? campaign.status !== 'ACTIVE' : !['DRAFT', 'ACTIVE'].includes(campaign.status)) throw this.conflict();
      // Publication allocations are globally serialized through commit: no lower
      // publication sequence can appear after a feed's committed watermark.
      if (action === 'publish') await tx.$queryRaw`SELECT pg_advisory_xact_lock(7003000000001)::text`;
      await this.session(tx, actorId);
      if (action === 'publish' && campaign.endsAt <= await this.now(tx)) throw this.conflict('Campaign deadline has elapsed');
      const row = await tx.campaign.update({ where: { id }, data: { status }, select: campaignSelect });
      await this.audit(tx, id, actorId, action.toUpperCase(), campaign.status, status, note);
      return presentCampaign(row);
    });
  }
  private page(scope: string, query: CampaignPageDto) {
    scope = 'campaigns:' + scope;
    const point = query.cursor ? decodeForumCursor(scope, query.cursor) : undefined;
    const asOf = point?.asOf ?? new Date().toISOString();
    return { asOf, point, where: { createdAt: { lte: new Date(asOf) }, ...(point ? { OR: [{ createdAt: { lt: new Date(point.createdAt) } }, { createdAt: new Date(point.createdAt), id: { lt: point.id } }] } : {}) }, finish: <T extends { id: string; createdAt: Date }>(rows: T[], watermark = '0') => ({ items: rows.slice(0, query.limit), nextCursor: rows.length > query.limit ? encodeForumCursor(scope, { id: rows[query.limit - 1].id, createdAt: rows[query.limit - 1].createdAt.toISOString(), asOf, score: 0, watermark }) : null }) };
  }
  async feed(query: CampaignFeedDto, admin = false) {
    const page = this.page(JSON.stringify(['feed', admin, query.type ?? '']), query);
    const watermark = admin ? '0' : page.point?.watermark ?? (await this.prisma.campaignAudit.aggregate({ where: { action: 'PUBLISH' }, _max: { sequence: true } }))._max.sequence?.toString() ?? '0';
    const rows = await this.prisma.campaign.findMany({ where: { ...page.where, organizerId: { not: null }, ...(admin ? {} : { status: { in: ['ACTIVE', 'COMPLETED'] }, actions: { some: { action: 'PUBLISH', sequence: { lte: BigInt(watermark) } } } }), ...(query.type ? { type: query.type } : {}) }, select: campaignSelect, take: query.limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const result = page.finish(rows, watermark); return { ...result, items: result.items.map(presentCampaign) };
  }
  async detail(id: string, admin = false) {
    const row = await this.prisma.campaign.findFirst({ where: { id, organizerId: { not: null }, ...(admin ? {} : { status: { in: ['ACTIVE', 'COMPLETED'] } }) }, select: campaignSelect });
    if (!row) throw this.missing(); return presentCampaign(row);
  }
  async register(userId: string, id: string) {
    await this.limits.consume(userId, 'participation');
    return this.prisma.$transaction(async tx => {
      const user = await this.actor(tx, userId, 'USER'); const campaign = await this.locked(tx, id, userId);
      const previous = await tx.campaignParticipant.findUnique({ where: { campaignId_userId: { campaignId: id, userId } }, select: participantSelect });
      if (previous) return presentParticipation(previous);
      const now = await this.now(tx); this.live(campaign, now);
      if (+user.createdAt + campaign.minimumAccountAgeDays * 86400000 > +now) throw new ApiException('FORBIDDEN', 'Account age does not meet eligibility', HttpStatus.FORBIDDEN);
      const count = await tx.campaignParticipant.count({ where: { campaignId: id, status: { notIn: ['WITHDRAWN', 'REVOKED', 'REJECTED'] } } });
      if (campaign.participationLimit !== null && count >= campaign.participationLimit) throw this.conflict('Campaign participation limit reached');
      const row = await tx.campaignParticipant.create({ data: { campaignId: id, userId, joinedAt: now }, select: participantSelect });
      await this.audit(tx, id, userId, 'REGISTER', null, 'REGISTERED', 'User registration', row.id);
      return presentParticipation(row);
    });
  }
  async mine(userId: string, query: CampaignPageDto) {
    const page = this.page('mine:' + userId, query);
    const { createdAt, ...position } = page.where;
    const rows = await this.prisma.campaignParticipant.findMany({ where: { userId, campaign: { organizerId: { not: null } }, joinedAt: createdAt, ...('OR' in position ? { OR: position.OR?.map(row => ({ joinedAt: row.createdAt, ...('id' in row ? { id: row.id } : {}) })) } : {}) }, select: participantSelect, take: query.limit + 1, orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }] });
    const result = page.finish(rows.map(row => ({ ...row, createdAt: row.joinedAt })));
    return { ...result, items: result.items.map(({ createdAt: _createdAt, ...row }) => presentParticipation(row)) };
  }
  async ownParticipation(userId: string, campaignId: string) {
    const row = await this.prisma.campaignParticipant.findFirst({ where: { campaignId, userId, campaign: { organizerId: { not: null } } }, select: participantSelect });
    return row ? presentParticipation(row) : null;
  }
  async featured(userId: string) {
    if (!await this.prisma.user.findFirst({ where: { id: userId, status: 'ACTIVE' }, select: { id: true } })) throw this.missing();
    const rows = await this.prisma.campaignAchievement.findMany({ where: { revokedAt: null, featuredSlot: { not: null }, participant: { userId, status: 'VERIFIED', campaign: { organizerId: { not: null }, status: { in: ['ACTIVE', 'COMPLETED'] } } } }, select: { id: true, participantId: true, verificationId: true, issuedAt: true, featuredSlot: true, participant: { select: { campaign: { select: { id: true, name: true, type: true } } } } }, orderBy: { featuredSlot: 'asc' }, take: 3 });
    return rows.map(({ participant, ...row }) => ({ ...row, campaign: presentCampaign(participant.campaign), verified: true as const }));
  }
  private async participation(tx: Tx, id: string, userId?: string) {
    const row = await tx.campaignParticipant.findFirst({ where: { id, ...(userId ? { userId } : {}) } });
    if (!row) throw this.missing(); return row;
  }
  async participate(userId: string, id: string, action: 'start' | 'withdraw' | 'submit', input?: CampaignEvidenceDto) {
    await this.limits.consume(userId, action === 'submit' ? 'submission' : 'participation');
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, userId, 'USER');
      const identity = await this.participation(tx, id, userId); const campaign = await this.locked(tx, identity.campaignId, userId);
      const row = await this.participation(tx, id, userId); const now = await this.now(tx);
      const status = { start: 'IN_PROGRESS', withdraw: 'WITHDRAWN', submit: 'SUBMITTED' }[action] as ParticipationStatus;
      if (action === 'submit' && row.submissionKey) {
        if (row.submissionKey === input!.submissionKey && row.evidenceText === input!.text && row.evidenceUrl === (input!.url ?? null)) return presentParticipation(await tx.campaignParticipant.findUniqueOrThrow({ where: { id }, select: participantSelect }));
        throw this.conflict('A submission already exists; evidence cannot be replaced');
      }
      if (row.status === status && action !== 'submit') return presentParticipation(await tx.campaignParticipant.findUniqueOrThrow({ where: { id }, select: participantSelect }));
      if (action === 'withdraw') {
        if (!['REGISTERED', 'IN_PROGRESS', 'SUBMITTED'].includes(row.status)) throw this.conflict();
      } else {
        this.live(campaign, now);
        if (action === 'start' ? row.status !== 'REGISTERED' : row.status !== 'IN_PROGRESS') throw this.conflict();
      }
      const result = await tx.campaignParticipant.update({ where: { id }, data: { status, ...(action === 'submit' ? { evidenceText: input!.text, evidenceUrl: input!.url ?? null, submissionKey: input!.submissionKey, submittedAt: now } : {}) }, select: participantSelect });
      await this.audit(tx, campaign.id, userId, action.toUpperCase(), row.status, status, action === 'submit' ? 'Private evidence submitted' : 'User action', id);
      return presentParticipation(result);
    });
  }
  async review(actorId: string, id: string, action: 'verify' | 'reject' | 'revoke', note: string) {
    await this.limits.consume(actorId, 'admin');
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actorId, 'ADMIN');
      const identity = await this.participation(tx, id); const campaign = await this.locked(tx, identity.campaignId, actorId);
      if (identity.userId === actorId) throw new ApiException('FORBIDDEN', 'Self review is forbidden', HttpStatus.FORBIDDEN);
      // Same user fence as featured selection: revocation cannot leave a stale highlight.
      await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id=${identity.userId}::uuid FOR SHARE`;
      await this.session(tx, actorId);
      const row = await this.participation(tx, id); const status = { verify: 'VERIFIED', reject: 'REJECTED', revoke: 'REVOKED' }[action] as ParticipationStatus;
      if (row.status === status) return { id, status };
      if (action === 'revoke' ? row.status !== 'VERIFIED' : row.status !== 'SUBMITTED' || !row.submittedAt || row.submittedAt >= campaign.endsAt || !['ACTIVE', 'COMPLETED'].includes(campaign.status)) throw this.conflict();
      const audit = await this.audit(tx, campaign.id, actorId, action.toUpperCase(), row.status, status, note, id);
      await tx.campaignParticipant.update({ where: { id }, data: { status } });
      if (action === 'verify') await tx.campaignAchievement.create({ data: { participantId: id, verificationId: audit.id, issuedAt: await this.now(tx) } });
      if (action === 'revoke') await tx.campaignAchievement.update({ where: { participantId: id }, data: { revokedAt: await this.now(tx), featuredSlot: null } });
      return { id, status };
    });
  }
  async submissions(campaignId: string, query: CampaignPageDto) {
    await this.detail(campaignId, true);
    const page = this.page('submissions:' + campaignId, query);
    const { createdAt, ...position } = page.where;
    const rows = await this.prisma.campaignParticipant.findMany({ where: { campaignId, joinedAt: createdAt, ...('OR' in position ? { OR: position.OR?.map(row => ({ joinedAt: row.createdAt, ...('id' in row ? { id: row.id } : {}) })) } : {}) }, select: { ...participantSelect, user: { select: { id: true, username: true } } }, take: query.limit + 1, orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }] });
    const result = page.finish(rows.map(row => ({ ...row, createdAt: row.joinedAt })));
    return { ...result, items: result.items.map(({ createdAt: _createdAt, ...row }) => ({ ...presentParticipation(row), user: row.user })) };
  }
  async history(campaignId: string, query: CampaignPageDto) {
    await this.detail(campaignId, true); const page = this.page('audit:' + campaignId, query);
    const watermark = page.point?.watermark ?? (await this.prisma.campaignAudit.aggregate({ where: { campaignId }, _max: { sequence: true } }))._max.sequence?.toString() ?? '0';
    const position = page.point ? await this.prisma.campaignAudit.findFirst({ where: { id: page.point.id, campaignId }, select: { sequence: true } }) : null;
    if (page.point && !position) throw new ApiException('VALIDATION_FAILED', 'Invalid audit cursor', HttpStatus.UNPROCESSABLE_ENTITY);
    return page.finish(await this.prisma.campaignAudit.findMany({ where: { campaignId, sequence: { lte: BigInt(watermark), ...(position ? { lt: position.sequence } : {}) } }, select: { id: true, participantId: true, action: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: { id: true, username: true } } }, take: query.limit + 1, orderBy: { sequence: 'desc' } }), watermark);
  }
  async achievements(userId: string, query: CampaignPageDto) {
    if (!await this.prisma.user.findFirst({ where: { id: userId, status: 'ACTIVE' }, select: { id: true } })) throw this.missing();
    const page = this.page('achievements:' + userId, query);
    const { createdAt, ...position } = page.where;
    const badges = await this.prisma.campaignAchievement.findMany({ where: { revokedAt: null, participant: { userId, status: 'VERIFIED', campaign: { organizerId: { not: null }, status: { in: ['ACTIVE', 'COMPLETED'] } } }, issuedAt: createdAt, ...('OR' in position ? { OR: position.OR?.map(row => ({ issuedAt: row.createdAt, ...('id' in row ? { id: row.id } : {}) })) } : {}) }, select: { id: true, participantId: true, verificationId: true, issuedAt: true, featuredSlot: true, participant: { select: { campaign: { select: { id: true, name: true, type: true } } } } }, take: query.limit + 1, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }] });
    const result = page.finish(badges.map(row => ({ ...row, createdAt: row.issuedAt })));
    return { ...result, items: result.items.map(({ participant, createdAt: _createdAt, ...row }) => ({ ...row, campaign: presentCampaign(participant.campaign), verified: true as const })) };
  }
  async tags(userId: string, query: CampaignPageDto) {
    if (!await this.prisma.user.findFirst({ where: { id: userId, status: 'ACTIVE' }, select: { id: true } })) throw this.missing();
    const page = this.page('tags:' + userId, query);
    const { createdAt, ...position } = page.where;
    const rows = await this.prisma.campaignParticipant.findMany({ where: { userId, status: { in: ['REGISTERED', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED'] }, campaign: { organizerId: { not: null }, status: { in: ['ACTIVE', 'COMPLETED'] } }, joinedAt: createdAt, ...('OR' in position ? { OR: position.OR?.map(row => ({ joinedAt: row.createdAt, ...('id' in row ? { id: row.id } : {}) })) } : {}) }, select: { id: true, joinedAt: true, campaign: { select: { id: true, name: true, type: true } } }, take: query.limit + 1, orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }] });
    const result = page.finish(rows.map(row => ({ ...row, createdAt: row.joinedAt })));
    return { ...result, items: result.items.map(({ createdAt: _createdAt, ...row }) => ({ ...row, campaign: presentCampaign(row.campaign), verified: false as const, label: 'Đã tham gia — chưa phải thành tích' })) };
  }
  async feature(userId: string, ids: string[]) {
    await this.limits.consume(userId, 'featured');
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, userId, undefined, true);
      await this.session(tx, userId);
      const owned = await tx.campaignAchievement.findMany({ where: { id: { in: ids }, revokedAt: null, participant: { userId, status: 'VERIFIED', campaign: { status: { in: ['ACTIVE', 'COMPLETED'] } } } }, select: { id: true } });
      if (ids.length > 3 || new Set(ids).size !== ids.length || owned.length !== ids.length) throw this.conflict('Select at most three own verified badges');
      await tx.campaignAchievement.updateMany({ where: { participant: { userId }, featuredSlot: { not: null } }, data: { featuredSlot: null } });
      for (const [index, id] of ids.entries()) await tx.campaignAchievement.update({ where: { id }, data: { featuredSlot: index + 1 } });
      return { ids };
    });
  }
}
