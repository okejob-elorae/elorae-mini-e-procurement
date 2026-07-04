# Elorae ERP

A procurement and production management system for textile and garment manufacturing: suppliers, purchase orders, goods receipt, inventory, work orders, vendor returns, supplier payments, and settings (UOM, tax, document numbering, RBAC).

## Features

- **Authentication** — NextAuth.js v5 (credentials, Prisma adapter, JWT sessions). Optional `AUTH_SECRET` (falls back to `NEXTAUTH_SECRET`).
- **Authorization** — Dynamic RBAC from the database (`RoleDefinition`, `Permission`, `RolePermission`). Route-to-permission checks in `proxy.ts` (edge gate) via `lib/rbac.ts`.
- **Supplier management** — CRUD, supplier **types** (e.g. fabric, accessories), AES-256 encrypted bank details, PIN-gated viewing with audit logging.
- **Procurement & inventory** — Purchase orders, GRN, stock movements, adjustments, stock card, rejected goods; items and categories; UOM.
- **Production** — Work orders, material issues, FG receipts, reconciliation, related flows (e.g. nota register).
- **Returns & payables** — Vendor returns, supplier payments.
- **Operations** — Audit trail, HPP report, dashboard.
- **Internationalization** — `next-intl` with messages under `lib/i18n/messages/`.
- **Offline-first** — Dexie (IndexedDB), pending-operation queue, sync via `POST /api/sync` when online.
- **PWA** — `next-pwa` (service worker enabled in production builds).
- **Print / export** — HTML helpers under `lib/print/` for PO, stock card, inventory reports, and related documents.

## Tech stack

| Area | Choice |
|------|--------|
| Framework | **Next.js 16** (App Router, Turbopack in dev) |
| UI | **React 19**, **Tailwind CSS v4**, **shadcn/ui** (Radix), **lucide-react** |
| Language | **TypeScript 5** |
| Data | **Prisma 7** + **@prisma/adapter-mariadb** (MariaDB 11.4, self-hosted on the Hostinger VPS; previously TiDB Cloud Serverless, migrated off 2026-06-28) |
| Auth | **NextAuth.js v5** (`next-auth` beta), **@auth/prisma-adapter** |
| Forms / API shape | **React Hook Form**, **Zod** |
| Client data | **TanStack Query**, **TanStack Table**, **Zustand** |
| Offline | **Dexie** |
| Files | **Cloudflare R2** (S3-compatible via **@aws-sdk/client-s3**) |
| Push (optional) | **Firebase** client + **firebase-admin** (FCM) |
| Crypto | **bcryptjs**, **crypto-js** |

## Prerequisites

- **Node.js** `>=22`, **pnpm** `>=11` (declared in root `package.json` `engines`) — this app is a workspace in a pnpm + Turborepo monorepo, not a standalone install.
- **MariaDB 11.4** (self-hosted, VPS docker-compose stack) — MySQL-compatible, so MySQL/MariaDB also work for local dev. Previously TiDB Cloud Serverless; migrated off 2026-06-28 after the free tier exhausted its monthly quota.

## Getting started

Run these from the **repo root** (`elorae/`), not from inside `apps/web/` — pnpm workspace commands are filtered by package name. See the root `README.md` for the full local-dev walkthrough (Redis, ngrok, prod-mode boot); this is the condensed web-only path.

1. Clone and install:

```bash
git clone <repository-url>
cd elorae
pnpm install
```

2. Environment — copy the template and edit values:

```bash
cp apps/web/.env.example apps/web/.env
```

`apps/web/.env` holds the shared `DATABASE_URL` (single source of truth — `apps/api` cascades it from here). There is no root `.env.example`.

3. Database — schema, migrations, and seeds live in `packages/db`, not here:

```bash
pnpm --filter @elorae/db generate
pnpm --filter @elorae/db migrate:deploy
pnpm --filter @elorae/db seed
```

Never run `prisma migrate dev` against the shared VPS MariaDB — it creates throwaway migrations and can reset state. `migrate:deploy` is the only sanctioned command outside a local test bed (see `docs/local-db-testbed.md`).

4. Dev server:

```bash
pnpm --filter @elorae/web dev
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated users are sent to `/login`; the main app lives under **`/backoffice`**.

## Scripts

`apps/web/package.json`:

| Script | Purpose |
|--------|---------|
| `dev` | Next.js dev server |
| `build` | Production build (`next build --webpack`; no migrate) |
| `vercel-build` | `@elorae/db generate` → `@elorae/db build` → `next build --webpack` — legacy name from when Vercel was the deploy target; no longer used for deploys (see Deployment below) |
| `start` | Run production server |
| `lint` | ESLint |
| `type-check` | `tsc --noEmit` |
| `test` | `vitest run` |
| `check` | `type-check` + `lint` |
| `reconcile:umkm` | UMKM opening-stock reconciliation script |
| `sample:umkm-sku` | UMKM SKU-bridge sampling script |

`packages/db/package.json` (run with `pnpm --filter @elorae/db <script>`):

| Script | Purpose |
|--------|---------|
| `generate` | `prisma generate` → `tsc` |
| `migrate` | `prisma migrate dev` — dev-only; never against the shared VPS DB |
| `migrate:deploy` | `prisma migrate deploy` — idempotent, safe in prod |
| `studio` | Prisma Studio |
| `seed` | Run `prisma/seed.ts` |
| `seed:production-login` | Seed a production-style login user (see `docs/local-db-testbed.md`) |
| `test:connection` | DB connection test helper |

Testing: `apps/web/package.json` has `test: vitest run` — run via `pnpm --filter @elorae/web test`.

## Default login (after `pnpm --filter @elorae/db seed`)

| User | Password | Notes |
|------|----------|--------|
| admin@elorae.com | admin123 | PIN 123456 (sensitive actions) |
| purchaser@elorae.com | purchaser123 | PIN set in seed output |
| warehouse@elorae.com | warehouse123 | |
| production@elorae.com | production123 | |

Use only in development; change or remove these users in production.

## Environment variables

See **`apps/web/.env.example`** for the full list (there is no root `.env.example`). Commonly required:

- **`DATABASE_URL`** — MySQL-compatible URL, MariaDB 11.4 in prod (see Prerequisites above).
- **`NEXTAUTH_URL`** — App URL (production: `https://elorae.cloud`).
- **`NEXTAUTH_SECRET`** — Session secret (32+ random characters).
- **`ENCRYPTION_KEY`** — Exactly **32 characters** for AES-256 (supplier bank data).
- **`INTERNAL_API_SECRET`** — Shared secret for signing web→api requests (see `docs/BOUNDARY.md` §5); must match `apps/api/.env`.
- **`R2_*`** — Optional; file uploads to Cloudflare R2.
- **Firebase** — Optional; PWA push (`NEXT_PUBLIC_*` + `FIREBASE_ADMIN_*`).
- **`CRON_SECRET`** — Protects the cron routes (`/api/cron/check-overdue`, `/api/cron/reconciliation`) when hit manually; automated firing is in-process node-cron (see Scheduled jobs below), not an external caller.

## Project structure (high level)

```
app/
  api/                 # Route handlers (auth, sync, suppliers, items, cron, …)
  backoffice/          # Main ERP UI (dashboard, items, suppliers, POs, inventory, production, …)
  login/               # Sign-in
components/            # UI, forms, domain components (GRN, tables, …)
lib/
  auth.ts              # NextAuth configuration
  rbac.ts              # Permissions and route mapping
  internal-api.ts      # HMAC-signed internal requests to apps/api
  cron/                # node-cron job definitions (jobs.ts) + handlers
  offline/             # Dexie schema + sync client
  i18n/                # next-intl messages
  print/               # Printable HTML builders
  validations/         # Zod schemas
app/actions/           # Server Actions (mutations, orchestration)
proxy.ts               # Edge request gate: auth redirect + JWT permission checks
instrumentation.ts     # Registers node-cron jobs on server boot
types/                 # Shared TypeScript types
```

Prisma schema, migrations, and seeds live in **`packages/db/prisma/`** (shared package), not under `apps/web`. `apps/web` imports the generated client via `@elorae/db`.

Business logic is split between **`app/actions/*`** (server actions) and **`app/api/**/route.ts`** (HTTP APIs, including offline sync).

## Database domains (Prisma)

Users and sessions; roles and permissions; suppliers and supplier types; items, categories, UOM; purchase orders and lines; GRN; inventory valuations and stock movements; adjustments; work orders, material issues, FG receipts; vendor returns; document numbering; audit logs; notifications; and related enums — see **`packages/db/prisma/schema.prisma`**.

## Role model (legacy enum + dynamic RBAC)

Users have a legacy **`Role`** enum (`ADMIN`, `PURCHASER`, `WAREHOUSE`, `PRODUCTION`, `USER`). Effective page and API access is driven by **permission codes** loaded from the database into the JWT and enforced in **`proxy.ts`**. For day-to-day behavior, treat the seeded roles and **Settings → RBAC** as the source of truth.

## Scheduled jobs

No Vercel Cron — `apps/web` runs in-process **node-cron** (`lib/cron/jobs.ts`, registered from `instrumentation.ts` on server boot):

- Daily `check-overdue` at 09:00 **Asia/Jakarta** (`0 9 * * *`).
- Every 6 hours, Jubelio stock reconciliation (`0 */6 * * *`).

The corresponding `/api/cron/*` routes remain as manual triggers (e.g. smoke testing), guarded by `CRON_SECRET` when set — they are not what fires the jobs in normal operation.

## Deployment

Deployed to the **Hostinger VPS** via Docker Compose (`elorae.cloud`), alongside `apps/api` + MariaDB + Redis + Caddy. Vercel was decommissioned 2026-06-18 — there is no `vercel.json` in the repo. See root **`README.md`** §Production deploy — Hostinger VPS for first-time setup and the deploy commands (`git pull && docker compose -f docker-compose.prod.yml up -d --build web`).

## Security notes

- Passwords hashed with bcrypt; supplier bank fields encrypted at rest.
- PIN for selected sensitive actions; audit logging for data access.
- HTTPS and cookie security in production (Caddy auto-SSL on the VPS); `trustHost` enabled in auth config for reverse-proxy deployment (see `lib/auth.ts`).

## Offline behavior

Queued mutations (e.g. suppliers, POs, GRN) sync to the server when connectivity returns; the UI exposes online/offline status. Details live in **`lib/offline/`** and **`app/api/sync/route.ts`**.

## License

MIT
