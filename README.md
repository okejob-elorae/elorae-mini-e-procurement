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
| Data | **Prisma 7** + **@prisma/adapter-mariadb** (MySQL / MariaDB / TiDB) |
| Auth | **NextAuth.js v5** (`next-auth` beta), **@auth/prisma-adapter** |
| Forms / API shape | **React Hook Form**, **Zod** |
| Client data | **TanStack Query**, **TanStack Table**, **Zustand** |
| Offline | **Dexie** |
| Files | **Cloudflare R2** (S3-compatible via **@aws-sdk/client-s3**) |
| Push (optional) | **Firebase** client + **firebase-admin** (FCM) |
| Crypto | **bcryptjs**, **crypto-js** |

## Prerequisites

- **Node.js** 20+ (matches `@types/node`; 18+ may work but 20 is the safer baseline)
- **MySQL**, **MariaDB**, or **TiDB** database

## Getting started

1. Clone and install:

```bash
git clone <repository-url>
cd elorae-erp
npm install
```

2. Environment — copy the root template and edit values:

```bash
cp .env.example .env.local
```

3. Database:

```bash
npx prisma migrate dev
npx prisma db seed
```

(`db seed` is configured in `prisma.config.ts`; you can also use `npm run db:seed`.)

4. Dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated users are sent to `/login`; the main app lives under **`/backoffice`**.

## npm scripts

| Script | Purpose |
|--------|---------|
| `dev` | Next.js dev server |
| `build` | Production build (no migrate) |
| `vercel-build` | `prisma generate` → `prisma migrate deploy` → `next build` (Vercel) |
| `start` | Run production server |
| `lint` | ESLint |
| `type-check` | `tsc --noEmit` |
| `check` | `type-check` + `lint` |
| `db:migrate` | `prisma migrate dev` |
| `db:seed` | Run `prisma/seed.ts` |
| `db:seed:production-login` | Additional seed script for production-style login |
| `db:studio` | Prisma Studio |
| `db:generate` | `prisma generate` |
| `db:test` | Connection test helper |

There is **no** configured Jest/Vitest/Playwright script in this repo; use `npm run check` for static quality gates.

## Default login (after `prisma db seed`)

| User | Password | Notes |
|------|----------|--------|
| admin@elorae.com | admin123 | PIN 123456 (sensitive actions) |
| purchaser@elorae.com | purchaser123 | PIN set in seed output |
| warehouse@elorae.com | warehouse123 | |
| production@elorae.com | production123 | |

Use only in development; change or remove these users in production.

## Environment variables

See **`.env.example`** for the full list. Commonly required:

- **`DATABASE_URL`** — MySQL-compatible URL (TiDB Cloud often uses `sslaccept=strict`).
- **`NEXTAUTH_URL`** — App URL (production: your Vercel URL).
- **`NEXTAUTH_SECRET`** — Session secret (32+ random characters).
- **`ENCRYPTION_KEY`** — Exactly **32 characters** for AES-256 (supplier bank data).
- **`R2_*`** — Optional; file uploads to Cloudflare R2.
- **Firebase** — Optional; PWA push (`NEXT_PUBLIC_*` + `FIREBASE_ADMIN_*`).
- **`CRON_SECRET`** — Protects **`/api/cron/check-overdue`** (used by Vercel Cron).

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
  prisma.ts            # Prisma client
  offline/             # Dexie schema + sync client
  i18n/                # next-intl messages
  print/               # Printable HTML builders
  validations/         # Zod schemas
app/actions/           # Server Actions (mutations, orchestration)
prisma/
  schema.prisma
  migrations/
  seed.ts
proxy.ts               # Edge request gate: auth redirect + JWT permission checks
types/                 # Shared TypeScript types
```

Business logic is split between **`app/actions/*`** (server actions) and **`app/api/**/route.ts`** (HTTP APIs, including offline sync).

## Database domains (Prisma)

Users and sessions; roles and permissions; suppliers and supplier types; items, categories, UOM; purchase orders and lines; GRN; inventory valuations and stock movements; adjustments; work orders, material issues, FG receipts; vendor returns; document numbering; audit logs; notifications; and related enums — see **`prisma/schema.prisma`**.

## Role model (legacy enum + dynamic RBAC)

Users have a legacy **`Role`** enum (`ADMIN`, `PURCHASER`, `WAREHOUSE`, `PRODUCTION`, `USER`). Effective page and API access is driven by **permission codes** loaded from the database into the JWT and enforced in **`proxy.ts`**. For day-to-day behavior, treat the seeded roles and **Settings → RBAC** as the source of truth.

## Deployment (Vercel)

- **`vercel.json`** sets `buildCommand` to **`npm run vercel-build`** (migrations run on deploy).
- A daily cron calls **`/api/cron/check-overdue`** at **09:00 UTC**; set **`CRON_SECRET`** and secure that route as implemented in the app.

## Security notes

- Passwords hashed with bcrypt; supplier bank fields encrypted at rest.
- PIN for selected sensitive actions; audit logging for data access.
- HTTPS and cookie security in production; `trustHost` enabled for Vercel in auth config (see `lib/auth.ts`).

## Offline behavior

Queued mutations (e.g. suppliers, POs, GRN) sync to the server when connectivity returns; the UI exposes online/offline status. Details live in **`lib/offline/`** and **`app/api/sync/route.ts`**.

## License

MIT
