# Production database alignment (STOP — do not migrate frontend yet)

**Status: frontend migration paused.** The Lovable app at `rbmaisons.com` must keep using the **existing** Supabase Auth session and database until NestJS is confirmed to point at the **same** hosted project.

## One production system (target state)

```
Lovable frontend  →  NestJS API (Railway)  →  SAME hosted Supabase project
         ↑                    ↑
   elvypbekopexhcojpwki   same URL, anon key, JWT secret
```

## Verified mismatch (2026-08-21)

| Component | Supabase project | Evidence |
| --- | --- | --- |
| **Lovable frontend** | `elvypbekopexhcojpwki` | `VITE_SUPABASE_URL` in production bundle; live catalogue on rbmaisons.com |
| **NestJS (Railway)** | `sbcyoaswsjfhhkypdniu` | `GET https://rbmaison-backend-production-f5dd.up.railway.app/api/v1/health` → `projectRef: sbcyoaswsjfhhkypdniu` |
| **NestJS (local `.env` in repo)** | `sbcyoaswsjfhhkypdniu` | Same as Railway — **wrong project** |

The empty Control Center (2 users, 0 products/orders) is caused by this split, not missing backend routes.

## Live production Supabase project (Lovable)

| Setting | Value |
| --- | --- |
| Project ref | `elvypbekopexhcojpwki` |
| URL | `https://elvypbekopexhcojpwki.supabase.co` |

The older ref `sbcyoaswsjfhhkypdniu` is a separate hosted project and must **not** be used for NestJS or Railway in production.

## What must NOT happen

| Action | Risk |
| --- | --- |
| Point NestJS at local Supabase (`127.0.0.1:54321`) in production | Empty second database; live users invisible |
| Keep NestJS on `sbcyoaswsjfhhkypdniu` while Lovable uses `elvypbekopexhcojpwki` | Split users, empty admin panels, JWT validation failures |
| Run `npx supabase db reset` on production | **Total data loss** |
| Run `db push` without reviewing diff | May break live schema mid-flight |
| Switch Lovable to NestJS auth before verification | Mass logout, broken sessions |
| Create new signup flow on a fresh DB | Abandons existing accounts |

## Step 1 — Align NestJS + Railway environment

Set on **Railway** and local `.env` (never commit secrets):

```env
NODE_ENV=production
CORS_ORIGIN=https://rbmaisons.com

# MUST match Lovable production Supabase project exactly
SUPABASE_URL=https://elvypbekopexhcojpwki.supabase.co
SUPABASE_ANON_KEY=<anon key from elvypbekopexhcojpwki dashboard>
SUPABASE_SERVICE_ROLE_KEY=<service role from same project>
SUPABASE_JWT_SECRET=<JWT secret from same project>

# Guardrail — boot fails if URL ref mismatches
SUPABASE_PROJECT_REF=elvypbekopexhcojpwki
```

Copy keys from Supabase Dashboard → Project **elvypbekopexhcojpwki** → Settings → API.

Redeploy Railway after updating variables.

## Step 2 — Verify read-only alignment

```powershell
$env:SUPABASE_URL="https://elvypbekopexhcojpwki.supabase.co"
$env:SUPABASE_ANON_KEY="<anon>"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role>"
$env:SUPABASE_JWT_SECRET="<jwt-secret>"
$env:SUPABASE_PROJECT_REF="elvypbekopexhcojpwki"
$env:VERIFY_USER_EMAIL="<existing production user>"
$env:VERIFY_USER_PASSWORD="<password>"
npm run verify:production-db
```

Expect non-zero counts for `products`, `profiles`, etc. on the live maison.

## Step 3 — Verify NestJS health endpoint

```http
GET https://rbmaison-backend-production-f5dd.up.railway.app/api/v1/health
```

Expect:

```json
{
  "supabase": {
    "configured": true,
    "projectRef": "elvypbekopexhcojpwki"
  }
}
```

## Step 4 — Verify Control Center APIs

```powershell
$env:API_URL="https://rbmaison-backend-production-f5dd.up.railway.app"
$env:VERIFY_ADMIN_EMAIL="<admin email>"
$env:VERIFY_ADMIN_PASSWORD="<password>"
npm run verify:control-center
```

See `docs/control-center-pages.md` for the full page → endpoint map.

## Step 5 — Historical E2E (manual)

1. Admin → `/control-center/historical` → select real user → generate
2. User login on rbmaisons.com → confirm wallet/order history shows new rows

## Schema migrations — proceed with caution

Link to the **live** project before diff:

```bash
npx supabase link --project-ref elvypbekopexhcojpwki
npx supabase db diff --linked
```

- Review every SQL change
- Prefer additive migrations only
- Never `db reset` production

## Frontend migration gate (do not start until checklist complete)

- [ ] Railway + NestJS `SUPABASE_URL` + keys match Lovable (`elvypbekopexhcojpwki`)
- [ ] `/health` shows `projectRef: elvypbekopexhcojpwki`
- [ ] `npm run verify:production-db` passes with real production user
- [ ] `npm run verify:control-center` passes with admin credentials
- [ ] Profile / orders / wallet data match Lovable for that user
- [ ] Schema diff reviewed; migrations applied safely if needed
