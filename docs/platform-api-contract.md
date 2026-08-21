# R&B MAISON — Platform API contract (customer + merchant)

Base URL: `{API_ORIGIN}/api/v1`  
Envelope: `{ success, data, timestamp, path }`  
Auth header: `Authorization: Bearer <accessToken>`

## Auth

| Method | Route | Auth | Body | `data` |
| --- | --- | --- | --- | --- |
| POST | `/auth/signup` | none | `{ email, password, fullName?, phone?, country? }` | `{ user, session }` |
| POST | `/auth/login` | none | `{ email, password }` | `{ user: { id, email, role, status }, session }` |
| POST | `/auth/refresh` | none | `{ refreshToken }` | same as login |
| GET | `/auth/session` | Bearer | — | `{ user, session }` |
| POST | `/auth/logout` | Bearer | — | `{ loggedOut: true }` |

## Profile

| Method | Route | Auth | Body | `data` |
| --- | --- | --- | --- | --- |
| GET | `/profile` | Bearer | — | full `profiles` row |
| PATCH | `/profile` | Bearer | `{ fullName?, phone?, country?, avatar? }` | updated profile |
| POST | `/profile/avatar/upload` | Bearer | multipart `file` | updated profile with avatar URL |

## Store application (customer role)

| Method | Route | Auth | Body | `data` |
| --- | --- | --- | --- | --- |
| POST | `/store-applications/documents/upload` | customer | multipart `file` + form `kind` (`passport`, `national_id_front`, `national_id_back`, `store_logo`, `other`) | uploaded document descriptor |
| POST | `/store-applications` | customer | see below | `merchant_applications` row (`status: pending`) |
| GET | `/store-applications/me` | customer | — | application array newest first |

Submit body:

```json
{
  "storeName": "Maison Atelier",
  "businessDescription": "...",
  "country": "France",
  "phone": "+33123456789",
  "address": "12 Rue de Rivoli, Paris",
  "identityDocumentType": "passport",
  "logo": "https://.../logo.webp",
  "documents": [
    {
      "kind": "passport",
      "storagePath": "<userId>/...pdf",
      "mimeType": "application/pdf"
    }
  ]
}
```

Rules enforced in API + database:

- `identityDocumentType=passport` requires a `passport` document.
- `identityDocumentType=national_id` requires `national_id_front` and `national_id_back`.
- Application documents are stored in private bucket `application-documents`.
- Default status is always `pending`.

## Merchant store (merchant role)

| Method | Route | Auth | Body | `data` |
| --- | --- | --- | --- | --- |
| GET | `/merchant/store` | merchant | — | store profile |
| PATCH | `/merchant/store` | merchant | `{ storeName?, description?, logo? }` | updated `stores` row |
| POST | `/merchant/store/logo/upload` | merchant | multipart `file` | updated store with logo |
| GET | `/merchant/shop-details` | merchant | — | shop details + products + financials |
| GET | `/merchant/shop-statistics` | merchant | — | statistics + financials |

## Orders, wallet, catalogue, notifications

These surfaces already existed and remain database-backed:

- Customer orders: `POST/GET /orders`, `POST /orders/:id/cancel`
- Merchant orders: `/merchant/store/orders/*`, wholesale wallet confirm/shipping
- Wallet: `/merchant/wallet/*` + admin approve/reject deposits/withdrawals
- Public catalogue: `GET /catalogue/*`
- Notifications: `GET/PATCH /notifications/*` with Supabase Realtime metadata in responses

Admin routes: see `docs/admin-api-contract.md`.

## Payment model (important)

This backend does **not** integrate PayPal or card checkout. There is no PayPal SDK, webhook route, or capture endpoint in this repository.

Customer checkout creates a real order record. Merchant wholesale payment is debited from the merchant wallet through server RPCs when the merchant confirms the order. Deposits fund wallets after admin approval.

Do not mark orders paid from the frontend. Payment state changes only through backend RPCs and ledger rows.

## Realtime

No Nest WebSocket layer. Use Supabase Realtime client-side with metadata from notification list endpoints:

```json
{
  "realtime": {
    "schema": "public",
    "table": "notifications",
    "filter": "user_id=eq.<uuid>",
    "events": ["INSERT", "UPDATE"]
  }
}
```

Refresh profile/application/order/wallet queries after admin actions if a table has no Realtime subscription.
