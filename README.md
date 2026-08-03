# Trading Platform Backend

Production-grade NestJS backend foundation built with Clean Architecture, modular design, and SOLID principles.

## Stack

- **NestJS 11** — Application framework
- **TypeScript** — Strict mode enabled
- **Winston** — Structured logging
- **Helmet** — Security headers
- **Compression** — Response compression
- **Terminus** — Health checks
- **Docker** — Containerized deployment

## Project Structure

```
src/
├── application/          # Use cases & application services (future)
├── config/               # Environment configuration & validation
├── core/                 # Domain entities & business rules (future)
├── infrastructure/       # External adapters (logging, health)
│   ├── health/
│   └── logging/
├── modules/              # Feature modules (future)
├── presentation/         # Controllers & DTOs (future)
└── shared/               # Cross-cutting concerns
    └── common/
        ├── constants/
        ├── filters/      # Global exception filter
        ├── interceptors/ # Logging & response interceptors
        ├── interfaces/
test/
    └── helpers/          # Integration test utilities
```

## Getting Started

### Prerequisites

- Node.js 22+
- npm 10+

### Installation

```bash
npm install
cp .env.example .env
```

### Development

```bash
npm run start:dev
```

The API runs at `http://localhost:3000/api/v1`.

### Health Check

```bash
curl http://localhost:3000/api/v1/health
```

## Scripts

| Command              | Description                    |
| -------------------- | ------------------------------ |
| `npm run start:dev`  | Start with hot reload          |
| `npm run build`      | Compile TypeScript             |
| `npm run start:prod` | Run production build           |
| `npm run lint`       | Run ESLint                     |
| `npm run format`     | Format with Prettier           |
| `npm test`           | Run unit tests                 |
| `npm run test:e2e`   | Run integration tests          |
| `npm run test:cov`   | Run tests with coverage        |
| `npm run docker:up`  | Start production containers    |
| `npm run docker:dev` | Start development containers   |

## Environment Variables

| Variable       | Default           | Description              |
| -------------- | ----------------- | ------------------------ |
| `NODE_ENV`     | `development`     | Runtime environment      |
| `APP_NAME`     | `TradingPlatform` | Application name         |
| `PORT`         | `3000`            | Server port              |
| `API_PREFIX`   | `api/v1`          | Global route prefix      |
| `CORS_ENABLED` | `true`            | Enable CORS              |
| `CORS_ORIGIN`  | `*`               | Allowed origins          |
| `LOG_LEVEL`    | `info`            | Winston log level        |

## Docker

### Production

```bash
docker compose up -d
```

### Development

```bash
docker compose -f docker-compose.dev.yml up
```

## Architecture

This foundation follows **Clean Architecture** layering:

1. **Core** — Domain logic with no external dependencies
2. **Application** — Use cases orchestrating domain operations
3. **Infrastructure** — Adapters for external systems (logging, databases, messaging)
4. **Presentation** — HTTP controllers and request/response DTOs
5. **Shared** — Cross-cutting concerns (filters, interceptors, pipes)

Business modules (auth, trading, users) are intentionally excluded. Add them under `src/modules/` as the platform evolves.

## API Response Format

All successful responses are wrapped:

```json
{
  "success": true,
  "data": {},
  "timestamp": "2026-08-03T14:00:00.000Z",
  "path": "/api/v1/health"
}
```

Errors follow a consistent format:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2026-08-03T14:00:00.000Z",
  "path": "/api/v1/example"
}
```

## License

UNLICENSED — Private project
