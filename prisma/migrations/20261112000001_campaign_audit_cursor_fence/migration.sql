-- Monotonic audit watermark for stable discovery/history cursors. No historical
-- migration is edited. Publication serializes allocation through commit.
ALTER TABLE "CAMPAIGN_AUDIT" ADD COLUMN "sequence" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "CAMPAIGN_AUDIT_sequence_key" ON "CAMPAIGN_AUDIT"("sequence");
