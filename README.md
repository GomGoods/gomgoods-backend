# GomGoods Backend

Backend API for **GomGoods**, a C2C marketplace focused on anime, manga, games, and pop-culture collectibles.

GomGoods supports individual sellers and storefronts, bringing product discovery, buying, selling, and community features into one platform.

This repository contains the backend services, database schema, and business logic powering the application.

## Tech Stack

- **Framework:** NestJS, TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma
- **API:** REST, Socket.IO
- **Payments:** SePay, VietQR
- **Testing:** Vitest, PostgreSQL E2E
- **Development:** Docker, Git

## Features

- User authentication and session management
- Personal listings and store management
- Product discovery, search, and filtering
- Cart, checkout, orders, and shipments
- Payment processing and webhook verification
- Real-time buyer–seller messaging
- Community forums and moderation
- Community campaigns and achievements
- Product auctions and bidding
- Image upload and media management

## Architecture

The backend uses a modular NestJS architecture, with separate modules for authentication, marketplace operations, transactions, messaging, and community features.

Prisma manages database access and migrations, while PostgreSQL stores application data.

REST APIs handle standard requests, and Socket.IO supports real-time interactions such as messaging and auctions.

## Getting Started

### Requirements

- Node.js 22.23.4
- npm
- Docker Desktop
- PostgreSQL

### Installation

```bash
git clone https://github.com/Alight09004/gomgoods-backend.git
cd gomgoods-backend
npm ci
```

### Environment Configuration

Use the provided `.env.example` as a reference for local environment configuration.

Database credentials, JWT secrets, and payment integration settings must be configured separately. Do not commit real credentials.

### Database

The project includes Docker Compose configurations for local development and isolated E2E testing.

Apply the appropriate Prisma migrations only after verifying the target database.

### Run the Backend

```bash
npm run start:dev
```

The API uses port `3000` in the current local development setup.

## Testing

Run the available checks:

```bash
npm run test:unit
npm run test:e2e
npm run build
npm run lint
npm run typecheck
```

E2E tests use an isolated PostgreSQL test database. They must not run against development or production data.

## Documentation

Additional implementation details, API contracts, integration guides, and test reports are available in the [`docs/`](docs/) directory.

## Frontend

The frontend is maintained separately in [gomgoods-frontend](https://github.com/Alight09004/gomgoods-frontend).

## License

See [LICENSE](LICENSE) for the repository's licensing terms.
