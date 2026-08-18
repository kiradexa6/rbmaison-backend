# R&B MAISON — Database Structure

PostgreSQL schema hosted on Supabase. Source of truth: `supabase/migrations/`.

## Design rules

- Every table has `id uuid` and `created_at`. Mutable tables also have `updated_at`.
- Money never lives as a lone balance. `wallets.balance` is a cache updated only by the ledger trigger on `wallet_transactions`.
- Catalogue products are platform-owned. Merchants sell through `merchant_product_listings`; they do not duplicate product rows.
- Orders connect customer + merchant + store + listing + product. Item prices are snapshotted from the listing; clients cannot supply sales, wholesale, or profit.
- Merchant confirmation debits wholesale (`order_payment`) through the wallet ledger. After admin completion, each line is settled with `wholesale_return` (credit wholesale) and `profit_release` (credit 20% profit). Direct wallet updates are never allowed.
- Crypto top-ups and withdrawals go through request tables. Balance changes only when an admin approval writes `wallet_transactions`.
- Cancelling before shipping releases reserved inventory and, if wholesale was already paid, credits a `refund`. Profit is never released on cancel.
- Public catalogue requires `products.status = 'active'` **and** `products.published = true`.
- Wholesale price is generated: `sales_price * 0.80` (fixed 20% discount). Clients cannot supply it. Listing create snapshots `products.price` server-side as `sales_price` / `sales_price_snapshot`.
- Listing status: `pending`, `active`, `suspended`, `inactive`, `removed`. Merchants confirm into `active`. Duplicate live listings for the same merchant+product are blocked; a `removed` row may be reactivated.
- `merchants.wholesale_enabled` is admin-only. Merchants cannot change the wholesale formula or platform product fields.
- Inventory is a ledger: `available_quantity = quantity - reserved_quantity`. Changes insert `inventory_transactions`.
- Role and status on `profiles` cannot be changed by the subject. `customer → merchant` happens when an admin approves a `merchant_applications` row, or when `register_merchant_with_invitation` consumes a valid code. Merchants cannot approve themselves, change roles, credit scores, balances, or store status.
- Notifications are created only by backend events (triggers / service-role RPCs). Clients cannot insert notifications or edit title, message, type, or data.

## Entity relationship overview

```
auth.users
    │
    ├── profiles (1:1)
    ├── merchant_applications (0..n)
    ├── notifications (n)
    ├── merchants (0..1)
    │       ├── stores (1:1)
    │       │       └── store_followers
    │       ├── merchant_credit_scores (append-only)
    │       ├── wallets (1 per currency: USD, BTC, ETH, USDT)
    │       │       └── wallet_transactions (ledger)
    │       └── merchant_product_listings ──► products
    └── orders (as customer_id)
            └── order_items ──► merchant_product_listings, products, product_variants

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
| `merchant_applications` | Customer store applications. Status: `pending`, `approved`, `rejected`, `suspended`. Merchant + store + merchant role are created only on admin approve. |
| `notifications` | In-app notifications generated from real events. `read_status`: `unread` / `read`. Content is immutable. |
| `merchants` | One merchant per auth user. Verification: `pending`, `approved`, `rejected`. `wholesale_enabled` gates new listings. |
| `merchant_credit_scores` | Append-only credit history. Current score is the latest row. Admin adjustments are logged. |
| `store_followers` | Real follower rows counted by shop statistics. |
| `stores` | One store per merchant. Status: `pending`, `active`, `suspended`. |
| `wallets` | Merchant wallet per currency. Balance is ledger-controlled. |
| `wallet_transactions` | Append-only ledger. Types: `deposit`, `withdrawal`, `order_payment`, `admin_adjustment`, `refund`, `profit_release`, `wholesale_return`. |
| `admin_wallet_addresses` | Admin deposit destinations (BTC/ETH/USDT + network). Disabled addresses are hidden from merchants. |
| `wallet_deposit_requests` | Merchant top-up claims. Credit happens only after admin approval. |
| `withdrawal_requests` | Merchant withdrawal claims. Debit happens only after admin approval. |
| `product_categories` | Catalogue taxonomy (optional parent). |
| `brands` | Catalogue brands. |
| `products` | Central catalogue. Name, slug, gender, collection, price, currency, status (`draft`, `active`, `inactive`, `archived`), published. |
| `product_images` | Catalogue images with `image_url`, `position`, `is_primary`. |
| `product_variants` | Size, color, SKU, optional `price_override`, `is_active`. |
| `inventory` | On-hand `quantity`, `reserved_quantity`, generated `available_quantity`. |
| `inventory_transactions` | Inventory ledger: `stock_added`, `stock_removed`, `order_reserved`, `order_released`, `adjustment`. |
| `merchant_product_listings` | Merchant offer against a catalogue product. `sales_price_snapshot`, generated `wholesale_price`, status `active` / `inactive` / `removed` (plus legacy `pending` / `suspended`). |
| `orders` | Customer purchase from one merchant store. Status: `pending` → `paid` → `shipping` → `delivered` (plus `processing`, `cancelled`, and legacy values). |
| `order_items` | Line items with `listing_id`, snapshotted sales/wholesale, generated `merchant_profit`. |

## Views

| View | Purpose |
| --- | --- |
| `storefront_listings` | Active listings without `wholesale_price`. Safe for anonymous storefront reads. |
| `customer_order_items` | The current customer's line items without wholesale or profit. |
| `catalogue_availability` | Public in-stock flag per variant. No on-hand or reserved quantities. |

## Server-side functions

| Function | Who | What |
| --- | --- | --- |
| `create_merchant_invitation_code` | Admin | Issues a cryptographically random code. |
| `deactivate_merchant_invitation_code` | Admin | Disables a code. |
| `register_merchant_with_invitation` | Customer | Consumes a valid code, creates merchant + store + wallets, sets role to merchant. |
| `submit_merchant_application` | Customer | Creates a pending store application. No merchant row and no merchant role until admin approval. |
| `my_merchant_applications` | Customer | Own application history. |
| `admin_search_users` | Admin | Search users by email, user ID, store ID, merchant ID. Includes `auth.users.last_sign_in_at`. |
| `admin_set_user_status` | Admin | Suspend (`suspended`) or restore (`active`) a non-admin user. Syncs Auth `banned_until`. |
| `admin_search_applications` | Admin | Merchant applications with applicant name, email, store name, documents. |
| `admin_approve_merchant_application` | Admin | Creates merchant + store, assigns merchant role, seeds credit score 100, unlocks merchant APIs. Also approves invitation-created merchants by merchant ID. |
| `admin_reject_merchant_application` | Admin | Rejects a pending application (no merchant created) or invitation merchant verification. |
| `shop_details` | Merchant / admin | Store profile: id, name, logo, description, owner, country, status, approval date. Merchants only see their own store. |
| `shop_statistics` | Merchant / admin | Real counts from listings, orders, order_items, store_followers, and latest credit score. |
| `shop_financials` | Merchant / admin | Wallet balances and completed `wallet_transactions` totals (deposits, withdrawals, order payments, profit releases, refunds). |
| `store_shop_products` | Merchant / admin | Listed products with image, category, sales price, unit profit, listing date, status. Does not expose catalogue edit APIs. |
| `store_shop_orders` | Merchant / admin | Store orders with product, customer, amount, wholesale, profit, status. |
| `admin_search_stores` | Admin | Search stores by store ID, merchant ID, store name, email. |
| `admin_set_store_status` | Admin | Activate or suspend a store (and matching merchant / application status). |
| `admin_adjust_store_wallet` | Admin | ADD/REMOVE FUNDS by store ID via `admin_adjustment`. |
| `admin_adjust_credit_score` / `admin_adjust_store_credit` | Admin | Append a credit score row and log the change. |
| `admin_set_store_wholesale_access` | Admin | Enable/disable wholesale by store ID. |
| `admin_search_activity_logs` | Admin | Read immutable `admin_activity_logs`. |
| `create_notification` | Service role | Inserts an in-app notification. Not granted to authenticated clients. |
| `notify_admins` | Service role | Fan-out to every active admin profile. |
| `notify_order_payment_required` | Service role | Merchant Payment Required + admin Suspicious Activity after a failed wholesale debit. |
| `my_notifications` | Authenticated | Own notifications. |
| `notification_unread_count` | Authenticated | Own unread count. |
| `mark_notification_read` / `mark_all_notifications_read` | Authenticated | Mark own rows read. Cannot change content. |
| `record_wallet_transaction` | Admin / service role | Writes a ledger row (the only way to change a balance). |
| `request_withdrawal` | Merchant | Creates a `pending` debit. Balance changes only when an admin completes it. |
| `finalize_wallet_transaction` | Admin | Completes, fails, or cancels a pending transaction. |
| `search_catalogue` | Anon / authenticated | Public product search (name, brand, category, SKU) with filters. |
| `merchant_store_profile` | Merchant | Own store: merchant_id, store_id, store_name, owner, verification, account status. |
| `merchant_wholesale_catalog` | Merchant | Published products plus this merchant's listed flag (ADD TO WHOLESALE vs LISTED). |
| `preview_merchant_listing` | Merchant | Server-side listing preview. Wholesale = catalogue sales price × 0.80. |
| `create_merchant_listing` | Merchant | Creates or reactivates a listing from catalogue price. Status `active`. Rejects duplicates. |
| `remove_merchant_listing` | Merchant | Sets own listing to `removed`. |
| `merchant_listed_products` | Merchant | Own listed products (excludes `removed`), including wholesale, brand, category, image. |
| `admin_search_merchants` | Admin | Search merchants by Store ID and name/email. |
| `admin_search_listings` | Admin | Search all merchant listings by Store ID, merchant, product, status. |
| `admin_set_listing_status` | Admin | Disable (`inactive`) or remove a listing. |
| `admin_set_merchant_wholesale_access` | Admin | Suspend or restore merchant wholesale access. |
| `admin_adjust_inventory` | Admin | Stock add/remove/adjustment with ledger logging. |
| `admin_set_product_publication` | Admin | Publish / unpublish. |
| `admin_archive_product` | Admin | Soft-delete: `archived` + unpublished. |
| `place_order` | Customer | Reserves stock, snapshots listing prices, creates pending store order. |
| `confirm_merchant_order` | Merchant | Debits wholesale via `order_payment`. Insufficient funds: `"Insufficient balance. Please top up your account."` |
| `merchant_send_for_shipping` | Merchant | `paid` → `shipping`. Duplicate shipping is rejected. |
| `merchant_go_for_shipping` | Merchant | Alias of `merchant_send_for_shipping`. |
| `admin_complete_merchant_order` | Admin | `shipping` → `completed`, then per-line `wholesale_return` + `profit_release`. Duplicate: `"Order already settled"`. |
| `admin_confirm_delivery` | Admin | Calls `admin_complete_merchant_order`. |
| `release_wholesale_settlement` | Admin / service role | Credits wholesale + profit per `order_items` row. Idempotent. |
| `admin_merchant_orders` | Admin | Search merchant wholesale orders by store, merchant, order, or product. |
| `release_order_profit` | Admin / service role | Delegates to `release_wholesale_settlement`. |
| `merchant_store_orders` | Merchant | Own store orders with image, prices, profit, amount required. |
| `cancel_order` | Customer / merchant / admin | Cancel before shipping; refund wholesale if already paid; no profit release. |
| `admin_search_orders` | Admin | Search by order ID, Store ID, merchant, customer, status. |
| `admin_order_payments` | Admin | Ledger history for an order, including per-line settlement. |
| `admin_add_wallet_address` | Admin | Adds a BTC/ETH/USDT deposit address for a network. |
| `admin_update_wallet_address` | Admin | Edits a deposit address. |
| `admin_set_wallet_address_status` | Admin | Disables or re-enables a deposit address. |
| `admin_delete_wallet_address` | Admin | Deletes a deposit address. |
| `merchant_deposit_addresses` | Merchant | Active deposit address for asset + network. |
| `create_deposit_request` | Merchant | COMPLETE DEPOSIT — pending top-up claim. |
| `admin_search_deposits` | Admin | Pending/all deposit requests with store + merchant. |
| `admin_approve_deposit` | Admin | Credits `deposit` ledger row; merchant balance increases. |
| `admin_reject_deposit` | Admin | Rejects with no ledger row. |
| `create_withdrawal_request` | Merchant | Pending withdrawal; checks balance, does not debit yet. |
| `admin_search_withdrawals` | Admin | Pending/all withdrawals with destination address. |
| `admin_approve_withdrawal` | Admin | Debits `withdrawal` ledger row; merchant balance decreases. |
| `admin_reject_withdrawal` | Admin | Rejects with no ledger row. |
| `admin_adjust_merchant_wallet` | Admin | ADD/REMOVE FUNDS via `admin_adjustment` with a required reason. |
| `log_admin_action` | Admin | Explicit audit insert. Admin writes on managed tables are also auto-logged. |

## Row Level Security (summary)

RLS is enabled on every public table. Policies are enforced in PostgreSQL, not in the frontend.

| Actor | Allowed data |
| --- | --- |
| Customer | Own profile. Own orders. Own line items via `customer_order_items`. Own store applications. Own notifications. Active catalogue and storefront listings. Cannot access merchant shop, wholesale, wallet, or admin routes. |
| Merchant | Own profile, merchant row, store, listings, orders, wallets, ledger, shop statistics, credit history, own notifications. Cannot see another store. Cannot approve themselves, change role, credit score, balance, or store status. |
| Admin | Full access to all tables listed above, including user suspend/restore, application review, store control, balance and credit adjustments. Own admin notifications. |
| Anonymous | Published active catalogue, active stores, `storefront_listings` (no wholesale), `catalogue_availability` (in-stock only). |

Additional database enforcement (not RLS alone):

- Wallet balance cannot be updated except by the ledger trigger.
- Completed ledger rows cannot be edited or deleted.
- `order_payment` is a merchant debit (wholesale). `wholesale_return` credits that wholesale back on completion. `profit_release` credits line profit (`sales − wholesale` × qty). `refund` credits a cancelled wholesale debit.
- Deposit credits and withdrawal debits are written only by admin review RPCs. Merchants cannot edit balances.
- Order items are immutable. Customers read line items through `customer_order_items` (no wholesale or profit).
- Merchants cannot mark orders `completed` or `delivered`. Only an admin completes wholesale settlement.
- Invitation codes cannot be guessed through SELECT; validation runs inside `register_merchant_with_invitation`.
- Suspended or blocked profiles set `auth.users.banned_until`, which prevents further Auth sessions.
- Listing wholesale price is generated (`sales_price * 0.80`). Merchants cannot supply it or edit catalogue product fields.
- `merchants.wholesale_enabled` can only be changed by an admin. Merchants can only remove their own listings.
- Shop statistics are SQL aggregates from `merchant_product_listings`, `orders`, `order_items`, `wallet_transactions`, `wallets`, `store_followers`, and `merchant_credit_scores`. They are never hardcoded.
- Credit score history cannot be updated or deleted. Every admin score change inserts a row and an `admin_activity_logs` entry.
- Notification content cannot be created, edited, or deleted by clients. Users may only mark their own rows read. Realtime uses `postgres_changes` on `notifications` filtered by `user_id`.
- Direct INSERT/UPDATE/DELETE is revoked from `anon` and `authenticated` on wallets, ledger, deposit/withdrawal requests, orders, order items, listings, notifications, applications, credit scores, and admin logs. Mutations go through `SECURITY DEFINER` RPCs.
- An order cannot be marked `paid` unless a completed `order_payment` ledger row exists for that order.
- Non-admin listing inserts snap `sales_price` from the published catalogue product. Client-supplied prices are ignored.

## Storage buckets

| Bucket | Public read | Write |
| --- | --- | --- |
| `avatars` | Yes | Folder `{user_id}/` by the owner |
| `store-logos` | Yes | Folder `{merchant_id}/` by that merchant or admin |
| `product-images` | Yes | Admin only |

## Indexes

Foreign keys, statuses, emails, SKUs, live listing uniqueness `(merchant_id, product_id) WHERE status <> 'removed'`, wallet uniqueness `(merchant_id, currency)`, and a partial unique index preventing duplicate open ledger references are created in the migrations.
