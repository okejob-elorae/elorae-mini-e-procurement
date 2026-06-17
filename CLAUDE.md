# Claude context — Elorae

Quick orientation for any new Claude Code session in this repo. Read this first, then `docs/BOUNDARY.md` for the architectural contract.

## What this is

pnpm + Turborepo monorepo for an ERP + Jubelio marketplace integration.

```
apps/web/        Next.js 16 App Router — the ERP UI + NextAuth + Vercel cron
apps/api/        NestJS 11 — Jubelio integration service (token, webhooks, queue)
packages/db/     Prisma 7 schema + generated client + MariaDB adapter (shared)
docs/BOUNDARY.md Service-boundary contract — source of truth for who-writes-what
reference/       Local-only planning artifacts (gitignored). EPIC todos live here.
```

Database: TiDB Cloud (MySQL-compatible). Same cluster used by local dev + the Vercel-deployed web.

## Authoritative docs (read these before changing architecture)

- `docs/BOUNDARY.md` — service responsibilities, data ownership (per-table write owners), communication patterns (sync HTTP vs outbox vs webhooks), auth model, failure modes, anti-patterns, decisions log.
- `docs/superpowers/specs/` — per-feature design specs.
- `docs/superpowers/plans/` — per-feature implementation plans.
- `apps/web/README.md` — ERP feature list.
- `README.md` (root) — local setup, env layout, dev/prod commands, ngrok demo.

## Code conventions

- **Double quotes** for string literals in all TS/JS source (whole monorepo, including `apps/web`). No ESLint quote rule enforces single — safe.
- **No comments on Prisma schema models.** Field-level `//` comments forbidden; rationale lives in `docs/`. Migration SQL `--` comments are fine.
- **Branch names + commit messages + PR titles + spec docs are shared artifacts** — no EPIC-XX or L1-L9 labels in them. Use feature names. EPIC labels stay in `reference/todo/` only.
- **One-liner commit messages.** No body. No `Co-Authored-By` trailer. Conventional Commits format (`feat(api): ...`, `fix(db): ...`, etc.).
- **Subpath exports for `@elorae/db` pure helpers.** Client-component imports must use `@elorae/db/color` or `@elorae/db/pantone` (NOT the main barrel) to avoid dragging Prisma/mariadb into the client bundle.

## Workflow conventions

- **Plan before implementing** any non-trivial feature. Brainstorming → spec doc (`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`) → plan doc (`docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`) → implement → PR. The `superpowers:*` skills enforce this when invoked.
- **TDD for non-trivial logic.** Pure functions, handlers, routers, processors get failing tests first. Module-wiring and infra-glue files are exempt.
- **Never force-push master.** Past divergence with a teammate's monolith branch was resolved by *recreating* their content in the monorepo, not by force-merging. See `project_master_divergence` memory.
- **`git check-ignore -v` before staging any dotfile** to confirm it's actually ignored.
- **Never commit secrets.** Even when staging looks clean, double-check `git diff --cached` for `.env`-shaped content.

## Local services (more detail in `README.md`)

| Port | Service | Start | Stop |
|------|---------|-------|------|
| 3000 | apps/web dev (Next.js) | `pnpm -F @elorae/web dev` | `pkill -f "next dev"` |
| 3001 | apps/api (NestJS, prod-mode for queue work) | `pnpm prod:api` or `pnpm -F @elorae/api prod:start` | `pkill -f "node dist/main"` |
| 6379 | Redis (BullMQ for apps/api) | `docker compose -f docker-compose.dev.yml up -d redis` (first time) or `docker start elorae-dev-redis` | `docker stop elorae-dev-redis` |
| ngrok | Public tunnel to apps/api for Jubelio | `ngrok http --url unclean-noncalumniating-cory.ngrok-free.dev 3001` | `pkill -f "ngrok http"` |

**Restart order:** Redis → api → web. Static ngrok domain is account-bound; Jubelio webhook config keeps working across restarts.

## Production hosts

| Host | Service | Notes |
|------|---------|-------|
| Vercel | apps/web | Connected to GitHub; auto-deploys on master. Env vars in Vercel dashboard. |
| Hostinger VPS (`api.elorae.cloud`) | apps/api + Redis + Caddy (Docker Compose) | Manual deploy: `ssh elorae@api.elorae.cloud && cd /srv/elorae && git pull && docker compose -f docker-compose.prod.yml up -d --build api`. Caddy handles auto-SSL. Webhook URL: `https://api.elorae.cloud/webhooks/jubelio/<event>`. See `README.md §Production deploy` for first-time setup + ops commands. |
| TiDB Cloud | MySQL-compatible DB | Shared between dev + Vercel + VPS. `DATABASE_URL` lives in each platform's env store. |

ngrok stays available as a fallback for local-only demo work (laptop apps/api + temporary public tunnel). VPS is the authoritative prod target.

## Env layout

- `apps/web/.env` — Next.js env. Holds the shared `DATABASE_URL` (single source of truth).
- `apps/api/.env` — api-only keys (`JUBELIO_*`, `SWAGGER_*`, `PORT`, `CORS_ORIGINS`, `REDIS_URL`). No `DATABASE_URL` — `apps/api/src/bootstrap-env.ts` cascades it from `apps/web/.env`.
- Cascade order in api: `apps/api/.env` → `<root>/.env` → `apps/web/.env`. Earlier wins per key (dotenv no-override).
- In prod (Vercel + Render/Koyeb/local-with-ngrok): each platform injects env from its own store; cascade is irrelevant.
- **Secrets that have appeared in any chat transcript are compromised.** Rotate `DATABASE_URL` password, `JUBELIO_WEBHOOK_SECRET`, `SWAGGER_PASS` if you accidentally paste them.

## Architecture nuances worth flagging

- **TiDB cluster is shared between local dev and the Vercel-deployed web.** A local destructive query (delete, truncate, bad migration) hits the same data the client demo shows. Run migrations only via `pnpm -F @elorae/db migrate:deploy`; never `migrate dev --create-only` without thinking.
- **`Item` is dual-owner** (web for ERP forms; api for Jubelio catalog ingest). All api writes go through `@elorae/db/item-writer.ts` helpers, stamping `source = JUBELIO_INGEST`. See `docs/BOUNDARY.md §3.3`.
- **`StockAdjustment` is dual-owner** (web for ERP-driven adjustments; api for Jubelio stock webhooks). Api writes go through `@elorae/db/stock-writer.ts` `applyJubelioStockAdjustment`, stamping `source = JUBELIO_WEBHOOK` + `idempotencyKey`. See `docs/BOUNDARY.md §3.1`.
- **Jubelio webhook signature is HMAC-SHA256 with header `Sign`** — not plain SHA256 with `webhook-signature`. Jubelio's docs *text* is wrong; their code example is correct. See `docs/BOUNDARY.md §9 Q1`.
- **Catalog ingest pulls from Jubelio** via `POST /jubelio/catalog/sync` (apps/api). Product push (ERP → Jubelio) is wired via the outbox — see sub-3 below.
- **Inbound webhook pipeline ships in BullMQ-backed queue.** `JubelioWebhookEvent` carries authoritative status (`RECEIVED → PROCESSING → PROCESSED / SKIPPED / DEAD`). Worker runs in apps/api process, concurrency 1. Sweeper rescues stuck rows every 10 min.
- **Outbound push pipeline ships in `JubelioOutbox` table + `outbox-poller` + `outbox-processor`.** Handlers in `apps/api/src/jubelio/outbox/handlers/`: `product_push`, `stock_push`, `salesorder_pick`, `salesorder_pack`, `salesorder_ship`. Already-in-state Jubelio responses are skipped (not retried). New push types add: handler file + payload builder + spec + router case.

## Integration work — decomposition + status

EPIC-01 (Jubelio Integration) + EPIC-02 (Product & Stock Sync) are decomposed into 5 sub-projects, each its own spec → plan → PR cycle:

| Sub | Scope | Status | EPIC stories |
|----|-------|--------|--------------|
| **1** | Inbound webhook queue + stock handler | ✅ shipped (PR #29 merged 2026-05-28) | 01-02 (partial — stock only), 01-03 (inbound half), 02-04 |
| **2** | Outbound `JubelioOutbox` + first push primitive | ✅ shipped (product + stock handlers, outbox router/poller/processor) | 01-03 (outbound), 02-03 |
| **3** | Product push + HPP/price sync | ✅ shipped — product push (PRs #37/#42) + HPP→sellingPrice auto-recalc with audit log (PR #52 merged 2026-06-14). `buy_price` intentionally stays global per decision H3; revisit if Jubelio's buy_price column starts feeding downstream marketplace reporting. | 02-01, 02-02 |
| **4** | Remaining inbound handlers (salesorder, salesreturn, product webhooks) | 🟡 mostly shipped (PR #40 merged 2026-06-10) — salesorder + product handlers wired; **salesreturn handler is a stub awaiting live payload samples**. | 01-02 (full) |
| **5** | Initial bulk migration tool | ✅ shipped (PR #41 merged 2026-06-10) | 02-05 |

EPIC-03 (Sales — Orders) status:

| Story | Scope | Status |
|-------|-------|--------|
| 03-01 | Order ingestion via Jubelio salesorder webhook | ✅ shipped (PR #43 merged 2026-06-11) |
| 03-02 | Order dashboard (list + filters) | ✅ shipped (PR #44 merged 2026-06-11) |
| 03-03 | Order detail view | ✅ shipped (PR #44) |
| 03-04 | KPI widgets on beranda | ✅ shipped (PR #45 merged 2026-06-11) |

EPIC-04 (Sales Fulfillment) decomposition (independent of EPIC-01/02 sub-numbering):

| Sub | Scope | Status |
|----|-------|--------|
| **A** | Fulfillment backend (writer helper, server actions, status transitions, outbox enqueue on pick/pack/ship) | ✅ shipped (PR #47) |
| **B** | UI actions on order detail page + JubelioCourier sync | ✅ shipped (PR #48) |
| **C** | Fulfillment Queue page + Jubelio webhook forward-sync to `SHIPPED` | ✅ shipped (PR #49) |
| **D** | Print views (pick list + packing slip) | ✅ shipped (PR #50 merged 2026-06-14) |

Already done before sub-1: 01-01 (token + cron + alert), 01-04 (API call audit log + 429 + admin dashboard), catalog ingest (`POST /jubelio/catalog/sync`), category sync (2026-06-05).

**Maintenance rule:** When a sub-project, EPIC, or independently-shipped story merges to master, update the relevant table row here in the same session (status → ✅, append PR # + merge date). Stale decomposition tables caused at least one false-start ("sub-2 next" when sub-2 had shipped months earlier). Treat the table as part of the merge checklist, not an afterthought.

## What NOT to do

- Don't put EPIC-XX refs in commits, PRs, branch names, or shared specs.
- Don't bundle multiple sub-projects into one PR. Each sub-project is its own slice.
- Don't write to web-owned tables from apps/api (and vice versa) without going through a `@elorae/db` helper — see `docs/BOUNDARY.md §3`.
- Don't add Prisma model comments. Don't add `Co-Authored-By` trailers to commits.
- Don't run `prisma migrate dev` against the shared TiDB — that creates throwaway migrations and resets state. Use `migrate:deploy` only.
- Don't deploy apps/api to Vercel. NestJS needs a persistent process; Vercel functions don't fit (cron, BullMQ workers). Production target is the Hostinger VPS (`api.elorae.cloud`); local-ngrok is the dev/demo fallback.

## When you need more context

- **Architecture/data ownership:** `docs/BOUNDARY.md`.
- **EPIC story details:** `reference/todo/<NN>.md` (local-only, gitignored).
- **Past designs/plans:** `docs/superpowers/specs/` and `docs/superpowers/plans/`.
- **What changed and why:** `git log --oneline` (commit messages are descriptive; bodies are rare by convention).
