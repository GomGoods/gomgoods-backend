CREATE TYPE "SellingMode" AS ENUM ('FIXED_PRICE','AUCTION');
ALTER TYPE "AuctionStatus" ADD VALUE 'CLOSED_UNSOLD';
ALTER TYPE "AuctionStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "AuctionStatus" ADD VALUE 'SETTLED';
ALTER TYPE "AuctionStatus" ADD VALUE 'DEFAULTED';
ALTER TABLE "LISTING" ADD COLUMN "selling_mode" "SellingMode" NOT NULL DEFAULT 'FIXED_PRICE';
ALTER TABLE "AUCTION" ADD COLUMN "managed" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "original_end_time" TIMESTAMPTZ(3), ADD COLUMN "version" BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN "order_id" UUID,
 ADD CONSTRAINT "AUCTION_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDER"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "AUCTION_managed_config" CHECK (NOT managed OR (original_end_time IS NOT NULL AND original_end_time-start_time BETWEEN interval '1 hour' AND interval '7 days' AND end_time>=original_end_time AND end_time<=original_end_time+interval '30 minutes' AND starting_price=trunc(starting_price) AND bid_step=trunc(bid_step) AND version>0));
CREATE UNIQUE INDEX "AUCTION_order_id_key" ON "AUCTION"("order_id");
ALTER TABLE "BID" ADD COLUMN "idempotency_key" UUID, ADD COLUMN "sequence" BIGINT,
 ADD COLUMN "address_id" UUID, ADD COLUMN "shipping_snapshot" JSONB,
 ADD CONSTRAINT "BID_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "ADDRESS"("address_id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "BID_managed_payload" CHECK (idempotency_key IS NULL OR (sequence>0 AND address_id IS NOT NULL AND shipping_snapshot IS NOT NULL AND amount=trunc(amount)));
CREATE UNIQUE INDEX "BID_auction_id_user_id_idempotency_key_key" ON "BID"("auction_id","user_id","idempotency_key");
CREATE UNIQUE INDEX "BID_auction_id_sequence_key" ON "BID"("auction_id","sequence");
CREATE TABLE "AUCTION_EVENT" (
 "event_id" UUID NOT NULL PRIMARY KEY, "auction_id" UUID NOT NULL, "actor_id" UUID,
 "version" BIGINT NOT NULL, "action" VARCHAR(40) NOT NULL, "note" TEXT NOT NULL,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AUCTION_EVENT_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "AUCTION"("auction_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AUCTION_EVENT_auction_id_version_key" ON "AUCTION_EVENT"("auction_id","version");
CREATE TABLE "AUCTION_RATE_LIMIT" (
 "user_id" UUID NOT NULL, "operation" VARCHAR(30) NOT NULL, "count" INTEGER NOT NULL CHECK (count>0),
 "expires_at" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "AUCTION_RATE_LIMIT_pkey" PRIMARY KEY ("user_id","operation")
);
CREATE INDEX "AUCTION_RATE_LIMIT_expires_at_idx" ON "AUCTION_RATE_LIMIT"("expires_at");
