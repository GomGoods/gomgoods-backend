import { Prisma } from '../../generated/prisma/client.js';

export const forumAuthorSelect = { id: true, username: true } satisfies Prisma.UserSelect;
export const publicPostWhere = { status: 'PUBLISHED', deletedAt: null, hiddenAt: null, user: { status: 'ACTIVE' }, topic: { active: true } } satisfies Prisma.PostWhereInput;
const visibleComment = { status: 'PUBLISHED', deletedAt: null, hiddenAt: null, user: { status: 'ACTIVE' } } satisfies Prisma.CommentWhereInput;
export const publicCommentWhere = {
  ...visibleComment, OR: [{ parentId: null }, { parent: { is: visibleComment } }],
} satisfies Prisma.CommentWhereInput;
export const forumPostSelect = {
  id: true, title: true, content: true, status: true, deletedAt: true, hiddenAt: true, createdAt: true, updatedAt: true,
  user: { select: forumAuthorSelect }, topic: { select: { id: true, slug: true, name: true } },
  _count: { select: { reactions: { where: { type: 'LIKE', user: { status: 'ACTIVE' } } }, comments: { where: publicCommentWhere } } },
} satisfies Prisma.PostSelect;
export const forumCommentSelect = {
  id: true, postId: true, parentId: true, content: true, createdAt: true, updatedAt: true,
  user: { select: forumAuthorSelect },
} satisfies Prisma.CommentSelect;
export const forumReportSelect = {
  id: true, targetType: true, targetId: true, reason: true, content: true, status: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ReportSelect;
