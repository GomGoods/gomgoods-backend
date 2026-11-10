BEGIN;

-- No guessed topic/status mappings or destructive legacy transformations.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "POST") OR EXISTS (SELECT 1 FROM "COMMENT")
    OR EXISTS (SELECT 1 FROM "REACTION")
    OR EXISTS (SELECT 1 FROM "REPORT" WHERE target_type IN ('POST','COMMENT')) THEN
    RAISE EXCEPTION 'Phase 7B requires reviewed legacy forum migration; existing forum data is not rewritten';
  END IF;
END $$;

CREATE TABLE "FORUM_TOPIC" (
  topic_id UUID NOT NULL PRIMARY KEY,
  slug VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "FORUM_TOPIC_slug_check" CHECK (slug ~ '^[a-z0-9-]{1,50}$')
);
-- Forum taxonomy only, independent of the commerce CATEGORY table.
INSERT INTO "FORUM_TOPIC" (topic_id,slug,name) VALUES
 ('00000000-0000-4000-8000-000000007001','general','Cộng đồng chung'),
 ('00000000-0000-4000-8000-000000007002','anime-manga','Anime & Manga'),
 ('00000000-0000-4000-8000-000000007003','game','Game'),
 ('00000000-0000-4000-8000-000000007004','idol','Idol & K-pop'),
 ('00000000-0000-4000-8000-000000007005','collectibles','Đồ sưu tầm'),
 ('00000000-0000-4000-8000-000000007006','cosplay','Cosplay');

ALTER TABLE "POST" ADD COLUMN topic_id UUID NOT NULL,
 ADD COLUMN deleted_at TIMESTAMPTZ(6), ADD COLUMN hidden_at TIMESTAMPTZ(6),
 ADD CONSTRAINT "POST_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES "FORUM_TOPIC"(topic_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "POST_text_check" CHECK (char_length(title) BETWEEN 1 AND 250 AND title ~ '\S' AND char_length(content) BETWEEN 1 AND 10000 AND content ~ '\S'),
 ADD CONSTRAINT "POST_state_check" CHECK ((status = 'REMOVED') = (deleted_at IS NOT NULL) AND (status <> 'HIDDEN' OR hidden_at IS NOT NULL));
CREATE INDEX "POST_topic_id_status_created_at_post_id_idx" ON "POST"(topic_id,status,created_at,post_id);
CREATE INDEX "POST_status_created_at_post_id_idx" ON "POST"(status,created_at,post_id);

ALTER TABLE "COMMENT" ADD COLUMN parent_id UUID,
 ADD COLUMN status "PostStatus" NOT NULL DEFAULT 'PUBLISHED',
 ADD COLUMN deleted_at TIMESTAMPTZ(6), ADD COLUMN hidden_at TIMESTAMPTZ(6),
 ADD CONSTRAINT "COMMENT_post_id_comment_id_key" UNIQUE (post_id,comment_id),
 ADD CONSTRAINT "COMMENT_post_id_parent_id_fkey" FOREIGN KEY(post_id,parent_id) REFERENCES "COMMENT"(post_id,comment_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
 ADD CONSTRAINT "COMMENT_text_check" CHECK (char_length(content) BETWEEN 1 AND 2000 AND content ~ '\S'),
 ADD CONSTRAINT "COMMENT_state_check" CHECK (status IN ('PUBLISHED','HIDDEN','REMOVED') AND (status = 'REMOVED') = (deleted_at IS NOT NULL) AND (status <> 'HIDDEN' OR hidden_at IS NOT NULL)),
 ADD CONSTRAINT "COMMENT_not_self_parent" CHECK (parent_id IS NULL OR parent_id <> comment_id);
CREATE INDEX "COMMENT_post_id_status_created_at_comment_id_idx" ON "COMMENT"(post_id,status,created_at,comment_id);

ALTER TABLE "REPORT" ADD COLUMN forum_post_id UUID, ADD COLUMN forum_comment_id UUID,
 ADD CONSTRAINT "REPORT_forum_post_id_fkey" FOREIGN KEY(forum_post_id) REFERENCES "POST"(post_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "REPORT_forum_comment_id_fkey" FOREIGN KEY(forum_comment_id) REFERENCES "COMMENT"(comment_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "REPORT_forum_target_check" CHECK (
   (target_type = 'POST' AND forum_post_id = target_id AND forum_post_id IS NOT NULL AND forum_comment_id IS NULL) OR
   (target_type = 'COMMENT' AND forum_comment_id = target_id AND forum_comment_id IS NOT NULL AND forum_post_id IS NULL) OR
   (target_type NOT IN ('POST','COMMENT') AND forum_post_id IS NULL AND forum_comment_id IS NULL)
 ),
 ADD CONSTRAINT "REPORT_forum_reason_check" CHECK (target_type NOT IN ('POST','COMMENT') OR
   (reason IN ('SPAM','HARASSMENT','SCAM','INAPPROPRIATE','OTHER') AND (content IS NULL OR (char_length(content) BETWEEN 1 AND 2000 AND content ~ '\S'))));
CREATE UNIQUE INDEX "REPORT_forum_user_target_key" ON "REPORT"(user_id,target_type,target_id) WHERE target_type IN ('POST','COMMENT');

CREATE TABLE "FORUM_MODERATION_ACTION" (
 action_id UUID PRIMARY KEY,
 actor_id UUID NOT NULL REFERENCES "USER"(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 post_id UUID NOT NULL REFERENCES "POST"(post_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 comment_id UUID REFERENCES "COMMENT"(comment_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 report_id UUID REFERENCES "REPORT"(report_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 action VARCHAR(30) NOT NULL CHECK (action IN ('HIDE_POST','HIDE_COMMENT','REVIEW_REPORT')),
 from_status VARCHAR(30) NOT NULL, to_status VARCHAR(30) NOT NULL,
 note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 2000 AND note ~ '\S'),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FORUM_MODERATION_ACTION_post_id_created_at_idx" ON "FORUM_MODERATION_ACTION"(post_id,created_at);
CREATE INDEX "FORUM_MODERATION_ACTION_report_id_created_at_idx" ON "FORUM_MODERATION_ACTION"(report_id,created_at);

CREATE FUNCTION forum_post_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'Forum post identity is immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "POST_forum_identity" BEFORE UPDATE ON "POST" FOR EACH ROW EXECUTE FUNCTION forum_post_identity();

CREATE FUNCTION forum_comment_identity_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
   IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.comment_id IS DISTINCT FROM OLD.comment_id
      OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
     RAISE EXCEPTION 'Forum comment identity is immutable' USING ERRCODE = '23514';
   END IF;
 ELSIF NEW.parent_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM "COMMENT" p WHERE p.comment_id=NEW.parent_id AND p.post_id=NEW.post_id AND p.parent_id IS NULL
      AND p.status='PUBLISHED' AND p.deleted_at IS NULL AND p.hidden_at IS NULL
 ) THEN
   RAISE EXCEPTION 'Forum replies require a visible root comment in the same post' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "COMMENT_forum_identity_depth" BEFORE INSERT OR UPDATE ON "COMMENT" FOR EACH ROW EXECUTE FUNCTION forum_comment_identity_depth();

COMMIT;
