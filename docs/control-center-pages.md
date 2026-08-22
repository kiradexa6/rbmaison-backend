# Control Center — page audit (live production)

Lovable Control Center: `https://rbmaisons.com/control-center/*`  
Production API: `https://rbmaison-backend-production-f5dd.up.railway.app/api/v1`  
Live Supabase (Lovable): `https://elvypbekopexhcojpwki.supabase.co` (`elvypbekopexhcojpwki`)

**Critical:** Railway NestJS currently reports `projectRef: sbcyoaswsjfhhkypdniu` on `/health` — a **different** Supabase project with almost no data. Until Railway env vars are updated to `elvypbekopexhcojpwki`, Control Center lists will stay empty even though the storefront shows real products.

---

## Page → API mapping

| Page | Frontend fetcher | NestJS endpoint | Database source |
| --- | --- | --- | --- |
| `/control-center` | `users`, `merchants`, `stores`, `products`, `orders`, wallet endpoints | `GET /admin/users`, `/admin/merchants`, `/admin/stores`, `/admin/products`, `/admin/orders`, `/admin/wallets/*` | RPCs on `profiles`, `merchants`, `stores`, `products`, `orders`, wallet tables |
| `/control-center/users` | `GET /admin/users` | `AdminUsersController` → `admin_search_users` | `profiles` + `auth.users` |
| `/control-center/merchants` | `GET /admin/merchants` (+ stores/products tabs) | `AdminMerchantsController` → `admin_search_merchants` + **`admin_search_applications`** (pending apps merged) | `merchants`, `merchant_applications`, `stores`, `products` |
| `/control-center/orders` | `GET /admin/orders`, `/admin/shipment-queue` | `AdminOrdersController`, `AdminShipmentQueueController` | `orders`, order RPCs |
| `/control-center/finance` | `/admin/wallets/addresses`, `/deposits`, `/withdrawals` | `AdminWalletsController` | `wallet_addresses`, deposit/withdrawal requests, `wallet_transactions` |
| `/control-center/historical` | `/admin/users`, `/admin/users/:id/historical-data*`, `generate` | `HistoricalDataController` | Writes real rows to orders, wallets, deposits, etc. |
| `/control-center/notifications` | `GET/POST /admin/notifications` | `AdminNotificationsController` | `notifications` table |
| `/control-center/security` | `GET /admin/activity-logs` | `AdminUsersController` → `admin_search_activity_logs` | `admin_activity_logs` |

Auth header: `Authorization: Bearer <token>`. Frontend prefers NestJS login token (`rb_api_access_token`), then falls back to Supabase session JWT from `elvypbekopexhcojpwki`.

---

## No mock data in NestJS

All admin services call Supabase RPCs or tables via `supabaseService.asUser(accessToken)`. There are no in-memory fixtures in production code paths.

---

## Alignment checklist (required before live Control Center works)

1. Set Railway (and local `.env`) to **Lovable's** Supabase project:
   - `SUPABASE_URL=https://elvypbekopexhcojpwki.supabase.co`
   - `SUPABASE_PROJECT_REF=elvypbekopexhcojpwki`
   - Anon key, service role key, and JWT secret from **that** project's dashboard
2. Redeploy NestJS; confirm `GET /api/v1/health` → `projectRef: elvypbekopexhcojpwki`
3. Run `npm run verify:control-center` with admin credentials
4. Apply pending migrations on production if schema diff shows gaps (`npx supabase db diff --linked`)

---

## End-to-end historical test

1. Admin login → Control Center → Historical → search user by email → Select → Generate (6 months, medium volume)
2. `POST /admin/users/:id/historical-data/generate` writes to production tables
3. Log in as that user on rbmaisons.com → wallet/orders history must show generated rows

Requires aligned Supabase + admin password in env for automation (`VERIFY_ADMIN_EMAIL`, `VERIFY_ADMIN_PASSWORD`, optional `VERIFY_TARGET_USER_ID`).
