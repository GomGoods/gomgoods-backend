import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertAccountActive } from '../auth/account-access.policy.js';
import type { CreateForumCommentDto, CreateForumPostDto, CreateForumReportDto, ForumFeedDto, ForumModerationDto, ForumPageDto, ReviewForumReportDto, UpdateForumCommentDto, UpdateForumPostDto } from './forum.dto.js';
import { ForumReviewAction, ForumReviewState, ForumSort } from './forum.dto.js';
import { decodeForumCursor, encodeForumCursor, type ForumCursor } from './forum-policy.js';
import { ForumRateLimit, type ForumMutation } from './forum-rate-limit.js';
import { forumAuthorSelect, forumCommentSelect, forumPostSelect, forumReportSelect, publicCommentWhere, publicPostWhere } from './forum.select.js';

type Tx = Prisma.TransactionClient;
type LockedPost = Prisma.PostGetPayload<{ include: { user: { select: { status: true } }; topic: { select: { active: true } } } }>;
type RankedPost = { id: string; createdAt: Date; score: number };

@Injectable()
export class ForumService {
  constructor(private readonly prisma: PrismaService, private readonly limits: ForumRateLimit) {}

  topics() {
    return this.prisma.forumTopic.findMany({ where: { active: true }, orderBy: { slug: 'asc' }, select: { id: true, slug: true, name: true } });
  }

  private notFound() { return new ApiException('RESOURCE_NOT_FOUND', 'Forum resource not found', HttpStatus.NOT_FOUND); }
  private conflict() { return new ApiException('RESOURCE_CONFLICT', 'Forum state no longer permits this operation', HttpStatus.CONFLICT); }
  private async actor(tx: Tx, id: string, admin = false) {
    await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id=${id}::uuid FOR SHARE`;
    const user = await tx.user.findUnique({ where: { id }, select: { status: true, accountType: true } });
    if (!user) throw this.notFound();
    assertAccountActive(user.status);
    if (admin && user.accountType !== 'ADMIN') throw new ApiException('FORBIDDEN', 'Forum moderation requires ADMIN', HttpStatus.FORBIDDEN);
  }
  private async locked<T>(userId: string, postId: string, action: ForumMutation, work: (tx: Tx, post: LockedPost) => Promise<T>, admin = false) {
    this.limits.consume(userId, action);
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, userId, admin);
      await tx.$queryRaw`SELECT post_id FROM "POST" WHERE post_id=${postId}::uuid FOR UPDATE`;
      const identity = await tx.post.findUnique({ where: { id: postId }, select: { userId: true, topicId: true } });
      if (!identity) throw this.notFound();
      // Freeze related visibility through commit, including concurrent account
      // suspension or topic deactivation outside the forum module.
      await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id=${identity.userId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT topic_id FROM "FORUM_TOPIC" WHERE topic_id=${identity.topicId}::uuid FOR SHARE`;
      const post = await tx.post.findUnique({ where: { id: postId }, include: { user: { select: { status: true } }, topic: { select: { active: true } } } });
      if (!post) throw this.notFound();
      return work(tx, post);
    });
  }
  private visible(post: LockedPost) {
    if (post.status !== 'PUBLISHED' || post.deletedAt || post.hiddenAt || post.user.status !== 'ACTIVE' || !post.topic.active) throw this.notFound();
  }
  private async topic(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT topic_id FROM "FORUM_TOPIC" WHERE topic_id=${id}::uuid FOR SHARE`;
    if (!await tx.forumTopic.findFirst({ where: { id, active: true }, select: { id: true } })) throw this.notFound();
  }
  private response(row: Prisma.PostGetPayload<{ select: typeof forumPostSelect }>) {
    const { _count, ...post } = row;
    return { ...post, likeCount: _count.reactions, commentCount: _count.comments };
  }
  private async selected(tx: Tx, id: string) { return this.response(await tx.post.findUniqueOrThrow({ where: { id }, select: forumPostSelect })); }

  async create(userId: string, input: CreateForumPostDto) {
    this.limits.consume(userId, 'post');
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, userId); await this.topic(tx, input.topicId);
      const post = await tx.post.create({ data: { userId, title: input.title, content: input.content, topicId: input.topicId, status: input.status, createdAt: new Date() }, select: forumPostSelect });
      return this.response(post);
    });
  }
  async detail(id: string) {
    const post = await this.prisma.post.findFirst({ where: { ...publicPostWhere, id }, select: forumPostSelect });
    if (!post) throw this.notFound();
    return this.response(post);
  }
  update(userId: string, id: string, input: UpdateForumPostDto) {
    return this.locked(userId, id, 'edit', async (tx, post) => {
      if (post.userId !== userId) throw this.notFound();
      if (!['DRAFT', 'PUBLISHED'].includes(post.status) || post.deletedAt || post.hiddenAt) throw this.conflict();
      if (input.topicId) await this.topic(tx, input.topicId);
      await tx.post.update({ where: { id }, data: { ...input } });
      return this.selected(tx, id);
    });
  }
  remove(userId: string, id: string) {
    return this.locked(userId, id, 'edit', async (tx, post) => {
      if (post.userId !== userId) throw this.notFound();
      if (!post.deletedAt) await tx.post.update({ where: { id }, data: { status: 'REMOVED', deletedAt: new Date() } });
      return { id, status: 'REMOVED' };
    });
  }

  async feed(query: ForumFeedDto) {
    const scope = JSON.stringify(['feed', query.sort, query.topic || '', query.q || '']);
    const point = query.cursor ? decodeForumCursor(scope, query.cursor) : undefined;
    const asOf = point?.asOf || new Date().toISOString();
    const cursor = point ? query.sort === ForumSort.POPULAR
      ? Prisma.sql`AND (ranked.score < ${point.score} OR (ranked.score=${point.score} AND (ranked."createdAt",ranked.id)<(${new Date(point.createdAt)}::timestamptz,${point.id}::uuid)))`
      : Prisma.sql`AND (ranked."createdAt",ranked.id)<(${new Date(point.createdAt)}::timestamptz,${point.id}::uuid)` : Prisma.empty;
    return this.prisma.$transaction(async tx => {
      const watermark = point?.watermark || (await tx.forumLikeEvent.aggregate({ _max: { sequence: true } }))._max.sequence?.toString() || '0';
      const ranked = await tx.$queryRaw<RankedPost[]>(Prisma.sql`
        WITH latest AS (
          SELECT DISTINCT ON(post_id,user_id) post_id,user_id,liked FROM "FORUM_LIKE_EVENT"
          WHERE sequence<=${BigInt(watermark)} ORDER BY post_id,user_id,sequence DESC
        ), ranked AS (
          SELECT p.post_id AS id,date_trunc('milliseconds',p.created_at) AS "createdAt",
            count(r.user_id) FILTER (WHERE r.liked)::int AS score
          FROM "POST" p JOIN "USER" author ON author.user_id=p.user_id JOIN "FORUM_TOPIC" t ON t.topic_id=p.topic_id
          LEFT JOIN latest r ON r.post_id=p.post_id
          WHERE p.status='PUBLISHED' AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND author.status='ACTIVE' AND t.active
            AND date_trunc('milliseconds',p.created_at)<=${new Date(asOf)}::timestamptz
            ${query.topic ? Prisma.sql`AND t.slug=${query.topic}` : Prisma.empty}
            ${query.q ? Prisma.sql`AND (strpos(lower(p.title),lower(${query.q}))>0 OR strpos(lower(p.content),lower(${query.q}))>0)` : Prisma.empty}
          GROUP BY p.post_id
        ) SELECT * FROM ranked WHERE true ${cursor}
        ORDER BY ${query.sort === ForumSort.POPULAR ? Prisma.sql`score DESC,` : Prisma.empty} "createdAt" DESC,id DESC LIMIT ${query.limit + 1}`);
      const page = ranked.slice(0, query.limit);
      const posts = page.length ? await tx.post.findMany({ where: { id: { in: page.map(row => row.id) }, ...publicPostWhere }, select: forumPostSelect }) : [];
      const byId = new Map(posts.map(row => [row.id, row]));
      return { items: page.map(row => ({ ...this.response(byId.get(row.id)!), popularityScore: row.score })), nextCursor: ranked.length > query.limit ? this.next(scope, page.at(-1)!, asOf, watermark) : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  private next(scope: string, row: { id: string; createdAt: Date; score?: number }, asOf: string, watermark = '0') {
    return encodeForumCursor(scope, { id: row.id, createdAt: row.createdAt.toISOString(), score: row.score || 0, asOf, watermark });
  }
  private position(point?: ForumCursor) {
    return point ? { OR: [{ createdAt: { lt: new Date(point.createdAt) } }, { createdAt: new Date(point.createdAt), id: { lt: point.id } }] } : {};
  }
  async mine(userId: string, query: ForumPageDto) {
    const scope = 'mine:' + userId, point = query.cursor ? decodeForumCursor(scope, query.cursor) : undefined;
    const asOf = point?.asOf || new Date().toISOString();
    const rows = await this.prisma.post.findMany({ where: { userId, createdAt: { lte: new Date(asOf) }, ...this.position(point) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, select: forumPostSelect });
    return { items: rows.slice(0, query.limit).map(row => this.response(row)), nextCursor: rows.length > query.limit ? this.next(scope, rows[query.limit - 1], asOf) : null };
  }
  async comments(postId: string, query: ForumPageDto) {
    const scope = 'comments:' + postId, point = query.cursor ? decodeForumCursor(scope, query.cursor) : undefined;
    const asOf = point?.asOf || new Date().toISOString();
    return this.prisma.$transaction(async tx => {
      if (!await tx.post.findFirst({ where: { id: postId, ...publicPostWhere }, select: { id: true } })) throw this.notFound();
      const rows = await tx.comment.findMany({ where: { postId, ...publicCommentWhere, createdAt: { lte: new Date(asOf) }, ...(point ? { AND: [{ OR: [{ createdAt: { gt: new Date(point.createdAt) } }, { createdAt: new Date(point.createdAt), id: { gt: point.id } }] }] } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: query.limit + 1, select: forumCommentSelect });
      return { items: rows.slice(0, query.limit), nextCursor: rows.length > query.limit ? this.next(scope, rows[query.limit - 1], asOf) : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  addComment(userId: string, postId: string, input: CreateForumCommentDto) {
    return this.locked(userId, postId, 'comment', async (tx, post) => {
      this.visible(post);
      if (input.parentId && !await tx.comment.findFirst({ where: { id: input.parentId, postId, parentId: null, ...publicCommentWhere }, select: { id: true } })) throw this.notFound();
      return tx.comment.create({ data: { postId, userId, content: input.content, parentId: input.parentId, createdAt: new Date() }, select: forumCommentSelect });
    });
  }
  private async commentPost(id: string) {
    const row = await this.prisma.comment.findUnique({ where: { id }, select: { postId: true } });
    if (!row) throw this.notFound();
    return row.postId;
  }
  async editComment(userId: string, id: string, input: UpdateForumCommentDto) {
    return this.locked(userId, await this.commentPost(id), 'comment', async (tx, post) => {
      this.visible(post);
      if (!await tx.comment.findFirst({ where: { id, userId, ...publicCommentWhere }, select: { id: true } })) throw this.notFound();
      return tx.comment.update({ where: { id }, data: { content: input.content }, select: forumCommentSelect });
    });
  }
  async removeComment(userId: string, id: string) {
    return this.locked(userId, await this.commentPost(id), 'comment', async tx => {
      const row = await tx.comment.findFirst({ where: { id, userId }, select: { deletedAt: true } });
      if (!row) throw this.notFound();
      if (!row.deletedAt) await tx.comment.update({ where: { id }, data: { status: 'REMOVED', deletedAt: new Date() } });
      return { id, status: 'REMOVED' };
    });
  }
  like(userId: string, id: string, liked: boolean) {
    return this.locked(userId, id, 'like', async (tx, post) => {
      this.visible(post);
      const previous = await tx.reaction.findUnique({ where: { postId_userId: { postId: id, userId } }, select: { type: true } });
      if ((previous?.type === 'LIKE') !== liked) {
        // ponytail: serialize event allocation through commit so a lower sequence
        // cannot appear after a cursor watermark; shard/revisit for high like throughput.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(7002000000001)::text`;
        if (liked) await tx.reaction.upsert({ where: { postId_userId: { postId: id, userId } }, create: { postId: id, userId, type: 'LIKE' }, update: { type: 'LIKE' } });
        else await tx.reaction.deleteMany({ where: { postId: id, userId, type: 'LIKE' } });
        await tx.forumLikeEvent.create({ data: { postId: id, userId, liked } });
      }
      return { postId: id, liked, likeCount: await tx.reaction.count({ where: { postId: id, type: 'LIKE', user: { status: 'ACTIVE' } } }) };
    });
  }
  async report(userId: string, targetId: string, type: 'POST' | 'COMMENT', input: CreateForumReportDto) {
    const postId = type === 'POST' ? targetId : await this.commentPost(targetId);
    return this.locked(userId, postId, 'report', async (tx, post) => {
      this.visible(post);
      if (type === 'COMMENT' && !await tx.comment.findFirst({ where: { id: targetId, ...publicCommentWhere }, select: { id: true } })) throw this.notFound();
      const existing = await tx.report.findFirst({ where: { userId, targetType: type, targetId }, select: forumReportSelect });
      if (existing) return existing;
      return tx.report.create({ data: { userId, targetType: type, targetId, reason: input.reason, content: input.content, ...(type === 'POST' ? { postId } : { commentId: targetId }), createdAt: new Date() }, select: forumReportSelect });
    });
  }
  async reports(query: ForumPageDto) {
    const scope = 'admin-reports', point = query.cursor ? decodeForumCursor(scope, query.cursor) : undefined;
    const asOf = point?.asOf || new Date().toISOString();
    const rows = await this.prisma.report.findMany({ where: { targetType: { in: ['POST', 'COMMENT'] }, createdAt: { lte: new Date(asOf) }, ...this.position(point) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, select: { ...forumReportSelect, user: { select: forumAuthorSelect }, post: { select: { ...forumPostSelect } }, comment: { select: { ...forumCommentSelect, status: true } }, moderationActions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10, select: { id: true, action: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: forumAuthorSelect } } } } });
    return { items: rows.slice(0, query.limit).map(row => ({ ...row, post: row.post ? this.response(row.post) : null })), nextCursor: rows.length > query.limit ? this.next(scope, rows[query.limit - 1], asOf) : null };
  }
  private async hide(tx: Tx, userId: string, post: LockedPost, commentId: string | undefined, note: string) {
    if (commentId) {
      const comment = await tx.comment.findFirst({ where: { id: commentId, postId: post.id }, select: { status: true } });
      if (!comment || comment.status === 'REMOVED') throw this.conflict();
      if (comment.status !== 'HIDDEN') {
        await tx.comment.update({ where: { id: commentId }, data: { status: 'HIDDEN', hiddenAt: new Date() } });
        await tx.forumModerationAction.create({ data: { actorId: userId, postId: post.id, commentId, action: 'HIDE_COMMENT', fromStatus: comment.status, toStatus: 'HIDDEN', note } });
      }
    } else {
      if (post.status === 'REMOVED') throw this.conflict();
      if (post.status !== 'HIDDEN') {
        await tx.post.update({ where: { id: post.id }, data: { status: 'HIDDEN', hiddenAt: new Date() } });
        await tx.forumModerationAction.create({ data: { actorId: userId, postId: post.id, action: 'HIDE_POST', fromStatus: post.status, toStatus: 'HIDDEN', note } });
      }
    }
  }
  async moderate(userId: string, id: string, type: 'POST' | 'COMMENT', input: ForumModerationDto) {
    return this.locked(userId, type === 'POST' ? id : await this.commentPost(id), 'moderation', async (tx, post) => {
      await this.hide(tx, userId, post, type === 'COMMENT' ? id : undefined, input.note);
      return { id, status: 'HIDDEN' };
    }, true);
  }
  async review(userId: string, id: string, input: ReviewForumReportDto) {
    const target = await this.prisma.report.findFirst({ where: { id, targetType: { in: ['POST', 'COMMENT'] } }, select: { postId: true, comment: { select: { postId: true } } } });
    if (!target) throw this.notFound();
    return this.locked(userId, target.postId || target.comment!.postId, 'moderation', async (tx, post) => {
      const report = await tx.report.findUniqueOrThrow({ where: { id } });
      if (!['OPEN', 'IN_REVIEW'].includes(report.status) || report.status === input.status || (input.action === ForumReviewAction.HIDE && input.status !== ForumReviewState.RESOLVED)) throw this.conflict();
      if (input.action === ForumReviewAction.HIDE) await this.hide(tx, userId, post, report.commentId || undefined, input.note);
      await tx.forumModerationAction.create({ data: { actorId: userId, postId: post.id, commentId: report.commentId, reportId: id, action: 'REVIEW_REPORT', fromStatus: report.status, toStatus: input.status, note: input.note } });
      return tx.report.update({ where: { id }, data: { status: input.status }, select: forumReportSelect });
    }, true);
  }

  async moderationHistory(postId: string, query: ForumPageDto) {
    const scope = 'post-audit:' + postId, point = query.cursor ? decodeForumCursor(scope, query.cursor) : undefined;
    const asOf = point?.asOf || new Date().toISOString();
    if (!await this.prisma.post.findUnique({ where: { id: postId }, select: { id: true } })) throw this.notFound();
    const rows = await this.prisma.forumModerationAction.findMany({
      where: { postId, createdAt: { lte: new Date(asOf) }, ...this.position(point) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
      select: { id: true, postId: true, commentId: true, reportId: true, action: true, fromStatus: true, toStatus: true, note: true, createdAt: true, actor: { select: forumAuthorSelect } },
    });
    return { items: rows.slice(0, query.limit), nextCursor: rows.length > query.limit ? this.next(scope, rows[query.limit - 1], asOf) : null };
  }
}
