-- Phase 5 commerce foundation: carts, checkout groups, order seller scope,
-- inventory decrement to zero, and immutable order snapshots.

-- CreateTable
CREATE TABLE "CART" (
    "cart_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CART_pkey" PRIMARY KEY ("cart_id")
);

-- CreateTable
CREATE TABLE "CART_ITEM" (
    "cart_item_id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CART_ITEM_pkey" PRIMARY KEY ("cart_item_id")
);

-- CreateTable
CREATE TABLE "CHECKOUT_GROUP" (
    "checkout_group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CHECKOUT_GROUP_pkey" PRIMARY KEY ("checkout_group_id")
);

-- AlterTable
ALTER TABLE "ORDER"
  ADD COLUMN "checkout_group_id" UUID,
  ADD COLUMN "seller_user_id" UUID,
  ADD COLUMN "store_id" UUID,
  ADD COLUMN "payment_method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
  ADD COLUMN "expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancel_reason" TEXT,
  ADD COLUMN "shipping_recipient" VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN "shipping_phone" VARCHAR(30) NOT NULL DEFAULT '',
  ADD COLUMN "shipping_address_line" VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN "shipping_city" VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN "shipping_district" VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN "shipping_ward" VARCHAR(100) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ORDER_ITEM"
  ADD COLUMN "listing_description_snapshot" TEXT,
  ADD COLUMN "product_id_snapshot" UUID,
  ADD COLUMN "product_name_snapshot" VARCHAR(200),
  ADD COLUMN "store_name_snapshot" VARCHAR(150),
  ADD COLUMN "seller_username_snapshot" VARCHAR(50);

-- Listing inventory can reach zero after checkout while seller-facing APIs still require >= 1.
ALTER TABLE "LISTING"
  DROP CONSTRAINT IF EXISTS "LISTING_positive_quantity_check";

ALTER TABLE "LISTING"
  ADD CONSTRAINT "LISTING_non_negative_quantity_check"
  CHECK ("quantity" >= 0);

-- Constraints
ALTER TABLE "CART_ITEM"
  ADD CONSTRAINT "CART_ITEM_positive_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "ORDER"
  ADD CONSTRAINT "ORDER_phase5_seller_source_check"
  CHECK (
    "checkout_group_id" IS NULL
    OR (("seller_user_id" IS NOT NULL) <> ("store_id" IS NOT NULL))
  );

ALTER TABLE "CHECKOUT_GROUP"
  ADD CONSTRAINT "CHECKOUT_GROUP_non_negative_total_check"
  CHECK ("total_amount" >= 0);

-- UniqueIndexes
CREATE UNIQUE INDEX "CART_user_id_key" ON "CART"("user_id");
CREATE UNIQUE INDEX "CART_ITEM_cart_id_listing_id_key" ON "CART_ITEM"("cart_id", "listing_id");
CREATE UNIQUE INDEX "CHECKOUT_GROUP_user_id_idempotency_key_key" ON "CHECKOUT_GROUP"("user_id", "idempotency_key");

-- Indexes
CREATE INDEX "CART_ITEM_listing_id_idx" ON "CART_ITEM"("listing_id");
CREATE INDEX "CHECKOUT_GROUP_user_id_created_at_idx" ON "CHECKOUT_GROUP"("user_id", "created_at");
CREATE INDEX "ORDER_checkout_group_id_idx" ON "ORDER"("checkout_group_id");
CREATE INDEX "ORDER_seller_user_id_created_at_idx" ON "ORDER"("seller_user_id", "created_at");
CREATE INDEX "ORDER_store_id_created_at_idx" ON "ORDER"("store_id", "created_at");
CREATE INDEX "ORDER_status_expires_at_idx" ON "ORDER"("status", "expires_at");

-- ForeignKeys
ALTER TABLE "CART"
  ADD CONSTRAINT "CART_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CART_ITEM"
  ADD CONSTRAINT "CART_ITEM_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "CART"("cart_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CART_ITEM"
  ADD CONSTRAINT "CART_ITEM_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "LISTING"("listing_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CHECKOUT_GROUP"
  ADD CONSTRAINT "CHECKOUT_GROUP_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ORDER"
  ADD CONSTRAINT "ORDER_checkout_group_id_fkey"
  FOREIGN KEY ("checkout_group_id") REFERENCES "CHECKOUT_GROUP"("checkout_group_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ORDER"
  ADD CONSTRAINT "ORDER_seller_user_id_fkey"
  FOREIGN KEY ("seller_user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ORDER"
  ADD CONSTRAINT "ORDER_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "STORE"("store_id") ON DELETE RESTRICT ON UPDATE CASCADE;
