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