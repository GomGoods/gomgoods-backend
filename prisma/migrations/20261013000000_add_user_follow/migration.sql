-- CreateTable
CREATE TABLE "USER_FOLLOW" (
    "follower_id" UUID NOT NULL,
    "following_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "USER_FOLLOW_pkey" PRIMARY KEY ("follower_id", "following_id")
);

-- CreateIndex
CREATE INDEX "USER_FOLLOW_following_id_idx" ON "USER_FOLLOW"("following_id");

-- CreateIndex
CREATE INDEX "USER_FOLLOW_follower_id_created_at_idx" ON "USER_FOLLOW"("follower_id", "created_at");

-- AddForeignKey
ALTER TABLE "USER_FOLLOW" ADD CONSTRAINT "USER_FOLLOW_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "USER_FOLLOW" ADD CONSTRAINT "USER_FOLLOW_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Business constraints that Prisma schema cannot express directly.
ALTER TABLE "USER_FOLLOW"
  ADD CONSTRAINT "USER_FOLLOW_no_self_follow_check"
  CHECK ("follower_id" <> "following_id");
