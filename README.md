# GomGoods Backend

Backend API for **GomGoods**, a C2C marketplace for Pop-Culture & ACG goods.

GomGoods connects buyers, individual sellers, and store sellers in a community-driven marketplace where users can discover, buy, sell, collect, and trade products.

## ✨ Core Features

- 👤 **User & Store Management** — Manage user accounts, store sellers, profiles, and seller reputation.
- 🛍️ **Marketplace** — Manage products, listings, categories, search, filtering, and product availability.
- 🛒 **Orders & Payments** — Handle carts, orders, order items, payment transactions, and refunds.
- 📦 **Shipping** — Manage shipments, shipment items, delivery status, and tracking.
- 🔨 **Auction** — Create auctions, place bids, and determine auction results.
- 💬 **Chat** — Support conversations and direct communication between users.
- ⭐ **Reviews & Collections** — Manage transaction reviews and saved products.
- 🗣️ **Forum** — Support community posts, comments, reactions, reports, and transaction discussions.
- 🎁 **Campaigns** — Manage community campaigns and participant contributions.
- ⚖️ **Disputes** — Handle transaction disputes and supporting evidence.
- 🛡️ **Support** — Provide user support and issue management.
- 🤖 **AI Support** — Assist with common user requests and transaction-related support.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| NestJS | Backend framework |
| TypeScript | Type-safe development |
| PostgreSQL | Relational database |
| Prisma | ORM and database access |
| REST API | Client-server communication |
| Vitest | Testing |

## 🏗️ Architecture

The backend follows a **modular monolith** architecture.

Business domains are organized into independent modules while sharing the same application and database infrastructure.

The backend provides APIs for the GomGoods frontend and is responsible for:

- Business logic
- Data validation
- Authentication & authorization
- Database operations
- Transaction processing
- Marketplace workflows
- Communication with external services

## 👥 Account Model

GomGoods distinguishes between:

- **User** — A registered account that can purchase products and sell personal items.
- **Store Seller** — A dedicated seller/store account operating as a storefront on the marketplace.

This allows the platform to support both peer-to-peer selling and established sellers.

## 🗄️ Database

The application uses **PostgreSQL** with **Prisma ORM**.

The database is designed around the core GomGoods domains, including:

- Users & Stores
- Products & Listings
- Orders & Payments
- Shipments
- Auctions & Bids
- Reviews & Collections
- Forum & Community
- Campaigns
- Disputes & Support
- Conversations & Messages

Database schema and migrations are managed through Prisma.

## 🔗 Frontend

The backend serves as the API layer for the GomGoods frontend.

```text
GomGoods Frontend
        │
        │ REST API
        ▼
GomGoods Backend
        │
        ▼
   PostgreSQL
```

## Phase 1 API

Implemented endpoints use the `/api` prefix:

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

Registration and login return a 15-minute Bearer access token. Phase 1 intentionally has no refresh token, persistent session, or server-side logout endpoint.

Successful responses use `{ "success": true, "data": ... }`. Errors use `{ "success": false, "error": { "code": "...", "message": "...", "details": [] } }`.

## Local setup

1. Install the lockfile dependencies with `npm ci`.
2. Copy `.env.example` to `.env` and replace every placeholder.
3. Start PostgreSQL with `docker compose -f docker-compose.dev.yml up -d`.
4. Apply the committed migration with `npm run db:migrate:deploy`.
5. Optionally seed local data with `npm run db:seed`.
6. Start the API with `npm run start:dev`.

`SEED_USER_PASSWORD` is shared by the three fixed local seed accounts and is hashed with Argon2 before storage. It is strictly a local-development credential and must never be reused in staging or production.

Swagger is available at `/api/docs` when `SWAGGER_ENABLED=true`. Keep it disabled or protected in production.

Authentication routes are limited in memory to five attempts per minute per tracker. A multi-instance production deployment must use a shared throttling store before launch.

## Verification

Use a separate PostgreSQL database whose name contains `test`. Copy `.env.test.example` to `.env.test`; `TEST_DATABASE_URL` must not equal `DATABASE_URL`. The e2e harness refuses cleanup unless these safeguards pass, and cleanup is limited to users created under the `@e2e.gomgoods.local` domain.

```text
npm run build
npm run lint
npm run test:unit
npm run test:e2e
```
