# VIRA local eval (Elorae on :3010)

Bring up the local MariaDB test bed + Elorae web against known `EVAL-` fixtures so the VIRA runtime (`E:\Project\OKEJOB\vira`, usually `:8788`) can be scored against `packages/db/prisma/vira-eval-manifest.json`.

**Hard rules:** `DATABASE_URL` must be `127.0.0.1:3308` only. Never `:3307`, `DATABASE_URL_PROD`, the SSH tunnel, or `clone-to-local.ts`. The eval seed deletes only its own rows (`EVAL-` / `@vira-eval.local`).

Anchor date for all relative dates: **2026-11-20 (WIB)**.

## Cold start

PowerShell 5.1 (`;` not `&&`):

```powershell
# 1. DB + Redis
docker start elorae-dev-db elorae-dev-redis
# first time only:
# docker compose -f docker-compose.dev.yml up -d db redis

# 2. Migrations (local bed)
$env:DATABASE_URL = "mysql://elorae:elorae@127.0.0.1:3308/elorae"
pnpm -F @elorae/db migrate:deploy
if ($LASTEXITCODE -ne 0) { exit }

# 3. Ensure vira permission rows exist (idempotent SQL; deploy also runs these once)
Get-Content packages/db/prisma/seed-vira-2026-11-16-permissions.sql -Raw | docker exec -i elorae-dev-db mariadb -uelorae -pelorae elorae
if ($LASTEXITCODE -ne 0) { exit }
Get-Content packages/db/prisma/seed-vira-2026-11-17-permissions.sql -Raw | docker exec -i elorae-dev-db mariadb -uelorae -pelorae elorae
if ($LASTEXITCODE -ne 0) { exit }

# 4. Eval fixtures (password from env — never commit it)
$env:VIRA_EVAL_PASSWORD = "<pick-a-local-password>"
pnpm -F @elorae/db seed:vira-eval
if ($LASTEXITCODE -ne 0) { exit }

# 5. Web on :3010 (VIRA_* already in apps/web/.env; override URLs for this port)
$env:PORT = "3010"
$env:NEXTAUTH_URL = "http://localhost:3010"
$env:AUTH_URL = "http://localhost:3010"
$env:VIRA_APP_URL = "http://localhost:3010"
# NEXT_PUBLIC_VIRA_WIDGET_URL / NEXT_PUBLIC_VIRA_RUNTIME_URL → http://localhost:8788 (see .env)
pnpm -F @elorae/web dev -- --port 3010
```

Login: `http://localhost:3010/login` as `eval-admin@vira-eval.local` (password = `VIRA_EVAL_PASSWORD`). Open `/backoffice` — the V widget needs the VIRA runtime on `:8788`.

## Reseed

Safe to re-run anytime (idempotent wipe of EVAL rows only):

```powershell
$env:DATABASE_URL = "mysql://elorae:elorae@127.0.0.1:3308/elorae"
$env:VIRA_EVAL_PASSWORD = "<same-password>"
pnpm -F @elorae/db seed:vira-eval
```

Regenerates `packages/db/prisma/vira-eval-manifest.json` from the seed constants.

## Verify fixtures vs manifest

```powershell
pnpm -F @elorae/web exec tsx scripts/verify-vira-eval-manifest.ts
```

Checks three scenarios (`fso-over-credit-limit`, `items-ambiguous-search`, `consignment-missing-nota`) through the same `lib/` queries the VIRA tools use.

## Users

| Email | Role | Notes |
|-------|------|--------|
| `eval-admin@vira-eval.local` | EVAL-ADMIN (`isSystem`) | `*` incl. `vira:use` + `vira:write` |
| `eval-staff@vira-eval.local` | EVAL-STAFF | `vira:use` + view codes; no `vira:write`, no approve |
| `eval-sales-mgr@vira-eval.local` | EVAL-SALES-MGR | field-sales view/approve, receivables view, `vira:use` + `vira:write` |

## Manifest

Ground truth: `packages/db/prisma/vira-eval-manifest.json`. Every fact is emitted from `seed-vira-eval.ts` constants — do not edit the JSON by hand; reseed instead.
