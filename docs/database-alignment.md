# Production database alignment (STOP — do not migrate frontend yet)

**Status: frontend migration paused.** The Lovable app at `rbmaisons.com` must keep using the **existing** Supabase Auth session and database until NestJS is confirmed to point at the **same** hosted project.

## One production system (target state)

```
Lovable frontend  →  NestJS API  →  SAME hosted Supabase project
                         ↑
              same auth.users, profiles, orders, wallets, ledger
```

## What must NOT happen

| Action | Risk |
| --- | --- |
| Point NestJS at local Supabase (`127.0.0.1:54321`) in production | Empty second database; live users invisible |
| Use a different hosted Supabase project for NestJS | Duplicate user system, split orders/wallets |
| Run `npx supabase db reset` on production | **Total data loss** |
| Run `db push` without reviewing diff | May break live schema mid-flight |
| Switch Lovable to NestJS auth before verification | Mass logout, broken sessions |
| Create new signup flow on a fresh DB | Abandons existing accounts |

## Live production Supabase project

The hosted project referenced in this repo:

| Setting | Value |
| --- | --- |
| Project ref | `sbcyoaswsjfhhkypdniu` |
| URL | `https://sbcyoaswsjfhhkypdniu.supabase.co` |

**Confirm this matches** Supabase Dashboard → Project Settings → General → Reference ID for the project that currently serves `rbmaisons.com` / Lovable.

Lovable and NestJS must both use:

- **Same** `SUPABASE_URL`
- **Same** `SUPABASE_ANON_KEY` (public; RLS still applies with user JWT)
- **Same** `auth.users` table (existing logins keep working)

NestJS server only (never in Lovable bundle):

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`

## Step 1 — Align NestJS environment (no code deploy to Lovable)

Set on the **NestJS host only** (`.env`, Docker secrets, or platform env):

```env
NODE_ENV=production
CORS_ORIGIN=https://rbmaisons.com

# MUST match Lovable / live frontend Supabase project exactly
SUPABASE_URL=https://sbcyoaswsjfhhkypdniu.supabase.co
SUPABASE_ANON_KEY=<same anon key as Lovable>
SUPABASE_SERVICE_ROLE_KEY=<from dashboard — server only>
SUPABASE_JWT_SECRET=<from dashboard — server only>

# Guardrail — boot fails if URL points at a different project
SUPABASE_PROJECT_REF=sbcyoaswsjfhhkypdniu
```

Copy anon key from the Lovable project settings or Supabase Dashboard → API.  
If NestJS uses a **different** anon key from a **different** project, authentication and data will not match production.

## Step 2 — Verify read-only alignment

Run from this repo (credentials via environment, never commit):

```powershell
$env:SUPABASE_URL="https://sbcyoaswsjfhhkypdniu.supabase.co"
$env:SUPABASE_ANON_KEY="<anon>"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role>"
$env:SUPABASE_JWT_SECRET="<jwt-secret>"
$env:SUPABASE_PROJECT_REF="sbcyoaswsjfhhkypdniu"
$env:VERIFY_USER_EMAIL="<existing production user>"
$env:VERIFY_USER_PASSWORD="<password>"
npm run verify:production-db
```

The script:

- Refuses local Supabase URLs
- Confirms project ref matches `SUPABASE_PROJECT_REF`
- Counts existing rows in `profiles`, `orders`, `wallets`, etc. (**read-only**)
- Logs in an **existing** user and verifies profile, applications, merchant/wallet/orders access using the same JWT path NestJS uses

**All checks must pass before any frontend auth switch.**

## Step 3 — Verify NestJS health endpoint

Start API with production env, then:

```http
GET /api/v1/health
```

Expect:

```json
{
  "supabase": {
    "status": "up",
    "configured": true,
    "projectRef": "sbcyoaswsjfhhkypdniu"
  }
}
```

If `projectRef` is missing or wrong, NestJS is not on the live database.

## Step 4 — Verify NestJS auth for an existing user (manual)

With API running against production Supabase:

```http
POST /api/v1/auth/login
{ "email": "<existing user>", "password": "<password>" }
```

Then with returned `data.session.accessToken`:

| Check | Route |
| --- | --- |
| Profile | `GET /api/v1/profile` |
| Store application | `GET /api/v1/store-applications/me` |
| Merchant store | `GET /api/v1/merchant/store` |
| Orders | `GET /api/v1/orders` or merchant order routes |
| Wallet | `GET /api/v1/merchant/wallet` |
| Ledger | `GET /api/v1/merchant/wallet/transactions` |

Compare counts/IDs with what the user sees in Lovable today. They must match.

## Schema migrations — proceed with caution

Recent NestJS migrations (`20260821000026`, `20260821000027`) may **not** yet be applied on production.

**Before** `db push`:

```bash
npx supabase link --project-ref sbcyoaswsjfhhkypdniu
npx supabase db diff --linked
```

- Review every SQL change
- Prefer additive migrations only
- Never `db reset` production
- Apply during a maintenance window if RPC signatures change

If production schema differs, NestJS may need to run against existing Lovable tables **without** new migrations until diff is approved.

## Frontend migration gate (do not start until checklist complete)

- [ ] NestJS `SUPABASE_URL` + anon key match Lovable project
- [ ] `npm run verify:production-db` passes with real production user
- [ ] `/health` shows correct `projectRef`
- [ ] `POST /auth/login` works for existing user (no new signup)
- [ ] Profile / orders / wallet data match Lovable for that user
- [ ] Schema diff reviewed; migrations applied safely if needed
- [ ] **Only then** plan Lovable switch from direct Supabase → NestJS API

## What stays unchanged during alignment

- Lovable continues direct Supabase Auth (users stay logged in)
- Existing `auth.users`, profiles, orders, wallet ledger untouched
- No second database, no user re-registration
