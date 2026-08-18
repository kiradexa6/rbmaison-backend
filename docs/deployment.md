# R&B MAISON — Deployment

This repository is the NestJS API. Data, Auth, Storage, and RLS run on Supabase (hosted PostgreSQL).

## 1. Provision Supabase

1. Create a hosted project (region close to the API).
2. Do not disable RLS. Migrations enable it on every public table.
3. Confirm email auth settings: confirmations on, minimum password length 12 (mirrored in `supabase/config.toml` for local).
4. Set Auth URL configuration:
   - Site URL: production frontend origin
   - Redirect URLs: production and staging callback URLs only

## 2. Apply migrations

From a CI job or an operator machine with the Supabase CLI:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

`db push` applies `supabase/migrations/` in timestamp order. Do not edit applied migrations; add a new file.

After the first push:

1. Create the first Auth user.
2. Run `supabase/templates/bootstrap_admin.sql` in the SQL Editor (replace the email).
3. Verify Storage buckets `avatars`, `store-logos`, and `product-images` exist.

## 3. Configure the API

Set these on the host (never commit them):

```
NODE_ENV=production
APP_NAME=RBMaison
PORT=3000
API_PREFIX=api/v1
CORS_ENABLED=true
CORS_ORIGIN=https://your-production-origin
LOG_LEVEL=info
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret>
```

The process will not start in production if the three Supabase keys/URL are missing.

### Docker

```bash
docker compose up -d --build
```

`docker-compose.yml` forwards the Supabase variables into the container. The service role key must be injected by the orchestrator/secret manager, not baked into the image.

## 4. Secrets handling

| Secret | Where it may live |
| --- | --- |
| `SUPABASE_ANON_KEY` | Server and browser (it is public, but RLS still applies). |
| `SUPABASE_SERVICE_ROLE_KEY` | API server only. Bypasses RLS. |
| `SUPABASE_JWT_SECRET` | API server only. |

Rotate keys in the Supabase dashboard if they leak. Treat SQL Editor access as production root.

## 5. Runtime checks

- `GET /api/v1/health` must report `supabase.configured: true`.
- Sign in as the bootstrap admin and confirm `profiles.role = 'admin'`.
- Confirm a non-admin cannot `select * from wallets` of another merchant (SQL as that user / anon key + user JWT).
- Confirm merchant registration without an invitation code fails.

## 6. Backups and upgrades

- Enable PITR / daily backups on the hosted project.
- Keep NestJS and migration deploys in lockstep: schema first if the API depends on a new function, API first only when it is backward compatible.
- Never use `supabase db reset` against production.
