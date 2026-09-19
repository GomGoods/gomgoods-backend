-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ListingCondition" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RESERVED', 'SOLD', 'INACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'BANK_TRANSFER', 'E_WALLET', 'CREDIT_CARD', 'DEBIT_CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "ReactionType" AS ENUM ('LIKE', 'LOVE', 'WOW', 'SAD', 'ANGRY');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('USER', 'STORE', 'PRODUCT', 'LISTING', 'POST', 'COMMENT', 'MESSAGE');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "USER" (
    "user_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "account_type" "AccountType" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "USER_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ADDRESS" (
    "address_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipient" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "address_line" VARCHAR(255) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "district" VARCHAR(100) NOT NULL,
    "ward" VARCHAR(100) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ADDRESS_pkey" PRIMARY KEY ("address_id")
);

-- CreateTable
CREATE TABLE "STORE" (
    "store_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "store_name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "avatar_url" TEXT,
    "status" "StoreStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "STORE_pkey" PRIMARY KEY ("store_id")
);

-- CreateTable
CREATE TABLE "FOLLOW" (
    "follow_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FOLLOW_pkey" PRIMARY KEY ("follow_id")
);

-- CreateTable
CREATE TABLE "CATEGORY" (
    "category_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CATEGORY_pkey" PRIMARY KEY ("category_id")
);

-- CreateTable
CREATE TABLE "PRODUCT" (
    "product_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PRODUCT_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "LISTING" (
    "listing_id" UUID NOT NULL,
    "product_id" UUID,
    "seller_user_id" UUID,
    "price" DECIMAL(14,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "ListingCondition" NOT NULL,
    "description" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LISTING_pkey" PRIMARY KEY ("listing_id")
);

-- CreateTable
CREATE TABLE "LISTING_IMAGE" (
    "image_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "image_url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LISTING_IMAGE_pkey" PRIMARY KEY ("image_id")
);

-- CreateTable
CREATE TABLE "COLLECTION" (
    "collection_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "COLLECTION_pkey" PRIMARY KEY ("collection_id")
);

-- CreateTable
CREATE TABLE "COLLECTION_ITEM" (
    "collection_item_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "COLLECTION_ITEM_pkey" PRIMARY KEY ("collection_item_id")
);

-- CreateTable
CREATE TABLE "ORDER" (
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "address_id" UUID NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ORDER_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "ORDER_ITEM" (
    "order_item_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "ORDER_ITEM_pkey" PRIMARY KEY ("order_item_id")
);

-- CreateTable
CREATE TABLE "PAYMENT" (
    "payment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PAYMENT_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "TRANSACTION" (
    "transaction_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "transaction_code" VARCHAR(150) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TRANSACTION_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "SHIPMENT" (
    "shipment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_user_id" UUID,
    "store_id" UUID,
    "carrier" VARCHAR(100) NOT NULL,
    "tracking_number" VARCHAR(150),
    "shipping_fee" DECIMAL(14,2) NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "shipped_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SHIPMENT_pkey" PRIMARY KEY ("shipment_id")
);

-- CreateTable
CREATE TABLE "SHIPMENT_ITEM" (
    "shipment_item_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "SHIPMENT_ITEM_pkey" PRIMARY KEY ("shipment_item_id")
);

-- CreateTable
CREATE TABLE "AUCTION" (
    "auction_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "starting_price" DECIMAL(14,2) NOT NULL,
    "bid_step" DECIMAL(14,2) NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "winner_id" UUID,
    "winning_bid" DECIMAL(14,2),
    "status" "AuctionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AUCTION_pkey" PRIMARY KEY ("auction_id")
);

-- CreateTable
CREATE TABLE "BID" (
    "bid_id" UUID NOT NULL,
    "auction_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BID_pkey" PRIMARY KEY ("bid_id")
);

-- CreateTable
CREATE TABLE "DISPUTE" (
    "dispute_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID,
    "user_id" UUID NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "DISPUTE_pkey" PRIMARY KEY ("dispute_id")
);

-- CreateTable
CREATE TABLE "DISPUTE_EVIDENCE" (
    "evidence_id" UUID NOT NULL,
    "dispute_id" UUID NOT NULL,
    "evidence_url" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DISPUTE_EVIDENCE_pkey" PRIMARY KEY ("evidence_id")
);

-- CreateTable
CREATE TABLE "CAMPAIGN" (
    "campaign_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CAMPAIGN_pkey" PRIMARY KEY ("campaign_id")
);

-- CreateTable
CREATE TABLE "CAMPAIGN_PARTICIPANT" (
    "participant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CAMPAIGN_PARTICIPANT_pkey" PRIMARY KEY ("participant_id")
);

-- CreateTable
CREATE TABLE "POST" (
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "content" TEXT NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "POST_pkey" PRIMARY KEY ("post_id")
);

-- CreateTable
CREATE TABLE "COMMENT" (
    "comment_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "COMMENT_pkey" PRIMARY KEY ("comment_id")
);

-- CreateTable
CREATE TABLE "REACTION" (
    "reaction_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "ReactionType" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "REACTION_pkey" PRIMARY KEY ("reaction_id")
);

-- CreateTable
CREATE TABLE "CONVERSATION" (
    "conversation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CONVERSATION_pkey" PRIMARY KEY ("conversation_id")
);

-- CreateTable
CREATE TABLE "CONVERSATION_PARTICIPANT" (
    "participant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CONVERSATION_PARTICIPANT_pkey" PRIMARY KEY ("participant_id")
);

-- CreateTable
CREATE TABLE "MESSAGE" (
    "message_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MESSAGE_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "REVIEW" (
    "review_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_rating" SMALLINT,
    "seller_rating" SMALLINT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "REVIEW_pkey" PRIMARY KEY ("review_id")
);

-- CreateTable
CREATE TABLE "REPORT" (
    "report_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_type" "ReportTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "content" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "REPORT_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "SUPPORT_TICKET" (
    "ticket_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject" VARCHAR(250) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SUPPORT_TICKET_pkey" PRIMARY KEY ("ticket_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "USER_email_key" ON "USER"("email");

-- CreateIndex
CREATE UNIQUE INDEX "USER_username_key" ON "USER"("username");

-- CreateIndex
CREATE INDEX "ADDRESS_user_id_idx" ON "ADDRESS"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "STORE_user_id_key" ON "STORE"("user_id");

-- CreateIndex
CREATE INDEX "STORE_status_idx" ON "STORE"("status");

-- CreateIndex
CREATE INDEX "FOLLOW_store_id_idx" ON "FOLLOW"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "FOLLOW_user_id_store_id_key" ON "FOLLOW"("user_id", "store_id");

-- CreateIndex
CREATE INDEX "CATEGORY_status_idx" ON "CATEGORY"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CATEGORY_parent_id_name_key" ON "CATEGORY"("parent_id", "name");

-- CreateIndex
CREATE INDEX "PRODUCT_store_id_status_idx" ON "PRODUCT"("store_id", "status");

-- CreateIndex
CREATE INDEX "PRODUCT_category_id_status_idx" ON "PRODUCT"("category_id", "status");

-- CreateIndex
CREATE INDEX "LISTING_product_id_status_idx" ON "LISTING"("product_id", "status");

-- CreateIndex
CREATE INDEX "LISTING_seller_user_id_status_idx" ON "LISTING"("seller_user_id", "status");

-- CreateIndex
CREATE INDEX "LISTING_status_created_at_idx" ON "LISTING"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "LISTING_IMAGE_listing_id_sort_order_key" ON "LISTING_IMAGE"("listing_id", "sort_order");

-- CreateIndex
CREATE INDEX "COLLECTION_user_id_created_at_idx" ON "COLLECTION"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "COLLECTION_ITEM_listing_id_idx" ON "COLLECTION_ITEM"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "COLLECTION_ITEM_collection_id_listing_id_key" ON "COLLECTION_ITEM"("collection_id", "listing_id");

-- CreateIndex
CREATE INDEX "ORDER_user_id_created_at_idx" ON "ORDER"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ORDER_status_created_at_idx" ON "ORDER"("status", "created_at");

-- CreateIndex
CREATE INDEX "ORDER_ITEM_listing_id_idx" ON "ORDER_ITEM"("listing_id");

-- CreateIndex
CREATE INDEX "PAYMENT_order_id_status_idx" ON "PAYMENT"("order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TRANSACTION_transaction_code_key" ON "TRANSACTION"("transaction_code");

-- CreateIndex
CREATE INDEX "TRANSACTION_payment_id_created_at_idx" ON "TRANSACTION"("payment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "SHIPMENT_tracking_number_key" ON "SHIPMENT"("tracking_number");

-- CreateIndex
CREATE INDEX "SHIPMENT_order_id_status_idx" ON "SHIPMENT"("order_id", "status");

-- CreateIndex
CREATE INDEX "SHIPMENT_seller_user_id_idx" ON "SHIPMENT"("seller_user_id");

-- CreateIndex
CREATE INDEX "SHIPMENT_store_id_idx" ON "SHIPMENT"("store_id");

-- CreateIndex
CREATE INDEX "SHIPMENT_ITEM_order_item_id_idx" ON "SHIPMENT_ITEM"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "SHIPMENT_ITEM_shipment_id_order_item_id_key" ON "SHIPMENT_ITEM"("shipment_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "AUCTION_listing_id_key" ON "AUCTION"("listing_id");

-- CreateIndex
CREATE INDEX "AUCTION_status_end_time_idx" ON "AUCTION"("status", "end_time");

-- CreateIndex
CREATE INDEX "BID_auction_id_created_at_idx" ON "BID"("auction_id", "created_at");

-- CreateIndex
CREATE INDEX "BID_user_id_created_at_idx" ON "BID"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "DISPUTE_order_id_status_idx" ON "DISPUTE"("order_id", "status");

-- CreateIndex
CREATE INDEX "DISPUTE_user_id_created_at_idx" ON "DISPUTE"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "DISPUTE_EVIDENCE_dispute_id_idx" ON "DISPUTE_EVIDENCE"("dispute_id");

-- CreateIndex
CREATE INDEX "CAMPAIGN_status_start_time_idx" ON "CAMPAIGN"("status", "start_time");

-- CreateIndex
CREATE INDEX "CAMPAIGN_PARTICIPANT_user_id_idx" ON "CAMPAIGN_PARTICIPANT"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "CAMPAIGN_PARTICIPANT_campaign_id_user_id_key" ON "CAMPAIGN_PARTICIPANT"("campaign_id", "user_id");

-- CreateIndex
CREATE INDEX "POST_status_created_at_idx" ON "POST"("status", "created_at");

-- CreateIndex
CREATE INDEX "POST_user_id_created_at_idx" ON "POST"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "COMMENT_post_id_created_at_idx" ON "COMMENT"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "COMMENT_user_id_idx" ON "COMMENT"("user_id");

-- CreateIndex
CREATE INDEX "REACTION_user_id_idx" ON "REACTION"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "REACTION_post_id_user_id_key" ON "REACTION"("post_id", "user_id");

-- CreateIndex
CREATE INDEX "CONVERSATION_PARTICIPANT_user_id_joined_at_idx" ON "CONVERSATION_PARTICIPANT"("user_id", "joined_at");

-- CreateIndex
CREATE UNIQUE INDEX "CONVERSATION_PARTICIPANT_conversation_id_user_id_key" ON "CONVERSATION_PARTICIPANT"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "MESSAGE_conversation_id_sent_at_idx" ON "MESSAGE"("conversation_id", "sent_at");

-- CreateIndex
CREATE INDEX "MESSAGE_sender_id_idx" ON "MESSAGE"("sender_id");

-- CreateIndex
CREATE UNIQUE INDEX "REVIEW_order_item_id_key" ON "REVIEW"("order_item_id");

-- CreateIndex
CREATE INDEX "REVIEW_user_id_created_at_idx" ON "REVIEW"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "REPORT_target_type_target_id_idx" ON "REPORT"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "REPORT_status_created_at_idx" ON "REPORT"("status", "created_at");

-- CreateIndex
CREATE INDEX "SUPPORT_TICKET_user_id_status_idx" ON "SUPPORT_TICKET"("user_id", "status");

-- CreateIndex
CREATE INDEX "SUPPORT_TICKET_status_created_at_idx" ON "SUPPORT_TICKET"("status", "created_at");

-- AddForeignKey
ALTER TABLE "ADDRESS" ADD CONSTRAINT "ADDRESS_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "STORE" ADD CONSTRAINT "STORE_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FOLLOW" ADD CONSTRAINT "FOLLOW_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FOLLOW" ADD CONSTRAINT "FOLLOW_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "STORE"("store_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CATEGORY" ADD CONSTRAINT "CATEGORY_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "CATEGORY"("category_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PRODUCT" ADD CONSTRAINT "PRODUCT_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "STORE"("store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PRODUCT" ADD CONSTRAINT "PRODUCT_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "CATEGORY"("category_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LISTING" ADD CONSTRAINT "LISTING_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "PRODUCT"("product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LISTING" ADD CONSTRAINT "LISTING_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LISTING_IMAGE" ADD CONSTRAINT "LISTING_IMAGE_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "LISTING"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "COLLECTION" ADD CONSTRAINT "COLLECTION_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "COLLECTION_ITEM" ADD CONSTRAINT "COLLECTION_ITEM_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "COLLECTION"("collection_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "COLLECTION_ITEM" ADD CONSTRAINT "COLLECTION_ITEM_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "LISTING"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDER" ADD CONSTRAINT "ORDER_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDER" ADD CONSTRAINT "ORDER_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "ADDRESS"("address_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDER_ITEM" ADD CONSTRAINT "ORDER_ITEM_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDER"("order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDER_ITEM" ADD CONSTRAINT "ORDER_ITEM_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "LISTING"("listing_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PAYMENT" ADD CONSTRAINT "PAYMENT_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDER"("order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TRANSACTION" ADD CONSTRAINT "TRANSACTION_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "PAYMENT"("payment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SHIPMENT" ADD CONSTRAINT "SHIPMENT_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDER"("order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SHIPMENT" ADD CONSTRAINT "SHIPMENT_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SHIPMENT" ADD CONSTRAINT "SHIPMENT_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "STORE"("store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SHIPMENT_ITEM" ADD CONSTRAINT "SHIPMENT_ITEM_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "SHIPMENT"("shipment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SHIPMENT_ITEM" ADD CONSTRAINT "SHIPMENT_ITEM_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "ORDER_ITEM"("order_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AUCTION" ADD CONSTRAINT "AUCTION_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "LISTING"("listing_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AUCTION" ADD CONSTRAINT "AUCTION_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BID" ADD CONSTRAINT "BID_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "AUCTION"("auction_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BID" ADD CONSTRAINT "BID_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DISPUTE" ADD CONSTRAINT "DISPUTE_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ORDER"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DISPUTE" ADD CONSTRAINT "DISPUTE_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "ORDER_ITEM"("order_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DISPUTE" ADD CONSTRAINT "DISPUTE_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DISPUTE_EVIDENCE" ADD CONSTRAINT "DISPUTE_EVIDENCE_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "DISPUTE"("dispute_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CAMPAIGN_PARTICIPANT" ADD CONSTRAINT "CAMPAIGN_PARTICIPANT_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "CAMPAIGN"("campaign_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CAMPAIGN_PARTICIPANT" ADD CONSTRAINT "CAMPAIGN_PARTICIPANT_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POST" ADD CONSTRAINT "POST_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "COMMENT" ADD CONSTRAINT "COMMENT_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "POST"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "COMMENT" ADD CONSTRAINT "COMMENT_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "REACTION" ADD CONSTRAINT "REACTION_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "POST"("post_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "REACTION" ADD CONSTRAINT "REACTION_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CONVERSATION_PARTICIPANT" ADD CONSTRAINT "CONVERSATION_PARTICIPANT_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "CONVERSATION"("conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CONVERSATION_PARTICIPANT" ADD CONSTRAINT "CONVERSATION_PARTICIPANT_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MESSAGE" ADD CONSTRAINT "MESSAGE_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "CONVERSATION"("conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MESSAGE" ADD CONSTRAINT "MESSAGE_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "REVIEW" ADD CONSTRAINT "REVIEW_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "ORDER_ITEM"("order_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "REVIEW" ADD CONSTRAINT "REVIEW_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "REPORT" ADD CONSTRAINT "REPORT_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SUPPORT_TICKET" ADD CONSTRAINT "SUPPORT_TICKET_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business constraints that Prisma schema cannot express directly.
ALTER TABLE "LISTING"
  ADD CONSTRAINT "LISTING_exactly_one_source_check"
  CHECK (("product_id" IS NOT NULL) <> ("seller_user_id" IS NOT NULL)),
  ADD CONSTRAINT "LISTING_non_negative_price_check"
  CHECK ("price" >= 0),
  ADD CONSTRAINT "LISTING_positive_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "SHIPMENT"
  ADD CONSTRAINT "SHIPMENT_exactly_one_seller_check"
  CHECK (("seller_user_id" IS NOT NULL) <> ("store_id" IS NOT NULL)),
  ADD CONSTRAINT "SHIPMENT_non_negative_fee_check"
  CHECK ("shipping_fee" >= 0);

ALTER TABLE "ORDER"
  ADD CONSTRAINT "ORDER_non_negative_total_check"
  CHECK ("total_amount" >= 0);

ALTER TABLE "ORDER_ITEM"
  ADD CONSTRAINT "ORDER_ITEM_positive_quantity_check"
  CHECK ("quantity" > 0),
  ADD CONSTRAINT "ORDER_ITEM_non_negative_amounts_check"
  CHECK ("unit_price" >= 0 AND "subtotal" >= 0);

ALTER TABLE "PAYMENT"
  ADD CONSTRAINT "PAYMENT_non_negative_amount_check"
  CHECK ("amount" >= 0);

ALTER TABLE "TRANSACTION"
  ADD CONSTRAINT "TRANSACTION_non_negative_amount_check"
  CHECK ("amount" >= 0);

ALTER TABLE "SHIPMENT_ITEM"
  ADD CONSTRAINT "SHIPMENT_ITEM_positive_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "AUCTION"
  ADD CONSTRAINT "AUCTION_positive_prices_check"
  CHECK ("starting_price" >= 0 AND "bid_step" > 0),
  ADD CONSTRAINT "AUCTION_valid_time_window_check"
  CHECK ("end_time" > "start_time"),
  ADD CONSTRAINT "AUCTION_winner_bid_pair_check"
  CHECK (("winner_id" IS NULL) = ("winning_bid" IS NULL));

ALTER TABLE "BID"
  ADD CONSTRAINT "BID_positive_amount_check"
  CHECK ("amount" > 0);

ALTER TABLE "CAMPAIGN"
  ADD CONSTRAINT "CAMPAIGN_valid_time_window_check"
  CHECK ("end_time" > "start_time");

ALTER TABLE "REVIEW"
  ADD CONSTRAINT "REVIEW_rating_range_check"
  CHECK (
    ("product_rating" IS NULL OR "product_rating" BETWEEN 1 AND 5)
    AND ("seller_rating" IS NULL OR "seller_rating" BETWEEN 1 AND 5)
    AND ("product_rating" IS NOT NULL OR "seller_rating" IS NOT NULL)
  );

-- One default address is allowed per user, while keeping non-default addresses unlimited.
CREATE UNIQUE INDEX "ADDRESS_one_default_per_user_key"
  ON "ADDRESS" ("user_id")
  WHERE "is_default";

