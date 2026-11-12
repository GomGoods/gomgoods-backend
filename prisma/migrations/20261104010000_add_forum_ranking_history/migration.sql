BEGIN;
CREATE TABLE "FORUM_LIKE_EVENT" (
 sequence BIGSERIAL PRIMARY KEY,
 post_id UUID NOT NULL REFERENCES "POST"(post_id) ON DELETE CASCADE ON UPDATE CASCADE,
 user_id UUID NOT NULL REFERENCES "USER"(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
 liked BOOLEAN NOT NULL
);
CREATE INDEX "FORUM_LIKE_EVENT_post_id_user_id_sequence_idx" ON "FORUM_LIKE_EVENT"(post_id,user_id,sequence DESC);
-- Preserve any canonical likes accepted between the two additive deployments.
INSERT INTO "FORUM_LIKE_EVENT"(post_id,user_id,liked)
 SELECT post_id,user_id,true FROM "REACTION" WHERE type='LIKE' ORDER BY created_at,reaction_id;
COMMIT;
