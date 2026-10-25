CREATE TYPE "PaymentEventProvider" AS ENUM ('MOCK', 'SEPAY_TEST');
CREATE TYPE "PaymentEventStatus" AS ENUM ('RECEIVED', 'APPLIED', 'REJECTED', 'IGNORED');

CREATE TABLE "PAYMENT_EVENT" (
  "payment_event_id" UUID NOT NULL,
  "provider" "PaymentEventProvider" NOT NULL,
  "provider_event_id" VARCHAR(120) NOT NULL,
  "bank_reference" VARCHAR(150),
  "payload_hash" CHAR(64) NOT NULL,
  "account_number" VARCHAR(30) NOT NULL,
  "gateway" VARCHAR(100) NOT NULL,
  "payment_reference" VARCHAR(50),
  "amount" DECIMAL(14,2) NOT NULL,
  "transfer_type" VARCHAR(3) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "status" "PaymentEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "reason" VARCHAR(100),
  "payment_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PAYMENT_EVENT_pkey" PRIMARY KEY ("payment_event_id"),
  CONSTRAINT "PAYMENT_EVENT_positive_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "PAYMENT_EVENT_direction_check" CHECK ("transfer_type" IN ('in', 'out')),
  CONSTRAINT "PAYMENT_EVENT_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "PAYMENT"("payment_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PAYMENT_EVENT_provider_provider_event_id_key" ON "PAYMENT_EVENT"("provider", "provider_event_id");
CREATE UNIQUE INDEX "PAYMENT_EVENT_bank_reference_key" ON "PAYMENT_EVENT"("provider", "account_number", "gateway", "bank_reference");
CREATE INDEX "PAYMENT_EVENT_status_created_at_idx" ON "PAYMENT_EVENT"("status", "created_at");
CREATE INDEX "PAYMENT_EVENT_payment_id_idx" ON "PAYMENT_EVENT"("payment_id");
