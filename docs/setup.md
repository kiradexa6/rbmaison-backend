# R&B MAISON — Setup

## Prerequisites

- Node.js 22+
- npm 10+
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (used via `npx supabase`)
- Docker (required for `supabase start`)

## 1. Install application dependencies

```bash
npm install
cp .env.example .env
```

## 2. Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | No (default `development`) | `development`, `production`, or `test`. Production refuses to boot without Supabase keys. |
| `APP_NAME` | No | Process name. Default `RBMaison`. |
| `PORT` | No | HTTP port. Default `3000`. |
| `API_PREFIX` | No | Global prefix. Default `api/v1`. |
| `CORS_ENABLED` | No | Default `true`. |
| `CORS_ORIGIN` | Production: explicit origin | Comma-separated origins. `*` is allowed only outside production. |
| `LOG_LEVEL` | No | Winston level. |
| `SUPABASE_URL` | Production yes | Project URL. Local default `http://127.0.0.1:54321`. |
| `SUPABASE_ANON_KEY` | Production yes | Public anon key. Used with a user access token so RLS applies. |
| `SUPABASE_SERVICE_ROLE_KEY` | Production yes | Server-only key. Bypasses RLS. Never send this to a browser or mobile app. |
| `SUPABASE_JWT_SECRET` | Production yes | JWT secret from Project Settings → API. Server-only. Never send to a client. |

Copy keys from **Supabase Dashboard → Project Settings → API**, or from `npx supabase status` when running locally.

## 3. Start local Supabase and apply migrations

```bash
npx supabase start
npx supabase db reset
```

`db reset` applies every file in `supabase/migrations/` against a clean local database.

To push the same migrations to a hosted project:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

## 4. Create the seed admin account

No admin user is inserted automatically.

1. Create a real Auth user in **Authentication → Users** (or sign up with email confirmation).
2. Open `supabase/templates/bootstrap_admin.sql`.
3. Replace `ADMIN_EMAIL_HERE` with that user's email.
4. Run the script in the Supabase SQL Editor (postgres role).

The script sets `profiles.role = 'admin'`, `profiles.status = 'active'`, and `auth.users.raw_app_meta_data.role = 'admin'`.

After promotion, the admin must sign in again so the JWT carries the updated `app_metadata.role`.

## 5. Issue a merchant invitation code

As the admin, call the database function (SQL Editor or a later Admin API):

```sql
select *
from public.create_merchant_invitation_code(
  p_max_usage := 1,
  p_expires_at := now() + interval '14 days'
);
```

A customer then registers with:

```sql
select *
from public.register_merchant_with_invitation(
  p_invitation_code := '<code>',
  p_store_name := 'Maison Store',
  p_business_email := 'store@example.com',
  p_phone := '+15551234567',
  p_country := 'United States'
);
```

Invalid, expired, inactive, or exhausted codes fail. The user cannot set `role = merchant` themselves.

## 6. Run the NestJS API

```bash
npm run start:dev
```

Health check: `GET http://localhost:3000/api/v1/health`.

The API process holds the service role key for privileged operations. User-scoped reads/writes must go through `SupabaseService.asUser(accessToken)` so PostgreSQL RLS is applied.
