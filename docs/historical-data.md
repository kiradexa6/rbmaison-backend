# Admin-controlled historical account data

Admins can generate up to **six months** of prior activity for **one existing account** they explicitly select. This is not a seeder, not demo data, and it never runs on signup.

## Access

All routes require a valid admin JWT (`SupabaseAuthGuard` + `RolesGuard` + `is_admin()` inside the RPCs).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/users/:id/historical-data` | Selected account, allowed categories, limits, recent runs |
| `POST` | `/api/v1/admin/users/:id/historical-data/preview` | Dry-run estimate. Writes only an admin audit row. |
| `POST` | `/api/v1/admin/users/:id/historical-data/generate` | Confirm and generate for that `user_id` only |
| `GET` | `/api/v1/admin/users/:id/historical-data/runs` | Runs for the selected account |
| `GET` | `/api/v1/admin/historical-data/runs/:runId` | One run |
| `POST` | `/api/v1/admin/historical-data/runs/:runId/reverse` | Safe reversal when later activity does not depend on the run |
| `POST` | `/api/v1/admin/stores/:id/viewers` | Set the displayed store viewer count |

The JSON body must include `userId` matching `:id`. The backend resolves the profile itself; the client selection is never trusted.

Preview / generate / reverse are throttled to **3 requests / minute**.

## Categories

Chosen independently:

| Category | Who | What is created |
| --- | --- | --- |
| `wallet` | Merchant | USD ledger deposits on the existing wallet |
| `deposits` | Merchant | `wallet_deposit_requests` plus approval/rejection through existing admin deposit RPCs |
| `withdrawals` | Merchant | `withdrawal_requests` plus approval/rejection through existing admin withdrawal RPCs |
| `orders` | Merchant with a store and **eligible listings** | Store orders, items, wholesale `order_payment`, and settlement (`wholesale_return` + `profit_release`) |
| `viewers` | Store | `store_viewer_settings` used by `shop_statistics` |

Customer-only accounts cannot receive wallet, deposit, or withdrawal history (those tables are merchant-owned). Order generation is not attached to another merchant's store.

If orders are requested and the merchant has no active listing+variant, generation fails with:

`This merchant has no eligible products available for historical order generation.`

Products are never auto-created.

## Range and limits

Presets: `last_7_days`, `last_30_days`, `last_90_days`, `last_180_days`, `custom`.

- Maximum window: **180 days**
- No future `to` date
- Activity levels `low` / `medium` / `high` cap deposits, withdrawals, and orders
- Configurable ceilings: `HISTORICAL_MAX_*` in `.env` (see `.env.example`)

## Accounting

Generation uses the existing ledger, deposit, withdrawal, order, and settlement tables. Wallet balances stay consistent with completed `wallet_transactions`. Historical timestamps are backdated across the selected period; events are not placed on a fixed 24-hour grid.

User-facing notifications are suppressed during generation (`app.suppress_notifications`).

Execute is a single database transaction. If it fails, generated rows roll back and the run is marked `failed`.

## Reversal

Completed runs can be reversed only when:

- generated orders are still `pending` / `awaiting_payment` / `cancelled`
- no later wallet activity or store orders depend on the run

Otherwise the API refuses and explains why. Completed ledger rows are never deleted; balances are restored with `admin_adjustment` when reversal is safe.

## Store viewers

`POST /api/v1/admin/stores/:id/viewers` sets `store_viewer_settings.viewer_count`. `shop_statistics.total_followers` uses that displayed count when present, otherwise the real `store_followers` count.
