# R&B MAISON — Production readiness

This is the NestJS API for the luxury marketplace. Data, Auth, Storage, and RLS run on hosted Supabase. There is no UI in this repository. Clients never receive `SUPABASE_SERVICE_ROLE_KEY`.

Global prefix: `/api/v1`.

## Architecture overview

```
Browser / mobile (anon key + user JWT)
        │
        ▼
NestJS API  ── asUser(JWT) ──► PostgREST / RPC (RLS on)
   │
   ├── Auth guards + role guards
   ├── ValidationPipe (422)
   ├── ThrottlerGuard
   └── Service role (server only) for Auth getUser + privileged notify RPCs
        │
        ▼
Supabase Postgres
   ├── RLS on every public table
   ├── SECURITY DEFINER RPCs for writes
   ├── Ledger trigger owns wallet.balance
   └── Triggers write notifications and admin_activity_logs
```

Roles:

| Role | How it is granted | What it unlocks |
| --- | --- | --- |
| `customer` | Default on signup | Profile, store application, own orders, own notifications, public catalogue |
| `merchant` | Admin approval of a store application (or invitation RPC) | Own store, listings, store orders, wallet, shop stats |
| `admin` | Bootstrap SQL / admin promotion | Full access. Privileged RPCs call `is_admin()` |

A customer cannot self-promote to merchant or admin.

## Database structure

Core tables (RLS enabled on all): `profiles`, `merchants`, `stores`, `merchant_applications`, `products`, `merchant_product_listings`, `orders`, `order_items`, `wallets`, `wallet_transactions`, `withdrawal_requests`, `wallet_deposit_requests`, `notifications`, plus catalogue helpers (`brands`, `categories`, variants, images), `merchant_credit_scores`, `store_followers`, `admin_activity_logs`, `admin_wallet_addresses`.

See `docs/database.md` for columns, RPCs, and policy summaries.

Wallet invariant: `wallets.balance` changes only when a `wallet_transactions` row is applied. Completed ledger rows are immutable. Direct table writes on wallets, ledger, orders, listings, and notifications are revoked from `anon` / `authenticated`; callers use RPCs.

## API overview

All routes below are under `/api/v1`.

| Surface | Auth | Examples |
| --- | --- | --- |
| Public | None | `GET /health`, `GET /catalogue/products` |
| Auth | Anon client | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout` |
| Customer | JWT + role `customer` | `POST /store-applications`, `POST /orders`, `GET /notifications` |
| Merchant | JWT + role `merchant` | `/merchant/shop-details`, `/merchant/products`, `/merchant/store/orders`, `/merchant/wallet` |
| Admin | JWT + role `admin` | `/admin/*` users, stores, products, orders, wallets, notifications |

Financial mutations:

- Deposit: merchant `POST /merchant/wallet/deposits` → admin `POST /admin/wallets/deposits/:id/approve` → `deposit` ledger credit
- Withdrawal: merchant `POST /merchant/wallet/withdrawals` → admin approve → `withdrawal` ledger debit
- Order wholesale: merchant `POST /merchant/store/orders/:id/confirm` → `order_payment` ledger debit, then status `paid`
- Profit: admin completion → per-line `wholesale_return` + `profit_release` (sales total)

## Security rules

### Roles

- Customer cannot access merchant or admin routes (`RolesGuard` → 403 Permission denied).
- Merchant cannot access admin routes, change `profiles.role`, approve their own store, edit catalogue/wholesale math, or write `wallets.balance`.
- Admin RPCs require `is_admin()` inside Postgres, not only the Nest guard.

### RLS (by actor)

| Actor | Can read | Cannot |
| --- | --- | --- |
| Customer | Own profile, own orders, own notifications, public catalogue | Other users, wallets, wholesale, admin tables |
| Merchant | Own store, listings, orders, wallets, ledger, notifications | Another merchant’s shop/wallet/orders |
| Admin | All of the above | — |
| Anonymous | Published catalogue and active storefront | Everything else |

### Wallet

- No frontend balance field is accepted.
- `record_wallet_transaction` / deposit / withdrawal / adjust RPCs are admin- or owner-gated in SQL.
- Status `paid` is rejected unless a completed `order_payment` row exists for that order.

### Listings / wholesale

- Wholesale is generated (`sales_price * 0.80`).
- Non-admin listing inserts overwrite `sales_price` from the published product.

### Environment

| Variable | Client | API server | Notes |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Yes | Yes | Project URL |
| `SUPABASE_ANON_KEY` | Yes | Yes | Public. RLS still applies with a user JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | **Never** | Yes | Bypasses RLS |
| `SUPABASE_JWT_SECRET` | **Never** | Yes (required in production) | Dashboard JWT secret |
| `CORS_ORIGIN` | — | Yes | Production must be an explicit origin, not `*` |

Production boot refuses missing Supabase URL/keys/JWT secret and refuses `CORS_ORIGIN=*`.

### HTTP errors

| Status | `error` field | Typical cause |
| --- | --- | --- |
| 401 | Unauthorized | Missing/invalid JWT |
| 403 | Permission denied | Wrong role or RLS |
| 404 | Not found | Unknown id |
| 409 | Conflict | Duplicate listing/email |
| 422 | Invalid request | Validation or illegal mutation |
| 400 | Bad Request | Financial: `Insufficient balance. Please top up your account.` |

Failed authorization attempts are logged **without** the bearer token.

### Rate limits (per IP, 60s window)

| Class | Limit | Routes |
| --- | --- | --- |
| Default | 120 | All others |
| Auth | 5 | `/auth/signup`, `/auth/login`, `/auth/logout` |
| Historical | 3 | Historical preview, generate, reverse |
| Financial | 10 | Deposits, withdrawals, admin approve/reject/adjust |
| Orders | 20 | Create order, confirm order |
| Health | skipped | `GET /health` |

Limits are in-process (per API instance). Put a shared limiter in front of multiple replicas if needed.

### Logging

- Request/response: `LoggingInterceptor` + Winston JSON
- Security: `SupabaseAuthGuard` / `RolesGuard` warn on 401/403
- Admin: `admin_activity_logs` for approve/reject merchant, wallet adjust, user suspend, store changes, historical generation
- Financial: ledger rows for deposits, withdrawals, `order_payment`, `profit_release`

## Deployment steps

1. Create a hosted Supabase project. Leave RLS enabled.
2. Link and push migrations (never `db reset` in production):

   ```bash
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

3. Create the first Auth user, then run `supabase/templates/bootstrap_admin.sql` in the SQL Editor (replace the email).
4. Confirm storage buckets `avatars`, `store-logos`, `product-images`.
5. Set API environment (orchestrator secrets, not the image):

   ```
   NODE_ENV=production
   CORS_ORIGIN=https://your-frontend-origin
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=<anon>
   SUPABASE_SERVICE_ROLE_KEY=<service-role>
   SUPABASE_JWT_SECRET=<jwt-secret>
   ```

6. Terminate TLS at the load balancer / reverse proxy. Set the proxy so `X-Forwarded-For` reaches Nest (`trust proxy` is enabled).
7. Deploy the API (`docker compose up -d --build` or your platform). Point the domain at HTTPS.
8. Verify `GET /api/v1/health` → `supabase.configured: true`.
9. Sign in as the bootstrap admin and confirm `profiles.role = 'admin'`.
10. Smoke: customer cannot call `/merchant/*`; merchant cannot call `/admin/*`; deposit approve credits the ledger.

Keep schema and API deploys in lockstep: push a required migration before the API that depends on it.

## Environment variables

| Variable | Production | Description |
| --- | --- | --- |
| `NODE_ENV` | `production` | Enables production checks |
| `APP_NAME` | optional | Default `RBMaison` |
| `PORT` | optional | Default `3000` |
| `API_PREFIX` | optional | Default `api/v1` |
| `CORS_ENABLED` | optional | Default `true` |
| `CORS_ORIGIN` | **required, not `*`** | Comma-separated frontend origins |
| `LOG_LEVEL` | optional | Winston level |
| `SUPABASE_URL` | required | Project URL |
| `SUPABASE_ANON_KEY` | required | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | required, server only | Service role |
| `SUPABASE_JWT_SECRET` | required, server only | JWT secret |

Copy values from **Supabase Dashboard → Project Settings → API**. Rotate any key that leaks.

## Backup process

### Strategy

- Enable **daily backups** and **PITR** on the hosted Supabase project (Dashboard → Database → Backups). PITR is the restore path for accidental `UPDATE`/`DELETE`.
- Keep `supabase/migrations/` as the source of truth. Do not edit applied files; add a new timestamped migration.
- Back up Storage separately if product images must survive a project rebuild (Supabase does not treat Storage as a SQL dump).
- Nest has no local database. Restoring Postgres restores marketplace state; Auth users live in `auth.users` and are included in Supabase backups.

### Migration safety

- Apply with `npx supabase db push` during a maintenance window if the migration rewrites functions or revokes grants.
- Additive migrations only. Destructive column drops need a two-step deploy (API stop using the column, then drop).
- Never run `npx supabase db reset` against production.
- After push, hit `/health` and run a merchant wallet read + admin search as a smoke test.

### Restore

1. In the Supabase dashboard, restore to the PITR timestamp or the daily backup.
2. If the API was mid-deploy, roll the API to the commit that matches that schema.
3. Confirm Auth sessions still validate (`getUser` via service role).
4. Confirm a merchant wallet balance matches the latest completed `wallet_transactions` (the balance trigger will not rebuild history by itself; a PITR restore brings both tables back together).

Logical dump (operator machine, not a substitute for PITR):

```bash
npx supabase db dump -f backup.sql
```

Restore that dump only onto a **new** project or local stack, never as a casual overwrite of live production.

## Production checklist

- [ ] Domain DNS → load balancer
- [ ] HTTPS / TLS certificates
- [ ] `CORS_ORIGIN` is the real frontend origin
- [ ] `NODE_ENV=production` and all Supabase secrets injected
- [ ] `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET` not in the frontend bundle
- [ ] Migrations pushed; bootstrap admin exists
- [ ] Storage buckets exist
- [ ] PITR / daily backups enabled
- [ ] `GET /api/v1/health` is up
- [ ] Log drain attached to Winston stdout
- [ ] Uptime check on `/api/v1/health`
- [ ] Rate limits observed behind a single IP / NAT (adjust proxy if needed)

## Tests

Automated coverage lives in `src/**/*.spec.ts`:

- Auth register / login / logout (anon client only)
- Merchant apply / admin approve / listing create
- Order place → confirm → ship → admin delivery
- Wallet deposit / withdrawal / adjustment RPCs
- Role isolation (customer ↛ merchant, merchant ↛ admin)
- Wallet protection and insufficient-balance message
- Notification event catalog
- Production env (CORS + JWT secret)

Run:

```bash
npm test -- --no-coverage
npx nest build
```
