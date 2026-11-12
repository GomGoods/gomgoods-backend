-- Additive extension of the existing campaign domain. Legacy rows remain unchanged
-- and are excluded from Phase 7C discovery until adopted by an ADMIN.
CREATE TYPE "CampaignType" AS ENUM ('COMMUNITY_EVENT', 'ITEM_DONATION', 'COMMUNITY_CHALLENGE');
CREATE TYPE "ParticipationStatus" AS ENUM ('REGISTERED', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'WITHDRAWN', 'REVOKED');
ALTER TABLE "CAMPAIGN"
 ADD COLUMN "type" "CampaignType" NOT NULL DEFAULT 'COMMUNITY_EVENT',
 ADD COLUMN "organizer_id" UUID,
 ADD COLUMN "instructions" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "completion_criteria" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "eligibility" TEXT NOT NULL DEFAULT 'Tài khoản USER đang hoạt động',
 ADD COLUMN "minimum_account_age_days" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "participation_limit" INTEGER,
 ADD CONSTRAINT "CAMPAIGN_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "CAMPAIGN_phase7c_policy" CHECK (organizer_id IS NULL OR (end_time > start_time AND minimum_account_age_days BETWEEN 0 AND 3650 AND (participation_limit IS NULL OR participation_limit BETWEEN 1 AND 100000) AND length(btrim(instructions))>0 AND length(btrim(completion_criteria))>0));
CREATE INDEX "CAMPAIGN_created_at_campaign_id_idx" ON "CAMPAIGN"("created_at", "campaign_id");
ALTER TABLE "CAMPAIGN_PARTICIPANT"
 ADD COLUMN "status" "ParticipationStatus" NOT NULL DEFAULT 'REGISTERED',
 ADD COLUMN "evidence_text" TEXT,
 ADD COLUMN "evidence_url" TEXT,
 ADD COLUMN "submission_key" UUID,
 ADD COLUMN "submitted_at" TIMESTAMPTZ(3),
 ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD CONSTRAINT "CAMPAIGN_PARTICIPANT_submission" CHECK (status NOT IN ('SUBMITTED','VERIFIED','REJECTED','REVOKED') OR (submitted_at IS NOT NULL AND submission_key IS NOT NULL AND evidence_text IS NOT NULL));
CREATE INDEX "CAMPAIGN_PARTICIPANT_campaign_id_status_joined_at_participant_i_idx" ON "CAMPAIGN_PARTICIPANT"("campaign_id", "status", "joined_at", "participant_id");
CREATE TABLE "CAMPAIGN_AUDIT" (
 "action_id" UUID NOT NULL,
 "campaign_id" UUID NOT NULL,
 "participant_id" UUID,
 "actor_id" UUID NOT NULL,
 "action" VARCHAR(30) NOT NULL,
 "from_status" VARCHAR(30),
 "to_status" VARCHAR(30) NOT NULL,
 "note" TEXT NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CAMPAIGN_AUDIT_pkey" PRIMARY KEY ("action_id"),
 CONSTRAINT "CAMPAIGN_AUDIT_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "CAMPAIGN"("campaign_id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CAMPAIGN_AUDIT_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "CAMPAIGN_PARTICIPANT"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CAMPAIGN_AUDIT_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CAMPAIGN_AUDIT_campaign_id_created_at_action_id_idx" ON "CAMPAIGN_AUDIT"("campaign_id", "created_at", "action_id");
CREATE TABLE "CAMPAIGN_ACHIEVEMENT" (
 "achievement_id" UUID NOT NULL,
 "participant_id" UUID NOT NULL,
 "verification_id" UUID NOT NULL,
 "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "revoked_at" TIMESTAMPTZ(3),
 "featured_slot" SMALLINT,
 CONSTRAINT "CAMPAIGN_ACHIEVEMENT_pkey" PRIMARY KEY ("achievement_id"),
 CONSTRAINT "CAMPAIGN_ACHIEVEMENT_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "CAMPAIGN_PARTICIPANT"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CAMPAIGN_ACHIEVEMENT_verification_id_fkey" FOREIGN KEY ("verification_id") REFERENCES "CAMPAIGN_AUDIT"("action_id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CAMPAIGN_ACHIEVEMENT_featured_slot_check" CHECK (featured_slot IS NULL OR (featured_slot BETWEEN 1 AND 3 AND revoked_at IS NULL))
);
CREATE UNIQUE INDEX "CAMPAIGN_ACHIEVEMENT_participant_id_key" ON "CAMPAIGN_ACHIEVEMENT"("participant_id");
CREATE UNIQUE INDEX "CAMPAIGN_ACHIEVEMENT_verification_id_key" ON "CAMPAIGN_ACHIEVEMENT"("verification_id");
CREATE TABLE "CAMPAIGN_RATE_LIMIT" (
 "user_id" UUID NOT NULL,
 "operation" VARCHAR(30) NOT NULL,
 "request_count" INTEGER NOT NULL CHECK (request_count>0),
 "expires_at" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "CAMPAIGN_RATE_LIMIT_pkey" PRIMARY KEY ("user_id", "operation")
);
CREATE INDEX "CAMPAIGN_RATE_LIMIT_expires_at_idx" ON "CAMPAIGN_RATE_LIMIT"("expires_at");
