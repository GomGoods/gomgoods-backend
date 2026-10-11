-- CreateTable
CREATE TABLE "AUTH_SESSION" (
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "current_generation" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" VARCHAR(40),

    CONSTRAINT "AUTH_SESSION_pkey" PRIMARY KEY ("session_id"),
    CONSTRAINT "AUTH_SESSION_generation_nonnegative" CHECK ("current_generation" >= 0),
    CONSTRAINT "AUTH_SESSION_expiry_after_creation" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "AUTH_SESSION_revocation_consistent" CHECK (
        ("revoked_at" IS NULL AND "revocation_reason" IS NULL)
        OR ("revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "REFRESH_CREDENTIAL" (
    "session_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "REFRESH_CREDENTIAL_pkey" PRIMARY KEY ("session_id", "generation"),
    CONSTRAINT "REFRESH_CREDENTIAL_generation_nonnegative" CHECK ("generation" >= 0)
);

-- CreateIndex
CREATE INDEX "AUTH_SESSION_user_id_revoked_at_idx" ON "AUTH_SESSION"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "AUTH_SESSION_expires_at_idx" ON "AUTH_SESSION"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "REFRESH_CREDENTIAL_token_hash_key" ON "REFRESH_CREDENTIAL"("token_hash");

-- AddForeignKey
ALTER TABLE "AUTH_SESSION" ADD CONSTRAINT "AUTH_SESSION_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "USER"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "REFRESH_CREDENTIAL" ADD CONSTRAINT "REFRESH_CREDENTIAL_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "AUTH_SESSION"("session_id") ON DELETE CASCADE ON UPDATE CASCADE;
