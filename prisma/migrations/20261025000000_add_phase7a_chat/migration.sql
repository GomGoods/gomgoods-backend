BEGIN;
-- No safe buyer/listing mapping can be inferred from legacy chat rows.
-- Refuse rather than deleting, assigning, or silently resetting their receipts.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "CONVERSATION") OR EXISTS (SELECT 1 FROM "MESSAGE")
    OR EXISTS (SELECT 1 FROM "CONVERSATION_PARTICIPANT") THEN
    RAISE EXCEPTION 'Phase 7A requires separately approved legacy chat mapping';
  END IF;
END $$;

ALTER TABLE "CONVERSATION"
  ADD COLUMN "buyer_id" UUID NOT NULL,
  ADD COLUMN "seller_user_id" UUID NOT NULL,
  ADD COLUMN "listing_id" UUID NOT NULL,
  ADD COLUMN "store_id" UUID,
  ADD COLUMN "context_snapshot" JSONB NOT NULL,
  ADD COLUMN "last_sequence" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT "CONVERSATION_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CONVERSATION_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CONVERSATION_distinct_users_check" CHECK ("buyer_id" <> "seller_user_id"),
  ADD CONSTRAINT "CONVERSATION_sequence_check" CHECK ("last_sequence" >= 0);
-- listing_id/store_id deliberately retain identity without a live catalogue FK.
-- History is preserved if catalogue records are later removed; sends fail closed
-- when a snapshotted store no longer exists or its owner differs.
CREATE UNIQUE INDEX "CONVERSATION_buyer_id_listing_id_key" ON "CONVERSATION"("buyer_id", "listing_id");
CREATE INDEX "CONVERSATION_updated_at_conversation_id_idx" ON "CONVERSATION"("updated_at", "conversation_id");

ALTER TABLE "CONVERSATION_PARTICIPANT"
  ADD COLUMN "last_delivered_sequence" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "last_read_sequence" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT "CONVERSATION_PARTICIPANT_receipts_check" CHECK (
    "last_read_sequence" >= 0 AND "last_delivered_sequence" >= "last_read_sequence");
ALTER TABLE "MESSAGE"
  ADD COLUMN "sequence" BIGINT NOT NULL,
  ADD COLUMN "client_message_id" UUID NOT NULL,
  ADD CONSTRAINT "MESSAGE_sequence_check" CHECK ("sequence" > 0),
  ADD CONSTRAINT "MESSAGE_content_check" CHECK (char_length(btrim("content")) BETWEEN 1 AND 2000),
  ADD CONSTRAINT "MESSAGE_membership_fkey" FOREIGN KEY ("conversation_id", "sender_id")
    REFERENCES "CONVERSATION_PARTICIPANT"("conversation_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "MESSAGE_conversation_id_sequence_key" ON "MESSAGE"("conversation_id", "sequence");
CREATE UNIQUE INDEX "MESSAGE_conversation_id_sender_id_client_message_id_key" ON "MESSAGE"("conversation_id", "sender_id", "client_message_id");

CREATE FUNCTION phase7a_chat_participants_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid uuid; c "CONVERSATION"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'CONVERSATION' THEN
    cid := NEW.conversation_id;
  ELSIF TG_OP = 'DELETE' THEN cid := OLD.conversation_id;
  ELSE cid := NEW.conversation_id;
  END IF;
  SELECT * INTO c FROM "CONVERSATION" WHERE conversation_id = cid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF (SELECT count(*) FROM "CONVERSATION_PARTICIPANT" WHERE conversation_id = cid) <> 2
    OR EXISTS (SELECT 1 FROM "CONVERSATION_PARTICIPANT" WHERE conversation_id = cid
      AND (user_id NOT IN (c.buyer_id, c.seller_user_id) OR last_delivered_sequence > c.last_sequence)) THEN
    RAISE EXCEPTION 'Invalid chat participants or receipt bounds' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "CONVERSATION_participants_check" AFTER INSERT OR UPDATE ON "CONVERSATION"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase7a_chat_participants_check();
CREATE CONSTRAINT TRIGGER "CONVERSATION_PARTICIPANT_members_check" AFTER INSERT OR UPDATE OR DELETE ON "CONVERSATION_PARTICIPANT"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase7a_chat_participants_check();
COMMIT;
