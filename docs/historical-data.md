# Admin Historical Records

Admins generate up to **six months** of prior activity for **one existing account** they explicitly select. This is not a seeder, not demo data, and it never runs on signup.

The Admin Control Center at `https://rbmaisons.com/admin` (route `/control-center/historical`) searches a user, starts generation, and displays the **backend result**. Records are written to the existing deposit, withdrawal, order, profit-settlement, and wallet tables so they appear in the normal user history APIs.

## Control Center flow

1. Search users: `GET /api/v1/admin/users?search=`
2. Select a user (`id` / `user_id`)
3. Optional: choose history types, or omit them for **Select All**
4. Generate: `POST /api/v1/admin/users/:id/historical-data/generate`
5. Poll/read the returned run (and `GET .../historical-data/runs`) for processed counts

The backend always uses **today minus 6 months through today**. Do not send start/end dates. The Control Center `months` field is accepted and ignored.

## Access

All routes require an admin JWT (`SupabaseAuthGuard` + `RolesGuard` + `is_admin()` inside the RPCs).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/users` | Search (`q` or `search`). Rows include `id` = `user_id` |
| `GET` | `/api/v1/admin/users/:id/historical-data` | Selected account, history types, period, `records` for the Control Center table |
| `POST` | `/api/v1/admin/users/:id/historical-data/preview` | Dry-run estimate |
| `POST` | `/api/v1/admin/users/:id/historical-data/generate` | Generate for that account only |
| `GET` | `/api/v1/admin/users/:id/historical-data/runs` | Runs + processed counts |
| `GET` | `/api/v1/admin/historical-data/runs/:runId` | One run |
| `POST` | `/api/v1/admin/historical-data/runs/:runId/reverse` | Safe reversal |

Preview / generate / reverse are throttled to **3 requests / minute**.

## Generate body

The live Control Center sends:

```json
{ "months": 6, "volume": "medium" }
```

That is enough. Path `:id` is the selected user. Confirmation is implied. The backend supplies a stable idempotency key.

Optional fields (Lovable / newer UI):

| Field | Notes |
| --- | --- |
| `historyTypes` | `deposits`, `withdrawals`, `profits`, `orders`, `payments`, `billing`, `wallet`, `walletTransactions`, `viewers` |
| `selectAll` | All types the account can receive (not viewers) |
| `categories` | Low-level generator categories |
| `activityLevel` / `volume` | `low` \| `medium` \| `high` |
| `confirm` | Default true. `false` is rejected |
| `idempotencyKey` | Optional; backend generates one per user + type set |
| `userId` | If sent, must match `:id` |

`from`, `to`, and `rangePreset` are ignored. Period is always `last_180_days`.

## History types → existing records

There is no second history system. UI types map onto existing tables:

| History type | Created through |
| --- | --- |
| Deposits | `wallet_deposit_requests` + existing approve/reject RPCs |
| Withdrawals | `withdrawal_requests` + existing approve/reject RPCs |
| Orders | `orders` + `order_items` using existing listings/variants |
| Payments | `wallet_transactions` type `order_payment` on those orders |
| Profits | `order_items.merchant_profit` + `profit_release` settlement on completed orders |
| Billing / wallet | Existing `wallet_transactions` (credits, debits, deposits, wholesale, profit) |

Profits are never created without their order. Amounts come from listing sales/wholesale prices and the existing settlement math. IDs are `gen_random_uuid()`.

Customer-only accounts cannot receive wallet/deposit/withdrawal history. Orders require an eligible active listing.

## Duplicate protection

A second generate for the same account and overlapping types returns the existing completed run (or 409 if a different overlapping run exists). Reverse first to generate again. In-flight runs are rejected.

Execute is one database transaction. Failure rolls generated rows back and marks the run `failed`.

## Result shape (`data`)

Flattened counts are for the Control Center table:

```json
{
  "id": "run-uuid",
  "runId": "run-uuid",
  "status": "completed",
  "progress": "completed",
  "deposits": 12,
  "withdrawals": 8,
  "orders": 16,
  "profits": 6,
  "payments": 12,
  "billing": 40,
  "walletTransactions": 40,
  "created": { "deposits": 12, "withdrawals": 8, "orders": 16, "profits": 6, "payments": 12, "billing": 40, "walletTransactions": 40 },
  "processed": [{ "type": "deposits", "processed": 12 }]
}
```

Counts come from the run, not from the frontend.

## User-facing history

After generation, the same merchant/customer APIs return the rows: deposit history, withdrawal history, orders, wallet/billing transactions. Do not show admin-run metadata on those APIs.
