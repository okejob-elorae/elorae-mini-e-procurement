# Elorae — local deploy

Monorepo: `apps/web` (Next.js ERP), `apps/api` (NestJS Jubelio integration), `packages/db` (shared Prisma + MariaDB adapter).

This README covers running the stack on your laptop and exposing `apps/api` publicly via ngrok for client demos. For the ERP feature list, see `apps/web/README.md`. For the service-boundary contract, see `docs/BOUNDARY.md`.

---

## Prereqs

- Node `>=22`, pnpm `>=11` (declared in root `package.json` `engines`)
- A MySQL/MariaDB-compatible database. Recommended: **TiDB Cloud Serverless** (free tier, MySQL wire protocol, sslaccept=strict). Local MySQL/MariaDB also fine.
- ngrok account (free, no card) — only needed for client demos
- Jubelio account credentials — only needed to test integration

## Repo layout

```
apps/
  web/    Next.js 16 App Router, NextAuth, ERP UI + cron + Vercel cron
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

Pattern: `apps/web` is deployed to Vercel (always-on). `apps/api` runs on your laptop and is exposed publicly via ngrok with a stable free domain. Same TiDB cluster used by both.

```bash
# 1. start apps/api locally (dev or prod-mode)
pnpm --filter @elorae/api dev

# 2. start ngrok tunnel pointing at api port
ngrok http --domain=<your-name>.ngrok-free.app 3001
```

Set `INTERNAL_API_URL=https://<your-name>.ngrok-free.app` in the Vercel project so the deployed web reaches your local api.

Set `CORS_ORIGINS=https://<your-vercel-domain>` in `apps/api/.env` so the api accepts cross-origin requests from Vercel.

Jubelio webhooks (optional): in the Jubelio dashboard set URL to `https://<your-name>.ngrok-free.app/webhooks/jubelio/<event>` and `JUBELIO_WEBHOOK_SECRET` to match. Only enable during demo windows — when your laptop is off, webhooks drop after 3 Jubelio retries.

### Demo caveats

- Laptop off = api down → Vercel features that call `INTERNAL_API_URL` error out.
- TiDB cluster is shared between local-dev and client-facing Vercel. A local `prisma migrate dev` or destructive query hits the same data the client sees. Use a separate `elorae_demo` database in the same TiDB cluster if you need isolation.
- ngrok free tier: 1 reserved domain, 40 connections/min, 20k req/month. Plenty for demos.

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
- **`CORS_ORIGINS not set` warn on api boot** — fine in pure-local dev. Set when exposing via ngrok to Vercel.
- **`SWAGGER_USER / SWAGGER_PASS not set` warn** — `/docs` is disabled. Set both in `apps/api/.env` to enable Swagger.
- **api boots but DB queries fail** — confirm migrations ran against the same `DATABASE_URL` you booted with. Check `_prisma_migrations` table.
