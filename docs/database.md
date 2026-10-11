# GomGoods database setup

## Development quick start

1. Run "npm install". The postinstall hook generates the ignored Prisma Client automatically.
2. Copy .env.example to .env.
3. Start PostgreSQL with "docker compose -f docker-compose.dev.yml up -d", or create a local PostgreSQL database that matches DATABASE_URL.
4. Run "npm run db:migrate:deploy".
5. Run "npm run db:seed".

Useful checks:

- "npm run prisma:validate" validates the Prisma schema without a database connection.
- "npm run db:migrate:deploy" applies committed migrations (use it in CI/deployment).
- "npm run db:studio" opens Prisma Studio.

## ERD mapping and decisions

- All primary keys and foreign keys use PostgreSQL uuid. Prisma model names are singular PascalCase, while physical tables and columns are mapped to the ERD names; for example, User maps to USER and id maps to user_id.
- A User remains separate from a Store. STORE.user_id is unique, so one user can own at most one store; a personal seller uses LISTING.seller_user_id and never requires a store.
- LISTING has exactly one source: either product_id for a Store Seller listing or seller_user_id for a personal listing. The initial migration adds a PostgreSQL XOR check.
- An Order owns many OrderItem records and may own many Shipment records. Each Shipment has exactly one seller source (seller_user_id XOR store_id) and can contain multiple ShipmentItem records.
- Payment has a one-to-many relationship to Transaction, so failed and successful provider attempts are retained. transaction_code is unique for provider idempotency.
- Review belongs to exactly one OrderItem, so one purchased item can receive at most one review. Both product and seller ratings are optional individually, but at least one rating is required and any supplied rating must be from 1 to 5.
- Join tables enforce the ERD's duplicate rules: Follow, CollectionItem, CampaignParticipant, ConversationParticipant, Reaction, ListingImage, and ShipmentItem have composite unique constraints.
- Report.target_id is deliberately a polymorphic uuid: its FK depends on target_type and therefore cannot be represented as one relational FK. The service that creates a report must validate that the target exists and matches its type.
- AuthSession is a user's server-side authentication family. Its fixed expires_at value is never extended by refresh. current_generation is advanced atomically, and revoked_at plus revocation_reason invalidate every access and refresh credential in that family.
- RefreshCredential stores only a SHA-256 digest of a 256-bit random secret. Its composite key records every generation so reuse can be distinguished from the current credential without storing raw refresh tokens. Deleting an AuthSession cascades to its credential history.

## Rules enforced by service transactions

The database enforces static integrity constraints. The following rules depend on current state and must be executed in a transaction in the relevant NestJS service:

- A bid amount must be greater than the latest bid (or the starting price) and must respect bid_step. Lock the auction row or use serializable isolation before inserting the bid.
- The sum of ShipmentItem.quantity for an OrderItem must not exceed its ordered quantity.
- Order.total_amount, OrderItem.subtotal, payment amounts, and listing inventory changes must be calculated and validated server-side; do not accept client totals as authoritative.
- The order address must belong to the ordering user, and an order item's listing must belong to the seller/store assigned to its shipment.

## Seed contents

"npm run db:seed" is idempotent and uses fixed development-only UUIDs. It creates three users, one store, product and personal listings, a collection, an order with two items and two shipments, a payment with failed/successful transaction attempts, an auction with bids, a dispute, campaign participation, forum data, conversation, report, and support ticket. Seed user passwords are read from `SEED_USER_PASSWORD` and stored as Argon2 hashes. This credential is local-development-only and must never be reused in another environment.

## Authentication-session retention

Expired and revoked sessions are rejected by application queries immediately. Phase 2 intentionally does not add a scheduler or external cleanup service. Session rows and their credential history remain available for security investigation until a separately approved maintenance job removes records past an operational retention cutoff.
