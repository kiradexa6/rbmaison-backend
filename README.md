# R&B MAISON Backend

Production backend foundation for the R&B MAISON luxury marketplace: NestJS API plus Supabase (PostgreSQL, Auth, Storage, Row Level Security).

This foundation does not include a UI, mock data, or stubbed business APIs. Schema, RLS, ledger rules, and server-side functions are real and enforced in the database.

## Stack

- **NestJS 11** — HTTP API
- **Supabase** — Auth, PostgreSQL, Storage
- **PostgreSQL** — relational data, RLS, triggers, RPCs
- **Winston** — structured logging
- **Helmet / Compression / Terminus** — security headers, compression, health checks

## Documentation

| Document | Contents |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Local install, environment variables, migrations, admin bootstrap |
| [docs/database.md](docs/database.md) | Tables, relationships, RLS, ledger, RPCs |
| [docs/deployment.md](docs/deployment.md) | Hosted Supabase, production env, Docker, secrets |

## Project structure

```
src/
├── config/                 # Environment validation
├── infrastructure/
│   ├── health/
│   ├── logging/
│   └── supabase/           # Typed Supabase clients (anon + service role)
├── shared/                 # Filters, interceptors
supabase/
├── migrations/             # Source of truth for schema, RLS, functions
└── templates/              # Admin bootstrap SQL (not auto-seeded)
docs/
```

## Getting started

```bash
npm install
cp .env.example .env
npx supabase start
npx supabase db reset
npm run start:dev
```

Fill `.env` from `npx supabase status` (local) or the hosted project API settings.

Health: `GET http://localhost:3000/api/v1/health`

Create the first admin with `supabase/templates/bootstrap_admin.sql` after the Auth user exists. Details: [docs/setup.md](docs/setup.md).

## Scripts

| Command | Description |
| --- | --- |
| `npm run start:dev` | API with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run start:prod` | Run `dist` |
| `npm test` / `npm run test:e2e` | Unit / integration tests |
| `npm run db:start` / `db:stop` | Local Supabase |
| `npm run db:reset` | Recreate local DB and apply migrations |
| `npm run db:push` | Push migrations to the linked project |
| `npm run docker:up` | Production containers |

## Security

- RLS is enabled on every public table. Clients using the anon key only see rows their policies allow.
- `SupabaseService.getAdminClient()` uses the service role key and **bypasses RLS**. Use it only for privileged server operations.
- `SupabaseService.asUser(accessToken)` must be used for user-scoped queries.
- Wallet balances cannot be written directly. Every movement inserts `wallet_transactions`.
- Merchant signup requires an admin-issued invitation code.

## License

UNLICENSED — Private project
