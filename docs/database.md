# R&B MAISON — Database Structure

PostgreSQL schema hosted on Supabase. Source of truth: `supabase/migrations/`.

## Design rules

- Every table has `id uuid` and `created_at`. Mutable tables also have `updated_at`.
- Money never lives as a lone balance. `wallets.balance` is a cache updated only by the ledger trigger on `wallet_transactions`.
- Catalogue products are platform-owned. Merchants sell through `merchant_product_listings`; they do not duplicate product rows.
- Wholesale price is generated: `sales_price * 0.80` (fixed 20% discount). Clients cannot supply it.
- Role and status on `profiles` cannot be changed by the subject. Merchant registration is the only non-admin role change, and only `customer → merchant` after a valid invitation code is consumed.

## Entity relationship overview

```
auth.users
    │
    ├── profiles (1:1)
    ├── merchants (0..1)
    │       ├── stores (1:1)
    │       ├── wallets (1 per currency: USD, BTC, ETH, USDT)
    │       │       └── wallet_transactions (ledger)
    │       └── merchant_product_listings ──► products
    └── orders (as customer_id)
            └── order_items ──► products, product_variants

products
    ├── product_categories
    ├── brands
    ├── product_images
    └── product_variants
            └── inventory (1:1)
```

## Tables

| Table | Purpose |
| --- | --- |
| `profiles` | Application user. Roles: `customer`, `merchant`, `admin`. Status: `active`, `suspended`, `blocked`, `pending`. |
| `admin_activity_logs` | Immutable admin audit trail. |
| `merchant_invitation_codes` | Admin-issued codes required to register as a merchant. |
| `merchants` | One merchant per auth user. Verification: `pending`, `approved`, `rejected`. |
| `stores` | One store per merchant. Status: `pending`, `active`, `suspended`. |
| `wallets` | Merchant wallet per currency. Balance is ledger-controlled. |
| `wallet_transactions` | Append-only ledger. Types: `deposit`, `withdrawal`, `order_payment`, `admin_adjustment`, `refund`, `profit_release`. |
| `product_categories` | Catalogue taxonomy (optional parent). |
| `brands` | Catalogue brands. |
| `products` | Central catalogue. Price, currency, status. |
| `product_images` | Storage paths for catalogue images. |
| `product_variants` | Size, color, SKU. |
| `inventory` | Quantity and availability per variant. |
| `merchant_product_listings` | Merchant offer against a catalogue product. |
| `orders` | Customer purchase from one merchant store. |
| `order_items` | Line items with snapshotted sales/wholesale prices and generated `merchant_profit`. |

## Views

| View | Purpose |
| --- | --- |
| `storefront_listings` | Active listings without `wholesale_price`. Safe for anonymous storefront reads. |
| `customer_order_items` | The current customer's line items without wholesale or profit. |

## Server-side functions

| Function | Who | What |
| --- | --- | --- |
| `create_merchant_invitation_code` | Admin | Issues a cryptographically random code. |
| `deactivate_merchant_invitation_code` | Admin | Disables a code. |
| `register_merchant_with_invitation` | Customer | Consumes a valid code, creates merchant + store + wallets, sets role to merchant. |
| `record_wallet_transaction` | Admin / service role | Writes a ledger row (the only way to change a balance). |
| `request_withdrawal` | Merchant | Creates a `pending` debit. Balance changes only when an admin completes it. |
| `finalize_wallet_transaction` | Admin | Completes, fails, or cancels a pending transaction. |
| `place_order` | Customer | Validates listing + inventory, decrements stock, writes order + items. |
| `release_order_profit` | Admin / service role | Credits merchant wallet from a delivered order (idempotent per order). |
| `log_admin_action` | Admin | Explicit audit insert. Admin writes on managed tables are also auto-logged. |

## Row Level Security (summary)

RLS is enabled on every public table. Policies are enforced in PostgreSQL, not in the frontend.

| Actor | Allowed data |
| --- | --- |
| Customer | Own profile. Own orders. Own line items via `customer_order_items`. Active catalogue and storefront listings. |
| Merchant | Own profile, merchant row, store, listings, orders, wallets, and ledger. Cannot see other merchants' finances or customers' profiles. |
| Admin | Full access to all tables listed above. |
| Anonymous | Active catalogue, active stores, `storefront_listings` (no wholesale). |

Additional database enforcement (not RLS alone):

- Wallet balance cannot be updated except by the ledger trigger.
- Completed ledger rows cannot be edited or deleted.
- Invitation codes cannot be guessed through SELECT; validation runs inside `register_merchant_with_invitation`.
- Suspended or blocked profiles set `auth.users.banned_until`, which prevents further Auth sessions.

## Storage buckets

| Bucket | Public read | Write |
| --- | --- | --- |
| `avatars` | Yes | Folder `{user_id}/` by the owner |
| `store-logos` | Yes | Folder `{merchant_id}/` by that merchant or admin |
| `product-images` | Yes | Admin only |

## Indexes

Foreign keys, statuses, emails, SKUs, listing uniqueness `(merchant_id, product_id)`, wallet uniqueness `(merchant_id, currency)`, and a partial unique index preventing duplicate open ledger references are created in the migrations.
