# Admin API contract (Lovable / Control Center)

Source of truth: NestJS controllers + RPC/table return types. Do not invent paths, query keys, or pagination.

Base URL: `{API_ORIGIN}/api/v1`  
JSON: request bodies are **camelCase**. Most `data` payloads are **snake_case** from Postgres. Historical generate/list/get/reverse are **camelCase**.

---

## Envelope

Every successful handler is wrapped:

```json
{
  "success": true,
  "data": <handler return>,
  "timestamp": "2026-08-19T15:00:00.000Z",
  "path": "/api/v1/admin/..."
}
```

Errors are **not** wrapped in `data`:

```json
{
  "success": false,
  "statusCode": 422,
  "message": ["property limit should not exist"],
  "error": "Invalid request",
  "timestamp": "...",
  "path": "/api/v1/admin/merchants?limit=20"
}
```

Common status codes:

| Code | Meaning |
| --- | --- |
| 401 | Missing/invalid `Authorization: Bearer <accessToken>` |
| 403 | Authenticated but not `admin` |
| 404 | Resource not found |
| 422 | Validation: unknown query/body keys, wrong types, missing required fields |
| 429 | Throttle (auth 20/min, financial 10/min, historical 3/min) |
| 503 | Supabase not configured |

**There is no pagination.** Search endpoints return the full filtered array. Sending `limit`, `page`, `offset`, `perPage`, or snake_case aliases (`store_id`) returns **422**.

Numeric Postgres columns (`numeric`) usually arrive as **strings** (`"12.50"`). Integers/counts may be numbers.

---

## Auth (required before any admin call)

Header on all admin routes:

```
Authorization: Bearer <session.accessToken>
```

| Controller | Method | Endpoint | Body | `data` |
| --- | --- | --- | --- | --- |
| `AuthController` `@Controller('auth')` | POST | `/auth/login` | `{ "email": string, "password": string }` | `{ user: { id, email, role, status }, session: { accessToken, refreshToken, expiresAt } }` |
| same | POST | `/auth/refresh` | `{ "refreshToken": string }` | same shape as login |
| same | GET | `/auth/session` | — (Bearer required) | `{ user: { id, email, role, status }, session: { accessToken } }` |
| same | POST | `/auth/logout` | — (Bearer required) | `{ loggedOut: true }` |
| `HealthController` | GET | `/health` | — | Terminus payload; check `details.supabase.configured === true` |

Login throttle: 20 POSTs / 60s / IP (including successes). Production may still be 5 until redeploy.

Use `POST /auth/refresh` with `data.session.refreshToken` when admin calls start returning 401 due to expiry. Confirm the current session with `GET /auth/session`.

`user.role` is returned by login, refresh, and session. Admin UI should still treat 403 on `/admin/*` as “not admin”.

---

## Shared row shapes

```ts
type Uuid = string; // UUID
type ISODate = string;

type UserRow = {
  user_id: Uuid;
  profile_id: Uuid;
  full_name: string | null;
  email: string;
  phone: string | null;
  country: string | null;
  role: "customer" | "merchant" | "admin";
  status: "active" | "suspended" | "blocked" | "pending";
  created_at: ISODate;
  last_login: ISODate | null;
  merchant_id: Uuid | null;
  store_id: Uuid | null;
  store_name: string | null;
};

type ProfileRow = {
  id: Uuid;
  user_id: Uuid;
  full_name: string | null;
  email: string;
  phone: string | null;
  avatar: string | null;
  country: string | null;
  role: "customer" | "merchant" | "admin";
  status: "active" | "suspended" | "blocked" | "pending";
  created_at: ISODate;
  updated_at: ISODate;
};

type MerchantSearchRow = {
  merchant_id: Uuid;
  store_id: Uuid | null;
  store_name: string;
  owner_name: string | null;
  owner_email: string;
  owner_phone: string | null;
  verification_status: "pending" | "approved" | "rejected";
  account_status: "active" | "suspended" | "blocked";
  wholesale_enabled: boolean;
};

type MerchantRow = {
  id: Uuid;
  user_id: Uuid;
  store_id: Uuid | null;
  store_name: string;
  business_email: string;
  phone: string | null;
  country: string;
  verification_status: "pending" | "approved" | "rejected";
  status: "active" | "suspended" | "blocked";
  wholesale_enabled: boolean;
  created_at: ISODate;
  updated_at: ISODate;
};

type StoreRow = {
  id: Uuid;
  merchant_id: Uuid;
  store_name: string;
  description: string | null;
  logo: string | null;
  status: "pending" | "active" | "suspended";
  created_at: ISODate;
  updated_at: ISODate;
};

type StoreSearchRow = {
  store_id: Uuid;
  store_name: string;
  merchant_id: Uuid;
  owner_name: string | null;
  owner_email: string;
  country: string;
  status: "pending" | "active" | "suspended";
  verification_status: "pending" | "approved" | "rejected";
  wholesale_enabled: boolean;
  created_at: ISODate;
};

type ApplicationSearchRow = {
  application_id: Uuid;
  user_id: Uuid;
  applicant_name: string | null;
  applicant_email: string;
  store_name: string;
  store_id: Uuid | null;
  merchant_id: Uuid | null;
  documents: unknown;
  country: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  submitted_at: ISODate;
  reviewed_at: ISODate | null;
};

type ListingSearchRow = {
  listing_id: Uuid;
  merchant_id: Uuid;
  store_id: Uuid | null;
  store_name: string;
  merchant_name: string | null;
  product_id: Uuid;
  product_name: string;
  sales_price: string;
  wholesale_price: string;
  listing_status: "pending" | "active" | "suspended" | "inactive" | "removed";
  listed_at: ISODate;
};

type ListingRow = {
  id: Uuid;
  merchant_id: Uuid;
  product_id: Uuid;
  sales_price: string;
  discount_percentage: string;
  status: "pending" | "active" | "suspended" | "inactive" | "removed";
  created_at: ISODate;
  updated_at: ISODate;
};

type OrderSearchRow = {
  order_id: Uuid;
  store_id: Uuid;
  store_name: string;
  merchant_id: Uuid;
  merchant_name: string | null;
  customer_id: Uuid;
  customer_name: string | null;
  customer_email: string;
  status: OrderStatus;
  total_amount: string;
  wholesale_due: string;
  currency: "USD" | "BTC" | "ETH" | "USDT";
  created_at: ISODate;
};

type OrderStatus =
  | "pending"
  | "awaiting_payment"
  | "confirmed"
  | "paid"
  | "processing"
  | "shipping"
  | "shipped"
  | "delivered"
  | "completed"
  | "cancelled"
  | "refunded";

type OrderRow = {
  id: Uuid;
  customer_id: Uuid;
  merchant_id: Uuid;
  store_id: Uuid;
  status: OrderStatus;
  total_amount: string;
  currency: "USD" | "BTC" | "ETH" | "USDT";
  created_at: ISODate;
  updated_at: ISODate;
};

type OrderItemRow = {
  id: Uuid;
  listing_id: Uuid | null;
  product_id: Uuid;
  variant_id: Uuid;
  quantity: number;
  sales_price: string;
  wholesale_price: string;
  merchant_profit: string;
  created_at: ISODate;
};

type WalletTxRow = {
  id: Uuid;
  wallet_id: Uuid;
  type:
    | "deposit"
    | "withdrawal"
    | "order_payment"
    | "admin_adjustment"
    | "refund"
    | "profit_release"
    | "wholesale_return";
  amount: string;
  currency: "USD" | "BTC" | "ETH" | "USDT";
  direction: "credit" | "debit";
  status: "pending" | "completed" | "failed" | "cancelled";
  reference_type: string | null;
  reference_id: Uuid | null;
  description: string | null;
  created_at: ISODate;
  updated_at: ISODate;
};

type WalletAddressRow = {
  id: Uuid;
  asset: "BTC" | "ETH" | "USDT";
  network: "bitcoin" | "ethereum" | "erc20" | "trc20" | "bep20";
  wallet_address: string;
  status: "active" | "disabled";
  created_by: Uuid;
  created_at: ISODate;
  updated_at: ISODate;
};

type DepositRequestRow = {
  id: Uuid;
  merchant_id: Uuid;
  asset: "BTC" | "ETH" | "USDT";
  network: "bitcoin" | "ethereum" | "erc20" | "trc20" | "bep20";
  amount: string;
  wallet_address_id: Uuid | null;
  wallet_address_used: string;
  status: "pending" | "approved" | "rejected";
  created_at: ISODate;
  updated_at: ISODate;
  reviewed_by: Uuid | null;
  reviewed_at: ISODate | null;
};

type WithdrawalRequestRow = {
  id: Uuid;
  merchant_id: Uuid;
  asset: "BTC" | "ETH" | "USDT";
  network: "bitcoin" | "ethereum" | "erc20" | "trc20" | "bep20";
  amount: string;
  destination_address: string;
  status: "pending" | "approved" | "rejected" | "completed";
  created_at: ISODate;
  updated_at: ISODate;
  reviewed_by: Uuid | null;
  reviewed_at: ISODate | null;
};

type ProductRow = {
  id: Uuid;
  name: string;
  slug: string;
  description: string | null;
  brand_id: Uuid;
  category_id: Uuid;
  gender: "women" | "men" | "unisex";
  collection: string | null;
  price: string;
  currency: "USD" | "BTC" | "ETH" | "USDT";
  status: "draft" | "active" | "inactive" | "archived";
  published: boolean;
  created_at: ISODate;
  updated_at: ISODate;
};

type ProductImageRow = {
  id: Uuid;
  product_id: Uuid;
  storage_path: string;
  image_url: string | null;
  alt_text: string | null;
  sort_order: number;
  position: number;
  is_primary: boolean;
  created_at: ISODate;
  updated_at: ISODate;
};

type ProductVariantRow = {
  id: Uuid;
  product_id: Uuid;
  size: string | null;
  color: string | null;
  sku: string;
  price_override: string | null;
  is_active: boolean;
  created_at: ISODate;
  updated_at: ISODate;
};

type InventoryRow = {
  id: Uuid;
  variant_id: Uuid;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  availability: boolean;
  created_at: ISODate;
  updated_at: ISODate;
};

type InventoryTxRow = {
  id: Uuid;
  product_id: Uuid;
  variant_id: Uuid;
  type: "stock_added" | "stock_removed" | "order_reserved" | "order_released" | "adjustment";
  quantity: number;
  reference: string | null;
  created_by: Uuid | null;
  created_at: ISODate;
};

type BrandRow = {
  id: Uuid;
  name: string;
  slug: string;
  logo: string | null;
  description: string | null;
  status: "active" | "inactive";
  created_at: ISODate;
  updated_at: ISODate;
};

type CategoryRow = {
  id: Uuid;
  name: string;
  slug: string;
  description: string | null;
  parent_id: Uuid | null;
  created_at: ISODate;
  updated_at: ISODate;
};

type CreditScoreRow = {
  id: Uuid;
  merchant_id: Uuid;
  score: string;
  reason: string;
  updated_by: Uuid;
  created_at: ISODate;
};

type ActivityLogRow = {
  id: Uuid;
  admin_id: Uuid;
  action: string;
  target_type: string;
  target_id: Uuid | null;
  description: string | null;
  timestamp: ISODate;
  created_at: ISODate;
};

type NotificationRow = {
  id: Uuid;
  user_id: Uuid;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  read_status: "unread" | "read";
  created_at: ISODate;
  read_at: ISODate | null;
};

type HistoricalRunPresented = {
  runId: Uuid;
  status: "preview" | "running" | "completed" | "failed" | "reversed";
  target: { userId: Uuid; merchantId: Uuid | null; storeId: Uuid | null };
  period: { from: ISODate; to: ISODate };
  categories: string[];
  activityLevel: "low" | "medium" | "high";
  created: {
    deposits: number;
    withdrawals: number;
    orders: number;
    walletTransactions: number;
  };
  createdCounts: unknown;
  idempotencyKey: string | null;
  error: string | null;
  createdAt: ISODate;
  completedAt: ISODate | null;
  reversedAt: ISODate | null;
};
```

---

## 1. Users — `AdminUsersController` `@Controller('admin')`

| Method | Endpoint | Params / query / body | `data` |
| --- | --- | --- | --- |
| GET | `/admin/users` | query optional: `email?`, `userId?` UUID, `storeId?` UUID, `merchantId?` UUID, `q?`, `search?` | `UserRow[]` plus `id`, `userId`, `name` |
| GET | `/admin/users/:id` | path `id` UUID | `UserRow` |
| POST | `/admin/users/:id/suspend` | path `id` UUID, no body | `ProfileRow` (`status: "suspended"`) |
| POST | `/admin/users/:id/restore` | path `id` UUID, no body | `ProfileRow` (`status: "active"`) |
| GET | `/admin/activity-logs` | query optional: `action?`, `targetType?` | `ActivityLogRow[]` |

---

## 2. Merchants & listings — `AdminMerchantsController` `@Controller('admin')`

Call `/admin/merchants/applications` **before** treating `/admin/merchants/:id` as a UUID (static path).

| Method | Endpoint | Params / query / body | `data` |
| --- | --- | --- | --- |
| GET | `/admin/merchants` | query optional: `storeId?` UUID, `q?` | `MerchantSearchRow[]` |
| GET | `/admin/merchants/applications` | query optional: `status?` pending\|approved\|rejected\|suspended, `q?` | `ApplicationSearchRow[]` |
| GET | `/admin/merchants/:id` | path `id` = **merchant UUID** | see below |
| POST | `/admin/merchants/:id/approve` | path `id` = **application UUID**, no body | `{ application_id, merchant_id, store_id, user_id, role, store_name, status }` |
| POST | `/admin/merchants/:id/reject` | path `id` = **application UUID**; body `{ reason?: string ≤240 }` | `{ application_id, merchant_id, user_id, status }` |
| POST | `/admin/merchants/:id/wholesale-access` | path `id` = **merchant UUID**; body `{ enabled: boolean }` required | `MerchantRow` |
| GET | `/admin/wholesale/listings` | query optional: `storeId?`, `merchantId?`, `merchant?`, `product?`, `status?` pending\|active\|suspended\|inactive\|removed | `ListingSearchRow[]` |
| POST | `/admin/wholesale/listings/:id/disable` | listing UUID | `ListingRow` (`status: "inactive"`) |
| POST | `/admin/wholesale/listings/:id/remove` | listing UUID | `ListingRow` (`status: "removed"`) |

`GET /admin/merchants/:id` `data`:

```ts
{
  merchant_id: Uuid;
  store_id: Uuid | null;
  store_name: string;
  owner: {
    name: string | null;
    email: string;
    phone: string | null;
    country: string | null;
  };
  verification_status: "pending" | "approved" | "rejected";
  account_status: "active" | "suspended" | "blocked";
  wholesale_enabled: boolean;
  store: { id, store_name, description, logo, status, created_at } | null;
  listings: ListingSearchRow[];
  orders: Array<{
    id: Uuid;
    customer_id: Uuid;
    store_id: Uuid;
    status: OrderStatus;
    total_amount: string;
    currency: string;
    created_at: ISODate;
  }>;
  wallets: Array<{ id: Uuid; currency: string; balance: string; updated_at: ISODate }>;
  transactions: WalletTxRow[];
}
```

---

## 3. Stores — `AdminStoresController` `@Controller('admin/stores')`

| Method | Endpoint | Params / query / body | `data` |
| --- | --- | --- | --- |
| GET | `/admin/stores` | query optional: `storeId?`, `merchantId?`, `storeName?`, `email?`, `q?` (`q` aliases `storeName`) | `StoreSearchRow[]` |
| GET | `/admin/stores/:storeId` | store UUID | composed object below |
| GET | `/admin/stores/:storeId/products` | store UUID | `StoreProductRow[]` |
| GET | `/admin/stores/:storeId/orders` | store UUID | `StoreOrderRow[]` |
| POST | `/admin/stores/:id/balance-adjust` | `{ amount: number > 0, direction: "credit"\|"debit", reason: string 3–240, currency?: "USD"\|"BTC"\|"ETH"\|"USDT" }` default USD | `WalletTxRow` |
| POST | `/admin/stores/:id/credit-adjust` | `{ score: 0–100, reason: string 3–240 }` | `CreditScoreRow` |
| POST | `/admin/stores/:id/status` | `{ status: "active"\|"suspended", reason?: string }` | `StoreRow` |
| POST | `/admin/stores/:id/wholesale-access` | `{ enabled: boolean }` | `MerchantRow` |
| POST | `/admin/stores/:id/viewers` | `{ viewerCount: 0–1000000, reason: string 3–240 }` | `{ store_id, viewer_count, reason, updated_by, created_at, updated_at }` |

`GET /admin/stores/:storeId` `data`:

```ts
{
  merchant: {
    merchant_id: Uuid;
    owner_user_id: Uuid;
    owner_name: string | null;
    owner_email: string;
    owner_phone: string | null;
    country: string | null;
    verification_status: string;
    merchant_status: string;
    wholesale_enabled: boolean;
  };
  store: {
    store_id: Uuid;
    store_name: string;
    logo: string | null;
    description: string | null;
    owner_user_id: Uuid;
    owner_name: string | null;
    owner_email: string;
    owner_phone: string | null;
    country: string | null;
    status: string;
    approval_date: ISODate | null;
    merchant_id: Uuid;
    verification_status: string;
    merchant_status: string;
    wholesale_enabled: boolean;
  };
  statistics: {
    store_id: Uuid;
    merchant_id: Uuid;
    total_products_listed: number;
    active_products: number;
    removed_products: number;
    total_orders: number;
    todays_orders: number;
    completed_orders: number;
    pending_orders: number;
    total_sales: string;
    todays_sales: string;
    total_profit: string;
    todays_profit: string;
    total_followers: number; // currently the displayed viewer count, not live followers
    credit_score: string;
  } | null;
  financials: Array<{
    currency: string;
    wallet_id: Uuid;
    wallet_balance: string;
    total_deposits: string;
    total_withdrawals: string;
    order_payments: string;
    profit_releases: string;
    refunds: string;
    wholesale_returns: string;
  }>;
  products: StoreProductRow[];
  orders: StoreOrderRow[];
  wallets: Array<{ id: Uuid; currency: string; balance: string }>;
  transactions: WalletTxRow[];
  credit_scores: CreditScoreRow[];
}

type StoreProductRow = {
  listing_id: Uuid;
  product_id: Uuid;
  image: string | null;
  name: string;
  category: string;
  sales_price: string;
  profit: string;
  listing_date: ISODate;
  status: string;
};

type StoreOrderRow = {
  order_id: Uuid;
  product: string;
  customer_id: Uuid;
  customer_name: string | null;
  customer_email: string;
  amount: string;
  wholesale_amount: string;
  profit: string;
  status: OrderStatus;
  created_at: ISODate;
};
```

---

## 4b. Shipment queue — `AdminShipmentQueueController` `@Controller('admin/shipment-queue')`

Aggregates real orders awaiting admin fulfillment from existing order RPCs. No fabricated rows.

| Method | Endpoint | `data` |
| --- | --- | --- |
| GET | `/admin/shipment-queue` | `{ customerOrders: OrderSearchRow[], merchantOrders: MerchantOrderGrouped[], summary: { customerOrderCount, merchantOrderCount, totalCount } }` |

Customer orders are `shipping` or `shipped` (use `POST /admin/orders/:id/deliver`). Merchant orders are `shipping` or `shipped` (use `POST /admin/merchant-orders/:id/complete`).

---

## 4. Customer orders — `AdminOrdersController` `@Controller('admin/orders')`

| Method | Endpoint | Params / query / body | `data` |
| --- | --- | --- | --- |
| GET | `/admin/orders` | query optional: `orderId?` UUID, `storeId?` UUID, `merchant?`, `customer?`, `status?` (OrderStatus) | `OrderSearchRow[]` |
| GET | `/admin/orders/:id` | order UUID | `OrderSearchRow & { items: OrderItemRow[]; payments: WalletTxRow[] }` |
| GET | `/admin/orders/:id/payments` | order UUID | `WalletTxRow[]` |
| POST | `/admin/orders/:id/deliver` | no body | `OrderRow` |
| POST | `/admin/orders/:id/cancel` | no body | `OrderRow` |

---

## 5. Merchant orders — `AdminMerchantOrdersController` `@Controller('admin/merchant-orders')`

Grouped in Nest (not raw RPC rows). `wholesale_due` is a **number**.

| Method | Endpoint | Params / query / body | `data` |
| --- | --- | --- | --- |
| GET | `/admin/merchant-orders` | query optional: `orderId?`, `storeId?`, `merchantId?`, `product?` | `MerchantOrderGrouped[]` |
| GET | `/admin/merchant-orders/:id` | order UUID | `MerchantOrderGrouped & { payments: WalletTxRow[] }` |
| POST | `/admin/merchant-orders/:id/complete` | no body (financial throttle) | `OrderRow` |

```ts
type MerchantOrderGrouped = {
  order_id: Uuid;
  store_id: Uuid;
  store_name: string;
  merchant_id: Uuid;
  merchant_name: string | null;
  status: OrderStatus;
  total_amount: string;
  currency: string;
  created_at: ISODate;
  amount_paid: string;
  customer: { id: Uuid; name: string | null; email: string };
  items: Array<{
    item_id: Uuid;
    listing_id: Uuid | null;
    product_id: Uuid;
    product_name: string;
    primary_image_url: string | null;
    quantity: number;
    sales_price: string;
    wholesale_price: string;
    profit: string;
    amount_required: string;
  }>;
  wholesale_due: number;
};
```

---

## 6. Wallets — `AdminWalletsController` `@Controller('admin/wallets')`

Financial POSTs: 10 / 60s.

| Method | Endpoint | Params / query / body | `data` |
| --- | --- | --- | --- |
| GET | `/admin/wallets/addresses` | — | `WalletAddressRow[]` |
| POST | `/admin/wallets/addresses` | `{ asset: "BTC"\|"ETH"\|"USDT", network: "bitcoin"\|"ethereum"\|"erc20"\|"trc20"\|"bep20", walletAddress: string 8–128 }` | `WalletAddressRow` |
| PATCH | `/admin/wallets/addresses/:id` | `{ walletAddress?: string, network?: ... }` | `WalletAddressRow` |
| POST | `/admin/wallets/addresses/:id/disable` | no body | `WalletAddressRow` |
| DELETE | `/admin/wallets/addresses/:id` | — | `WalletAddressRow` |
| GET | `/admin/wallets/deposits` | query optional: `storeId?`, `merchant?`, `status?` pending\|approved\|rejected | `DepositSearchRow[]` |
| POST | `/admin/wallets/deposits/:id/approve` | deposit **request** UUID | `DepositRequestRow` |
| POST | `/admin/wallets/deposits/:id/reject` | deposit **request** UUID | `DepositRequestRow` |
| GET | `/admin/wallets/withdrawals` | query optional: `storeId?`, `merchant?`, `status?` pending\|approved\|rejected\|completed | `WithdrawalSearchRow[]` |
| POST | `/admin/wallets/withdrawals/:id/approve` | withdrawal **request** UUID | `WithdrawalRequestRow` |
| POST | `/admin/wallets/withdrawals/:id/reject` | withdrawal **request** UUID | `WithdrawalRequestRow` |
| POST | `/admin/wallets/merchants/:id/adjust` | path = **merchant** UUID; `{ currency, amount, direction: "credit"\|"debit", reason }` | `WalletTxRow` |

```ts
type DepositSearchRow = {
  request_id: Uuid;
  merchant_id: Uuid;
  store_id: Uuid | null;
  store_name: string;
  merchant_name: string | null;
  amount: string;
  asset: string;
  network: string;
  wallet_address_used: string;
  status: "pending" | "approved" | "rejected";
  created_at: ISODate;
};

type WithdrawalSearchRow = {
  request_id: Uuid;
  merchant_id: Uuid;
  store_id: Uuid | null;
  store_name: string;
  merchant_name: string | null;
  amount: string;
  asset: string;
  network: string;
  destination_address: string;
  status: "pending" | "approved" | "rejected" | "completed";
  created_at: ISODate;
};
```

There is **no** `GET /admin/wallets` and **no** `GET /admin/wallets/merchants/:id`.

---

## 7. Products — `AdminProductsController` `@Controller('admin')`

No `GET /admin/products/:id`. List is unfiltered. No `GET /admin/brands` or `GET /admin/categories` — use public catalogue:

- `GET /catalogue/brands`
- `GET /catalogue/categories`

| Method | Endpoint | Body / query | `data` |
| --- | --- | --- | --- |
| GET | `/admin/products` | — | `ProductRow[]` |
| POST | `/admin/products` | `{ name, brandId, categoryId, price, slug?, description?, gender?, collection?, currency?, status? }` | `ProductRow` |
| PATCH | `/admin/products/:id` | any subset of create fields | `ProductRow` |
| POST | `/admin/products/:id/publish` | — | `ProductRow` (`published: true`) |
| POST | `/admin/products/:id/unpublish` | — | `ProductRow` (`published: false`) |
| DELETE | `/admin/products/:id` | archives, does not hard-delete | `ProductRow` (`status: "archived"`) |
| POST | `/admin/products/:id/images` | `{ storagePath, imageUrl?, altText?, position?, isPrimary? }` | `ProductImageRow` |
| POST | `/admin/products/:id/images/upload` | multipart field `file`; optional form `altText`, `isPrimary` (`"true"`) | `ProductImageRow` |
| POST | `/admin/products/:id/images/:imageId/primary` | — | `ProductImageRow` |
| DELETE | `/admin/products/:id/images/:imageId` | — | `ProductImageRow` |
| POST | `/admin/products/:id/variants` | `{ sku, size?, color?, priceOverride?, isActive? }` | `ProductVariantRow` |
| PATCH | `/admin/variants/:id` | subset of variant fields | `ProductVariantRow` |
| POST | `/admin/variants/:id/inventory` | `{ type: "stock_added"\|"stock_removed"\|"adjustment", quantity ≥ 1, reference? }` | `InventoryRow` |
| GET | `/admin/inventory-transactions` | query optional: `variantId` | `InventoryTxRow[]` |
| POST | `/admin/brands` | `{ name, slug?, logo?, description? }` | `BrandRow` |
| PATCH | `/admin/brands/:id` | `{ name?, slug?, logo?, description?, status?: "active"\|"inactive" }` | `BrandRow` |
| POST | `/admin/categories` | `{ name, slug?, description?, parentId? }` | `CategoryRow` |
| PATCH | `/admin/categories/:id` | subset | `CategoryRow` |

---

## 8. Notifications — `AdminNotificationsController` `@Controller('admin/notifications')`

Returns **the logged-in admin’s** inbox, not a platform-wide feed. No mark-read on this controller (use `/notifications/:id/read` if needed).

| Method | Endpoint | `data` |
| --- | --- | --- |
| GET | `/admin/notifications` | `{ unread: NotificationRow[], read: NotificationRow[], realtime: { schema, table, filter, events } }` |
| GET | `/admin/notifications/unread-count` | `{ count: number, realtime: { schema, table, filter, events } }` |
| POST | `/admin/notifications` | `{ userId: uuid, type: NotificationType, title: string ≤200, message: string ≤2000, data?: object }` | `NotificationRow` |

---

## 9. Historical Records — `HistoricalDataController` `@Controller('admin')`

Throttle on preview/generate/reverse: **3 / 60s**. Path `:id` is the target user UUID. Body `userId` is optional; if sent it must match `:id`.

The Control Center generate call is:

`POST /admin/users/:id/historical-data/generate` `{ "months": 6, "volume": "medium" }`

The backend always uses the last **6 months**. `months`, `from`, `to`, and `rangePreset` are ignored.

| Method | Endpoint | Body | `data` |
| --- | --- | --- | --- |
| GET | `/admin/users/:id/historical-data` | — | overview below (`records` / `rows` for DataPanel) |
| POST | `/admin/users/:id/historical-data/preview` | optional types | preview below |
| POST | `/admin/users/:id/historical-data/generate` | `{ months?, volume?, historyTypes?, selectAll?, categories?, confirm?, idempotencyKey? }` | presented run with processed counts |
| GET | `/admin/users/:id/historical-data/runs` | — | presented runs |
| GET | `/admin/historical-data/runs/:runId` | — | presented run |
| POST | `/admin/historical-data/runs/:runId/reverse` | — | presented run |

History types: `deposits`, `withdrawals`, `profits`, `orders`, `payments`, `billing`, `wallet`. Omit them or send `selectAll: true` to process every type the account supports. Profits/payments/billing are created through existing orders and wallet transactions — not a separate fake table.

Generate `data` includes `id`, `runId`, `status`, `progress`, `deposits`, `withdrawals`, `orders`, `profits`, `payments`, `billing`, `walletTransactions`, plus nested `created` and `processed`. Counts come from the database run.

Duplicate generates return the existing completed run (`duplicate: true`) or 409 if overlapping history already exists. Reverse first to create a new set.

---

## Routes that do not exist

Do not call these. They are 404 or 422:

| Frontend often wants | What exists |
| --- | --- |
| `?limit=` / `?page=` / `?offset=` on any admin list | nothing — omit them |
| `store_id`, `user_id`, `merchant_id` query keys | `storeId`, `userId`, `merchantId` |
| `GET /admin/dashboard` or `/admin/stats` | compose from `/admin/stores/:id` + list endpoints |
| `GET /admin/merchants?limit=` | `GET /admin/merchants?storeId=&q=` |
| `GET /admin/orders?limit=` | `GET /admin/orders?orderId=&storeId=&merchant=&customer=&status=` |
| `GET /admin/users?limit=` | `GET /admin/users?email=&userId=&storeId=&merchantId=&q=` |
| `PATCH /admin/users/:id` | only suspend/restore POSTs |
| `GET /admin/brands` / `GET /admin/categories` | `GET /catalogue/brands`, `GET /catalogue/categories` |
| `GET /admin/products/:id` | `GET /admin/products` then find by `id` |
| `GET /admin/wallets` | `/admin/wallets/addresses`, `/deposits`, `/withdrawals` |
| `POST /admin/orders/:id/status` | `/deliver` or `/cancel` only |
| mark-read under `/admin/notifications` | `POST /notifications/:id/read` (user inbox) |

Approve/reject **applications** use the application UUID on `/admin/merchants/:id/approve|reject`, not the merchant UUID.

---

## Integration checklist for Lovable

1. Login → store `data.session.accessToken` and `data.session.refreshToken`.
2. Send `Authorization: Bearer …` on every `/admin/*` call.
3. Refresh with `POST /auth/refresh` when tokens expire.
4. Read `response.data`, not the raw array at the root.
4. Use only the query keys in this document. Extra keys = 422.
5. Map list rows by `merchant_id` / `store_id` / `order_id` / `user_id` / `request_id` — not always `id`.
6. Amounts are usually strings. Merchant-order `wholesale_due` is a number.
7. Historical generate/list/get/reverse use camelCase (`runId`). Overview `recentRuns` is snake_case table JSON.
