BEGIN;

-- Upgrade constraints in a new migration; do not rewrite the applied chat migration
-- or repair/normalize existing message text and receipt history silently.
ALTER TABLE "MESSAGE" DROP CONSTRAINT "MESSAGE_content_check";
ALTER TABLE "MESSAGE" ADD CONSTRAINT "MESSAGE_content_check"
  CHECK (char_length("content") BETWEEN 1 AND 2000 AND char_length(btrim("content")) > 0);

CREATE FUNCTION phase7a_chat_immutable_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
    OR NEW.seller_user_id IS DISTINCT FROM OLD.seller_user_id
    OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
    OR NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.context_snapshot IS DISTINCT FROM OLD.context_snapshot THEN
    RAISE EXCEPTION 'Chat identity and historical context are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.last_sequence < OLD.last_sequence THEN
    RAISE EXCEPTION 'Chat sequence cannot regress' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CONVERSATION_immutable_context" BEFORE UPDATE ON "CONVERSATION"
  FOR EACH ROW EXECUTE FUNCTION phase7a_chat_immutable_context();

CREATE FUNCTION phase7a_chat_immutable_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Moving a participant would otherwise check only the destination in the
  -- existing deferred exact-two trigger, leaving the source with missing members.
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Chat participant identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.last_delivered_sequence < OLD.last_delivered_sequence OR NEW.last_read_sequence < OLD.last_read_sequence THEN
    RAISE EXCEPTION 'Chat receipt watermarks cannot regress' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CONVERSATION_PARTICIPANT_monotonic_membership" BEFORE UPDATE ON "CONVERSATION_PARTICIPANT"
  FOR EACH ROW EXECUTE FUNCTION phase7a_chat_immutable_membership();

COMMIT;
