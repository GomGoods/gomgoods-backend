BEGIN;

-- Independent, expiring operational state only. No existing table, data,
-- foreign key, trigger or applied migration is changed by this migration.
CREATE TABLE "FORUM_RATE_LIMIT" (
  user_id UUID NOT NULL,
  operation VARCHAR(30) NOT NULL,
  request_count INTEGER NOT NULL,
  window_started_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "FORUM_RATE_LIMIT_pkey" PRIMARY KEY (user_id, operation),
  CONSTRAINT "FORUM_RATE_LIMIT_operation_check" CHECK (operation IN
    ('post','edit','delete','comment','comment-edit','comment-delete','like','report','moderation')),
  CONSTRAINT "FORUM_RATE_LIMIT_count_check" CHECK (request_count BETWEEN 1 AND 1000),
  CONSTRAINT "FORUM_RATE_LIMIT_window_check" CHECK
    (expires_at > window_started_at AND expires_at <= window_started_at + INTERVAL '10 minutes')
);
CREATE INDEX "FORUM_RATE_LIMIT_expires_at_idx" ON "FORUM_RATE_LIMIT"(expires_at);

COMMIT;
