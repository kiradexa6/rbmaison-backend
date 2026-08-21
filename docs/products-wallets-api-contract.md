# Products & Wallets API Contract (Lovable Frontend)

Base URL: `{API_ORIGIN}/api/v1`  
Auth: `Authorization: Bearer <accessToken>`  
Response envelope: `{ success, data, timestamp, path }`

## Product model (important)

R&B MAISON uses a **central platform catalogue**:

- **Admin** owns catalogue products (`products`, variants, inventory, images, brands, categories).
- **Merchants** do not create catalogue SKUs. They **list** platform products via `merchant_product_listings`.
- Merchant "my products" = their active listings, not owned product rows.
- `sales_price` and `wholesale_price` are always calculated server-side from catalogue price (wholesale = 80% of sales price).

---

## Public catalogue (no auth)

| Method | Route | Description |
| --- | --- | --- |
| GET | `/catalogue/products` | Search published products |
| GET | `/catalogue/products/:idOrSlug` | Product detail |
| GET | `/catalogue/brands` | Active brands |
| GET | `/catalogue/categories` | Category tree |

Query params for search: `q`, `brandId`, `categoryId`, `gender`, `priceMin`, `priceMax`, `availableOnly`.

---

## Admin product management (`admin` role)

| Method | Route | Description |
| --- | --- | --- |
| GET | `/admin/products` | List all products |
| GET | `/admin/products/:id` | Product detail with brand, category, images, variants, inventory |
| POST | `/admin/products` | Create product (draft, unpublished) |
| PATCH | `/admin/products/:id` | Update product fields |
| POST | `/admin/products/:id/publish` | Publish product |
| POST | `/admin/products/:id/unpublish` | Unpublish product |
| DELETE | `/admin/products/:id` | Archive product |
| POST | `/admin/products/:id/images` | Add image by storage path/URL |
| POST | `/admin/products/:id/images/upload` | Multipart image upload |
| POST | `/admin/products/:id/images/:imageId/primary` | Set primary image |
| DELETE | `/admin/products/:id/images/:imageId` | Delete image |
| POST | `/admin/products/:id/variants` | Add variant |
| PATCH | `/admin/variants/:id` | Update variant |
| POST | `/admin/variants/:id/inventory` | Adjust stock (`stock_added`, `stock_removed`, `adjustment`) |
| GET | `/admin/inventory-transactions` | Inventory ledger (`?variantId=`) |
| GET | `/admin/brands` | List brands |
| POST | `/admin/brands` | Create brand |
| PATCH | `/admin/brands/:id` | Update brand |
| GET | `/admin/categories` | List categories |
| POST | `/admin/categories` | Create category |
| PATCH | `/admin/categories/:id` | Update category |

### Create product body

```json
{
  "name": "Maison Tote",
  "brandId": "uuid",
  "categoryId": "uuid",
  "price": 1299.99,
  "description": "...",
  "gender": "women",
  "currency": "USD"
}
```

### Inventory adjust body

```json
{
  "type": "stock_added",
  "quantity": 25,
  "reference": "Initial stock"
}
```

---

## Merchant product management (`merchant` role)

Merchants manage **listings**, not catalogue CRUD.

| Method | Route | Description |
| --- | --- | --- |
| GET | `/merchant/wholesale/products` | Browse catalogue available to list |
| POST | `/merchant/wholesale/preview` | Preview listing prices before listing |
| POST | `/merchant/listings` | Create/reactivate listing `{ "productId": "uuid" }` |
| DELETE | `/merchant/listings/:listingId` | Remove listing |
| GET | `/merchant/products` | List merchant's active listings |
| GET | `/merchant/products/:listingId` | Listing detail with images, variants, stock flags |

Listing detail includes:

- `sales_price`, `wholesale_price`, `catalogue_price` (all from DB)
- `in_stock` (from `catalogue_availability`, no raw quantities)
- `images[]`, `variants[]` with per-variant `inStock` boolean

---

## Merchant wallet (`merchant` role)

All balances come from `wallets.balance` (ledger-maintained).

| Method | Route | Description |
| --- | --- | --- |
| GET | `/merchant/wallet` | All wallet rows (USD, BTC, ETH, USDT) |
| GET | `/merchant/wallet/balance` | Wallets + `totals` map by currency |
| GET | `/merchant/wallet/transactions` | Ledger history for merchant wallets |
| GET | `/merchant/wallet/deposit-address` | Admin deposit address (`?asset=&network=`) |
| GET | `/merchant/wallet/deposits` | Deposit requests with status |
| GET | `/merchant/wallet/deposits/:id` | Single deposit request status |
| POST | `/merchant/wallet/deposits` | Submit deposit request |
| GET | `/merchant/wallet/withdrawals` | Withdrawal requests with status |
| GET | `/merchant/wallet/withdrawals/:id` | Single withdrawal request status |
| POST | `/merchant/wallet/withdrawals` | Submit withdrawal request |

### Deposit body

```json
{
  "amount": 0.5,
  "asset": "USDT",
  "network": "trc20"
}
```

### Withdrawal body

```json
{
  "amount": 0.25,
  "asset": "USDT",
  "network": "trc20",
  "destinationAddress": "TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

Statuses:

- Deposits: `pending` → admin approve/reject → ledger credit on approve
- Withdrawals: `pending` → admin approve/reject → ledger debit on approve

---

## Admin wallet management (`admin` role)

| Method | Route | Description |
| --- | --- | --- |
| GET | `/admin/wallets/addresses` | Deposit addresses |
| POST | `/admin/wallets/addresses` | Add address |
| PATCH | `/admin/wallets/addresses/:id` | Update address |
| POST | `/admin/wallets/addresses/:id/disable` | Disable address |
| DELETE | `/admin/wallets/addresses/:id` | Delete address |
| GET | `/admin/wallets/deposits` | Search deposits (`?status=&storeId=&merchant=`) |
| GET | `/admin/wallets/deposits/:id` | Deposit detail |
| POST | `/admin/wallets/deposits/:id/approve` | Approve → credits ledger |
| POST | `/admin/wallets/deposits/:id/reject` | Reject deposit |
| GET | `/admin/wallets/withdrawals` | Search withdrawals |
| GET | `/admin/wallets/withdrawals/:id` | Withdrawal detail |
| POST | `/admin/wallets/withdrawals/:id/approve` | Approve → debits ledger |
| POST | `/admin/wallets/withdrawals/:id/reject` | Reject withdrawal |
| GET | `/admin/wallets/transactions` | Search wallet ledger |
| POST | `/admin/wallets/merchants/:id/adjust` | Manual balance adjustment |

### Admin transaction search query

`?storeId=&merchantId=&merchant=&currency=&type=&status=`

Transaction types: `deposit`, `withdrawal`, `order_payment`, `admin_adjustment`, `refund`, `profit_release`, `wholesale_return`

---

## Rules for frontend

1. Never calculate balances, wholesale prices, or inventory in the browser.
2. Use camelCase query params (`storeId`, not `store_id`).
3. Do not send pagination params (`page`, `limit`, `offset`) — API returns full lists.
4. Amounts in responses are strings from Postgres numeric fields.
5. Merchant product screens should use `/merchant/products*` routes, not `/admin/products*`.
