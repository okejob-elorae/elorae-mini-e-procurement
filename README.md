# Elorae — local deploy

Monorepo: `apps/web` (Next.js ERP), `apps/api` (NestJS Jubelio integration), `packages/db` (shared Prisma + MariaDB adapter).

This README covers running the stack on your laptop and exposing `apps/api` publicly via ngrok for client demos. For the ERP feature list, see `apps/web/README.md`. For the service-boundary contract, see `docs/BOUNDARY.md`.

---

## Prereqs

- Node `>=22`, pnpm `>=11` (declared in root `package.json` `engines`)
- A MySQL/MariaDB-compatible database. Production runs **MariaDB 11.4** in the docker-compose stack on the VPS; local dev reaches the same DB through an SSH tunnel (see Local-dev DB access below).
- ngrok account (free, no card) — only needed for client demos
- Jubelio account credentials — only needed to test integration

## Repo layout

```
apps/
  web/    Next.js 16 App Router, NextAuth, ERP UI + node-cron (VPS)
  api/    NestJS 11, Jubelio HTTP client, webhook receivers, catalog sync
packages/
  db/     Prisma 7 schema + generated client + MariaDB adapter
docs/
  BOUNDARY.md   service boundary contract — source of truth for who writes what
```

## Env files

| File | Purpose |
|---|---|
| `apps/web/.env` | All web keys + shared `DATABASE_URL` |
| `apps/api/.env` | api-only keys (`JUBELIO_*`, `SWAGGER_*`, `CORS_ORIGINS`, `PORT`). No `DATABASE_URL` — cascades from `apps/web/.env` via `apps/api/src/bootstrap-env.ts` |

Both `.env` files are gitignored. Templates: `apps/web/.env.example`, `apps/api/.env.example`.

The api env-load cascade: `apps/api/.env` → `<root>/.env` → `apps/web/.env`. Earlier wins per key (dotenv default no-override). Lets api omit shared keys.

## First-time setup

```bash
# 1. install
pnpm install

# 2. copy env templates and fill values
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
# edit both: set DATABASE_URL in apps/web/.env, JUBELIO_* in apps/api/.env

# 3. generate Prisma client + run migrations
pnpm --filter @elorae/db generate
pnpm --filter @elorae/db migrate:deploy
```

## Redis (BullMQ queue for Jubelio webhook processing)

The api needs Redis for the Jubelio webhook queue.

```bash
docker compose -f docker-compose.dev.yml up -d redis
```

`REDIS_URL` defaults to `redis://localhost:6379`. Set it in `apps/api/.env` if you run Redis elsewhere.

## Dev mode (hot reload)

Two terminals:

```bash
# terminal 1 — web on :3000
pnpm --filter @elorae/web dev

# terminal 2 — api on :3001 (SWC builder, watches src/)
pnpm --filter @elorae/api dev
```

Or both via Turborepo:

```bash
pnpm dev
```

## Prod-mode local boot

For validating the production build locally (mirrors how a host would run apps/api):

```bash
# full chain: build deps + migrate + start
pnpm prod:api

# or step-by-step
pnpm --filter @elorae/api prod:build
pnpm --filter @elorae/api migrate:deploy
pnpm --filter @elorae/api prod:start
```

`prod:start` sets `NODE_ENV=production` and runs `node dist/main.js`. cwd must be `apps/api` so `bootstrap-env.ts` resolves the env cascade — `pnpm --filter` handles this automatically.

## Client demo via ngrok

Pattern: `apps/api` runs on your laptop and is exposed publicly via ngrok with a stable free domain so Jubelio can reach it. Same TiDB cluster as the VPS-deployed web.

```bash
# 1. start apps/api locally (dev or prod-mode)
pnpm --filter @elorae/api dev

# 2. start ngrok tunnel pointing at api port
ngrok http --domain=<your-name>.ngrok-free.app 3001
```

Set `INTERNAL_API_URL=https://<your-name>.ngrok-free.app` in `apps/web/.env` (or VPS env) so web reaches your local api.

Set `CORS_ORIGINS=https://<your-web-origin>` in `apps/api/.env` so the api accepts cross-origin requests from the web.

Jubelio webhooks (optional): in the Jubelio dashboard set URL to `https://<your-name>.ngrok-free.app/webhooks/jubelio/<event>` and `JUBELIO_WEBHOOK_SECRET` to match. Only enable during demo windows — when your laptop is off, webhooks drop after 3 Jubelio retries.

### Demo caveats

- Laptop off = api down → web features that call `INTERNAL_API_URL` error out (local demo only; VPS is unaffected).
- The VPS MariaDB is shared between local-dev (via SSH tunnel) and the VPS-deployed web. A local `prisma migrate dev` or destructive query hits the same data the client sees. Use a separate database (`CREATE DATABASE elorae_demo`) on the same MariaDB instance if you need isolation.
- ngrok free tier: 1 reserved domain, 40 connections/min, 20k req/month. Plenty for demos.

### Local-dev DB access

```bash
# Persistent tunnel — leave running in the background.
ssh -fNL 3306:127.0.0.1:3306 elorae@api.elorae.cloud
# or with autossh for auto-reconnect:
autossh -fNL 3306:127.0.0.1:3306 elorae@api.elorae.cloud

# apps/web/.env
DATABASE_URL=mysql://elorae:<DB_PASSWORD>@127.0.0.1:3306/elorae
```

The MariaDB port is bound to `127.0.0.1` on the VPS — no public reach, tunnel is mandatory.

## Production deploy — Hostinger VPS

Both `apps/web` and `apps/api` run on the same Hostinger VPS alongside MariaDB + Redis + Caddy, all via Docker Compose. Vercel is no longer used (decommissioned 2026-06-18). Public URLs: `https://elorae.cloud` (web) and `https://api.elorae.cloud` (api).

**Server side prereqs** (one-time per VPS):

- Ubuntu 24.04 LTS, 2 vCPU / 8 GB RAM
- DNS A record `api.elorae.cloud → <VPS_IPv4>`
- Docker Engine + Compose plugin installed
- ufw allowing 22 + 80 + 443 only
- Repo cloned to `/srv/elorae` via GitHub deploy key

**First deploy:**

```bash
ssh elorae@api.elorae.cloud
cd /srv/elorae

# 1. Generate DB credentials for the `db` compose service. These live in the
#    project .env (auto-read by Compose for variable substitution), NOT in
#    .env.production (which is loaded into containers as env_file).
cat > .env <<EOF
DB_ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')
DB_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')
EOF
chmod 600 .env
DB_PASSWORD=$(grep ^DB_PASSWORD= .env | cut -d= -f2)

# 2. Fill api + web env files. Inline DB_PASSWORD into DATABASE_URL — env_file
#    values are NOT interpolated by Compose.
cp .env.production.example .env.production
cp .env.production.web.example .env.production.web
sed -i "s|<DB_PASSWORD>|${DB_PASSWORD}|g" .env.production .env.production.web
nano .env.production       # fill: SWAGGER_*, JUBELIO_*, INTERNAL_API_SECRET, CORS_ORIGINS
nano .env.production.web   # fill: NEXTAUTH_*, ENCRYPTION_KEY, FIREBASE_*, R2_*, INTERNAL_API_SECRET
chmod 600 .env.production .env.production.web

# 3. Bring the stack up. db starts first, api/web wait for db health.
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps        # all should show "Up (healthy)"

# 4. Apply Prisma migrations into the fresh MariaDB.
docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL="mysql://elorae:${DB_PASSWORD}@db:3306/elorae" \
  --workdir /app/packages/db api ./node_modules/.bin/prisma migrate deploy

curl -fsS https://api.elorae.cloud/health           # 200 OK
```

Caddy obtains a Let's Encrypt cert automatically on first HTTPS request to the domain. First boot may take ~30 s for cert issuance.

### apps/web on VPS

`apps/web` runs as a Docker Compose service (`web`) alongside `apps/api`, exposed by the same Caddy instance at `https://elorae.cloud`.

**First deploy (web):**

```bash
ssh elorae@api.elorae.cloud
cd /srv/elorae
# Ensure .env.production contains NEXTAUTH_SECRET, NEXTAUTH_URL, DATABASE_URL, INTERNAL_API_SECRET
docker compose -f docker-compose.prod.yml up -d --build web
docker compose -f docker-compose.prod.yml ps        # web should show "Up"
curl -fsS https://elorae.cloud/                     # 200 OK
```

**Subsequent deploys (web):**

```bash
ssh elorae@api.elorae.cloud
cd /srv/elorae
git pull
docker compose -f docker-compose.prod.yml up -d --build web
docker compose -f docker-compose.prod.yml logs -f web    # tail for boot errors
```

Both services share the same `docker compose -f docker-compose.prod.yml` workflow. To rebuild both in one pass: `docker compose -f docker-compose.prod.yml up -d --build api web`.

**Subsequent deploys** (after a merged PR):

```bash
ssh elorae@api.elorae.cloud
cd /srv/elorae
git pull
docker compose -f docker-compose.prod.yml up -d --build api
docker compose -f docker-compose.prod.yml logs -f api    # tail for boot errors
```

`redis` and `caddy` only restart when their own configs change.

**Cut Jubelio webhook URL over** (after the first deploy reports healthy):

1. Jubelio dashboard → Pengaturan → Developer → Webhook
2. Set URL to `https://api.elorae.cloud/webhooks/jubelio/<event>` for each event (`salesorder`, `stock`, `salesreturn`, `product`)
3. Send a test webhook → verify `JubelioWebhookEvent` row appears

**Operational commands:**

```bash
# logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f caddy
docker compose -f docker-compose.prod.yml logs -f redis

# restart one service
docker compose -f docker-compose.prod.yml restart api

# shell into the api container
docker compose -f docker-compose.prod.yml exec api sh

# pull only DB migrations (without rebuild)
docker compose -f docker-compose.prod.yml exec api node -e "require('@elorae/db').prisma.\$queryRaw\`SELECT 1\`.then(console.log)"

# stop everything
docker compose -f docker-compose.prod.yml down

# wipe Redis (DANGEROUS — also wipes BullMQ queue state)
docker compose -f docker-compose.prod.yml down -v
```

**Caveats:**

- `.env.production` + `.env.production.web` + `.env` all live only on the VPS — never commit them. The two `.example` templates are committed.
- The `.env` file is what Compose substitutes for `${DB_ROOT_PASSWORD}` / `${DB_PASSWORD}` in `docker-compose.prod.yml`. The two `.env.production*` files are loaded into containers as literal env vars (no interpolation).
- DB password must match in three places: `.env` (DB_PASSWORD), `.env.production` (inside DATABASE_URL), `.env.production.web` (inside DATABASE_URL). Mismatch = api/web can't connect.
- MariaDB port 3306 is bound to `127.0.0.1` on the VPS — no public access. Local dev tunnels via SSH (see Local-dev DB access above).
- Migrations apply via `prisma migrate deploy` from inside the `api` container (see the First deploy block). Don't run `prisma migrate dev` against this DB.
- Redis data + DB data are in named Docker volumes (`redis-data`, `db-data`). Both survive container restarts. `docker compose down -v` wipes them — never run with `-v` in prod.
- Caddy renews certs automatically. No cron needed.

### Migrating an existing dataset into the VPS MariaDB

One-time when moving from a previous DB (TiDB Cloud, another MariaDB instance, etc.):

```bash
# 1. Dump from the source DB (run locally with credentials for the OLD cluster).
# MYSQL_PWD avoids the "password on command line" warning. --ssl-mode=REQUIRED
# is MySQL 8+ client syntax (`--ssl` is MariaDB-only and breaks on mysql-client).
MYSQL_PWD='<source-password>' mysqldump \
  --host=<source-host> --port=<source-port> --user=<u> \
  --ssl-mode=REQUIRED \
  --single-transaction --skip-lock-tables --skip-add-locks \
  --no-tablespaces --routines --triggers \
  elorae > /tmp/elorae-dump.sql

# 2. Ship the dump to the VPS.
scp /tmp/elorae-dump.sql elorae@api.elorae.cloud:/tmp/

# 3. Import into the running MariaDB container.
ssh elorae@api.elorae.cloud
cd /srv/elorae
DB_ROOT_PASSWORD=$(grep ^DB_ROOT_PASSWORD= .env | cut -d= -f2)
docker exec -i elorae-db mariadb -uroot -p"${DB_ROOT_PASSWORD}" elorae < /tmp/elorae-dump.sql
rm /tmp/elorae-dump.sql

# 4. Re-apply Prisma migrations (idempotent — the dump already contains _prisma_migrations).
docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL="mysql://elorae:${DB_PASSWORD}@db:3306/elorae" \
  --workdir /app/packages/db api ./node_modules/.bin/prisma migrate deploy

# 5. Restart api + web so they pick up the new data.
docker compose -f docker-compose.prod.yml restart api web
```

Flags explained:
- `--single-transaction` — consistent snapshot without locking InnoDB tables (works on TiDB and MariaDB)
- `--skip-add-locks` — TiDB doesn't support `LOCK TABLES`; safe to omit since `--single-transaction` already gives consistency
- `--no-tablespaces` — required on TiDB; harmless on MariaDB
- `--ssl-mode=REQUIRED` — MySQL 8 client syntax. If using mariadb-client, swap to `--ssl`. Drop the flag entirely if neither is recognised — TiDB Serverless enforces TLS server-side and the client upgrades the connection automatically when its capability bit is set.

After migration, verify counts match between source and target on a few tables (`Item`, `JubelioOutbox`, `User`, etc.) before pointing local dev or DNS at the new DB.

## Common scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Turborepo: runs `dev` in every workspace |
| `pnpm build` | Turborepo: runs `build` in every workspace |
| `pnpm type-check` | Turborepo: runs `type-check` in every workspace |
| `pnpm lint` | Turborepo: runs `lint` in every workspace |
| `pnpm prod:api` | Full prod-mode chain for apps/api (build + migrate + start) |
| `pnpm --filter @elorae/db migrate:deploy` | Apply pending migrations (idempotent, safe in prod) |
| `pnpm --filter @elorae/db studio` | Open Prisma Studio against current `DATABASE_URL` |

## Troubleshooting

- **`Cannot read properties of undefined (reading 'prepareCacheLength')`** — `DATABASE_URL` not loaded. Check `apps/web/.env` exists and contains the URL. Cascade only reads existing files.
- **`UOM with code PCS not found. Run db seed first.`** — catalog sync needs the `PCS` UOM seeded: `pnpm --filter @elorae/db seed`.
- **`CORS_ORIGINS not set` warn on api boot** — fine in pure-local dev. Set to the web origin when deploying to VPS or exposing via ngrok.
- **`SWAGGER_USER / SWAGGER_PASS not set` warn** — `/docs` is disabled. Set both in `apps/api/.env` to enable Swagger.
- **api boots but DB queries fail** — confirm migrations ran against the same `DATABASE_URL` you booted with. Check `_prisma_migrations` table.
