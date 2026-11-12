import { ApiResponse, type SchemaObject } from '@nestjs/swagger';

const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const date: SchemaObject = { type: 'string', format: 'date-time' };
const text: SchemaObject = { type: 'string' };
const count: SchemaObject = { type: 'integer', minimum: 0 };
const object = (properties: Record<string, SchemaObject>): SchemaObject => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const array = (items: SchemaObject): SchemaObject => ({ type: 'array', items });
const nullable = (schema: SchemaObject): SchemaObject => ({ ...schema, nullable: true });
const author = object({ id: uuid, username: text });
export const forumTopicSchema = object({ id: uuid, slug: text, name: text });
export const forumPostSchema = object({
  id: uuid, title: { ...text, maxLength: 250 }, content: { ...text, maxLength: 10000 },
  status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'HIDDEN', 'REMOVED'] },
  deletedAt: nullable(date), hiddenAt: nullable(date), createdAt: date, updatedAt: date,
  user: author, topic: forumTopicSchema, likeCount: count, commentCount: count,
});
export const forumCommentSchema = object({ id: uuid, postId: uuid, parentId: nullable(uuid), content: { ...text, maxLength: 2000 }, createdAt: date, updatedAt: date, user: author });
export const forumReportSchema = object({ id: uuid, targetType: { type: 'string', enum: ['POST', 'COMMENT'] }, targetId: uuid, reason: text, content: nullable(text), status: { type: 'string', enum: ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED'] }, createdAt: date, updatedAt: date });
const auditProperties = { id: uuid, action: text, fromStatus: text, toStatus: text, note: text, createdAt: date, actor: author };
export const forumAuditSchema = object({ ...auditProperties, postId: uuid, commentId: nullable(uuid), reportId: nullable(uuid) });
export const forumAdminReportSchema = object({ ...forumReportSchema.properties, user: author, post: nullable(forumPostSchema), comment: nullable(object({ ...forumCommentSchema.properties, status: text })), moderationActions: array(object(auditProperties)) });
export const forumFeedItemSchema = object({ ...forumPostSchema.properties, popularityScore: count });
export const forumLikeSchema = object({ postId: uuid, liked: { type: 'boolean' }, likeCount: count });
export const forumStateSchema = object({ id: uuid, status: text });
export const forumPageSchema = (item: SchemaObject) => object({ items: array(item), nextCursor: nullable(text) });
export const forumTopicsSchema = array(forumTopicSchema);
export function ForumResponse(schema: SchemaObject, created = false) {
  return ApiResponse({ status: created ? 201 : 200, schema: object({ success: { type: 'boolean', enum: [true] }, data: schema }) });
}
